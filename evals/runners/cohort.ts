import type { Cohort, EvalTask, SummaryRecord } from "../schema.ts";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { connectBrowser, parseBrowserUrl } from "../../src/browser/connect.ts";
import { cohortSchema, parseTasks } from "../schema.ts";
import { fixtureRoot, hashTree, startFixtures } from "./fixtures.ts";
import { digest, SYSTEM_PROMPT, TASK_PROMPT_FORMAT } from "./model.ts";
import { loadResults } from "./report.ts";
import { gitMetadata, hash, runOne } from "./run.ts";

export function schedule(
  tasks: EvalTask[],
  cohort: Cohort,
): Array<{ task: EvalTask; variant: Cohort["variants"][number]; repetition: number }> {
  const work = [];
  for (
    let repetition = cohort.repetitionOffset;
    repetition < cohort.repetitionOffset + cohort.repeats;
    repetition++
  ) {
    for (const [index, task] of tasks.entries()) {
      for (let v = 0; v < cohort.variants.length; v++) {
        work.push({
          task,
          variant: cohort.variants[(v + index + repetition) % cohort.variants.length]!,
          repetition,
        });
      }
    }
  }
  return work;
}
export const pairKey = (run: {
  task_id: string;
  variant: string;
  repetition: number;
}): string => `${run.task_id}/${run.variant}/${run.repetition}`;

/** Serialize complete run batches so concurrent tabs cannot interleave JSONL writes. */
export function resultWriter(output: string): (data: string) => Promise<void> {
  let pending = Promise.resolve();
  return (data) => {
    pending = pending.then(() => appendFile(output, data));
    return pending;
  };
}

export async function sourceHash(): Promise<string> {
  return hash(
    [
      await hashTree(fileURLToPath(new URL("../../src/", import.meta.url))),
      await hashTree(fileURLToPath(new URL("./", import.meta.url))),
      ...(await Promise.all(
        ["schema.ts", "success.ts", "failures.ts"].map((name) =>
          readFile(new URL(`../${name}`, import.meta.url), "utf8"),
        ),
      )),
      await readFile("package.json", "utf8"),
      await readFile("pnpm-lock.yaml", "utf8"),
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg, i) => i !== 0 || arg !== "--"),
    options: {
      config: { type: "string", default: "evals/cohorts/pilot.json" },
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
  let cohort = cohortSchema.parse(JSON.parse(await readFile(values.config!, "utf8")));
  if (!process.env[cohort.apiKeyEnv]?.trim())
    throw new Error(`Missing ${cohort.apiKeyEnv}; no cohort started.`);
  let tasks = parseTasks(JSON.parse(await readFile(cohort.tasks, "utf8"))).filter(
    (t) => cohort.categories.includes(t.category) && !t.fault,
  );
  if (values.smoke) {
    tasks = tasks.filter((t) => ["grounding-002", "stale-002"].includes(t.id));
    cohort = { ...cohort, id: "smoke", repeats: 1 };
  }
  tasks = tasks.map((task) => ({ ...task, maxSteps: cohort.maxSteps }));
  const output = resolve(values.output ?? `evals/results/${cohort.id}.jsonl`);
  await mkdir(resolve("evals/results"), { recursive: true });
  const fixtures = await startFixtures(cohort.fixturePort);
  let connection: Awaited<ReturnType<typeof connectBrowser>> | undefined;
  try {
    connection = await connectBrowser(parseBrowserUrl(values["browser-url"]!));
    const browser = await connection.client.send("Browser.getVersion");
    if (cohort.browserVersion && cohort.browserVersion !== browser.product)
      throw new Error("Browser version differs from pinned cohort.");
    cohort = { ...cohort, browserVersion: browser.product };
    const metadata = {
      ...gitMetadata(),
      browser_version: browser.product,
      fixture_hash: await hashTree(fixtureRoot),
      source_hash: await sourceHash(),
    };
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
    const pending = plan.filter(
      (p) => !completed.has(pairKey({ task_id: p.task.id, ...p })),
    );
    const savedPlan = {
      experiment_id: experimentId,
      control_hash: controlHash,
      cohort,
      metadata,
      expected_runs: plan.length,
      tasks: tasks.map((t) => t.id),
      planned_pairs: plan.map((p) => pairKey({ task_id: p.task.id, ...p })),
      status: "running",
    };
    await writeFile(planPath, `${JSON.stringify(savedPlan, null, 2)}\n`);
    const writeRecords = resultWriter(output);
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
    await Promise.all(Array.from({ length: cohort.concurrency }, worker));
    await writeFile(
      planPath,
      `${JSON.stringify({ ...savedPlan, status: stopReason ? "incomplete" : "complete", completed_runs: finished, llm_calls: llmCalls, stop_reason: stopReason }, null, 2)}\n`,
    );
    console.log(
      `Saved ${finished}/${plan.length} runs to ${output}${stopReason ? `; ${stopReason}` : ""}`,
    );
    if (stopReason) process.exitCode = 1;
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
