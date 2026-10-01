import type { SummaryRecord } from "../schema.ts";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { connectBrowser, parseBrowserUrl } from "../../src/browser/connect.ts";
import { pairKey, resultWriter, schedule, sourceHash } from "../runners/cohort.ts";
import { fixtureRoot, hashTree, startFixtures } from "../runners/fixtures.ts";
import { digest, SYSTEM_PROMPT, TASK_PROMPT_FORMAT } from "../runners/model.ts";
import { loadResults } from "../runners/report.ts";
import { gitMetadata, runOne } from "../runners/run.ts";
import { cohortSchema, parseTasks } from "../schema.ts";
import { verifyCompletedCells, verifyConfirmatoryFreeze } from "./controls.ts";
import { installResponseRecorder } from "./responses.ts";

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg, i) => i !== 0 || arg !== "--"),
    options: {
      config: {
        type: "string",
        default: "evals/cohorts/paper-replication-model2-v1.json",
      },
      output: { type: "string" },
      "browser-url": { type: "string", default: "http://127.0.0.1:9333" },
      resume: { type: "boolean", default: false },
      smoke: { type: "boolean", default: false },
    },
  });
  try {
    process.loadEnvFile(".env");
  } catch {
    /* Environment may already be configured. */
  }
  const cohort = cohortSchema.parse(JSON.parse(await readFile(values.config!, "utf8")));
  const confirmatory =
    resolve(values.config!) ===
      resolve("evals/cohorts/paper-replication-model2-v1.json") ||
    cohort.id === "paper-replication-model2-v1";
  if (!process.env[cohort.apiKeyEnv]?.trim())
    throw new Error(`Missing ${cohort.apiKeyEnv}; no cohort started.`);
  if (!confirmatory) throw new Error("Use only the frozen replication config.");
  let tasks = parseTasks(JSON.parse(await readFile(cohort.tasks, "utf8"))).filter(
    (t) => cohort.categories.includes(t.category) && !t.fault,
  );
  if (values.smoke)
    throw new Error(
      "Use the separate one-request connectivity smoke; no benchmark smoke is allowed.",
    );
  tasks = tasks.map((task) => ({ ...task, maxSteps: cohort.maxSteps }));
  const output = resolve(values.output ?? `evals/results/${cohort.id}.jsonl`);
  if (
    confirmatory &&
    (values.smoke ||
      output !== resolve("evals/results/paper-replication-model2-v1.jsonl"))
  )
    throw new Error(
      "Confirmatory cohort requires the canonical output and full frozen plan.",
    );
  const smoke = JSON.parse(
    await readFile(`evals/reports/${cohort.id}-smoke.json`, "utf8"),
  );
  if (smoke.status !== "passed" || smoke.response.model !== cohort.model)
    throw new Error("Frozen connectivity smoke must pass before cohort execution.");
  await mkdir(resolve("evals/results"), { recursive: true });
  const fixtures = await startFixtures(cohort.fixturePort);
  let connection: Awaited<ReturnType<typeof connectBrowser>> | undefined;
  try {
    connection = await connectBrowser(parseBrowserUrl(values["browser-url"]!));
    const browser = await connection.client.send("Browser.getVersion");
    if (cohort.browserVersion && cohort.browserVersion !== browser.product)
      throw new Error("Browser version differs from pinned cohort.");

    const metadata = {
      ...gitMetadata(),
      browser_version: browser.product,
      fixture_hash: await hashTree(fixtureRoot),
      source_hash: await sourceHash(),
    };
    if (confirmatory)
      await verifyConfirmatoryFreeze(cohort, browser, values["browser-url"]!);
    const controlHash = digest(
      JSON.stringify({
        cohort,
        tasks,
        metadata: {
          source_hash: metadata.source_hash,
          fixture_hash: metadata.fixture_hash,
        },
        system: SYSTEM_PROMPT,
        taskPrompt: TASK_PROMPT_FORMAT,
      }),
    );
    const planPath = `${output}.meta.json`;
    let existing: SummaryRecord[] = [];
    let experimentId = randomUUID() as string;
    let previous;
    try {
      previous = JSON.parse(await readFile(planPath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (previous) {
      if (!values.resume)
        throw new Error("Result plan exists; use --resume or a new output path.");
      if (previous.control_hash !== controlHash)
        throw new Error(
          "Resume refused: cohort, source, fixture, browser or prompt changed.",
        );
      experimentId = previous.experiment_id;
      try {
        existing = await loadResults([output]);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    } else {
      try {
        await readFile(output);
        throw new Error("Result file exists without a plan; choose a new output.");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    const plan = schedule(tasks, cohort);
    const completed = new Set(existing.map(pairKey));
    if (completed.size !== existing.length)
      throw new Error("Duplicate task/variant/repetition pair.");
    if (confirmatory)
      verifyCompletedCells(
        existing,
        plan.map((p) => pairKey({ task_id: p.task.id, ...p })),
      );
    const pending = plan.filter(
      (p) => !completed.has(pairKey({ task_id: p.task.id, ...p })),
    );
    const savedPlan = {
      experiment_id: experimentId,
      control_hash: controlHash,
      cohort,
      metadata,
      node_version: process.version,
      expected_runs: plan.length,
      tasks: tasks.map((t) => t.id),
      planned_pairs: plan.map((p) => pairKey({ task_id: p.task.id, ...p })),
      status: "running",
    };
    await writeFile(planPath, `${JSON.stringify(savedPlan, null, 2)}\n`);
    const recorder = installResponseRecorder(
      `evals/results/${cohort.id}-responses.jsonl`,
    );
    const writeRecords = resultWriter(output);
    let checkpointPending = Promise.resolve();
    const checkpoint = (data: object): Promise<void> => {
      checkpointPending = checkpointPending.then(async () => {
        await writeFile(`${planPath}.tmp`, `${JSON.stringify(data, null, 2)}\n`);
        await rename(`${planPath}.tmp`, planPath);
      });
      return checkpointPending;
    };
    let llmCalls = existing.reduce((sum, r) => sum + r.llm_calls, 0);
    let cursor = 0;
    let finished = existing.length;
    let stopReason: string | null = null;
    const results = [...existing];
    console.log(
      `${cohort.id}: ${plan.length} planned runs, ${existing.length} completed; model=${cohort.model}; temperature=${cohort.temperature}; browser=${browser.product}`,
    );
    const beforeCall = (): void => {
      if (llmCalls >= cohort.maxLlmCalls) {
        stopReason = "Cohort LLM call budget reached.";
        throw new Error(stopReason);
      }
      llmCalls++;
    };
    const worker = async (): Promise<void> => {
      while (cursor < pending.length && !stopReason) {
        const item = pending[cursor++]!;
        if (confirmatory) {
          try {
            await verifyConfirmatoryFreeze(cohort, browser, values["browser-url"]!);
          } catch (error) {
            stopReason = error instanceof Error ? error.message : String(error);
            break;
          }
          if (stopReason) break;
        }
        const result = await runOne({
          connection: connection!,
          fixtureUrl: fixtures.url,
          ...item,
          provider: "model",
          experimentId,
          output,
          metadata,
          timeoutMs: cohort.timeoutMs,
          cohort,
          beforeCall,
          writeRecords,
        });
        results.push(result);
        finished++;
        await checkpoint({
          ...savedPlan,
          completed_runs: finished,
          llm_calls: llmCalls,
        });
        console.log(
          `${finished}/${plan.length} ${result.success ? "PASS" : "FAIL"} ${result.task_id} ${result.variant} r${result.repetition} steps=${result.steps} calls=${result.llm_calls} ${result.failure_type ?? ""}`,
        );
        if (result.metadata.returned_models.some((model) => model !== cohort.model))
          stopReason =
            "Provider returned a different model; primary comparison stopped.";
        if (
          /HTTP (?:400|401|403|429|402)|connection failed|HTTP 5\d\d/.test(
            result.reason,
          )
        )
          stopReason = `Endpoint failure: ${result.reason}`;
      }
    };
    try {
      await Promise.all(Array.from({ length: cohort.concurrency }, worker));
    } finally {
      await recorder.close();
    }
    await writeFile(
      planPath,
      `${JSON.stringify({ ...savedPlan, status: stopReason || finished !== plan.length ? "incomplete" : "complete", completed_runs: finished, llm_calls: llmCalls, stop_reason: stopReason }, null, 2)}\n`,
    );
    console.log(
      `Saved ${finished}/${plan.length} runs to ${output}${stopReason ? `; ${stopReason}` : ""}`,
    );
    if (stopReason || finished !== plan.length) process.exitCode = 1;
  } finally {
    await connection?.close();
    await fixtures.close();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
