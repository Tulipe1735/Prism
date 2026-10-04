import type { Buffer } from "node:buffer";
import type { BrowserConnection } from "../../src/browser/connect.ts";
import type { BrowserSession } from "../../src/browser/session.ts";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { connectBrowser, parseBrowserUrl } from "../../src/browser/connect.ts";
import { openBrowserSession } from "../../src/browser/session.ts";
import { actionSpace } from "../../src/runtime/action-space.ts";
import { resultWriter } from "../runners/cohort.ts";
import { fixtureRoot, hashTree, startFixtures } from "../runners/fixtures.ts";
import { digest, SYSTEM_PROMPT, TASK_PROMPT_FORMAT } from "../runners/model.ts";
import { actionEvidence } from "../runners/representation.ts";
import { evaluateSuccess, readEvidence } from "../success.ts";
import { apiKey, armDecision, isFailure } from "./decision.ts";
import {
  armPayload,
  type HistoryEntry,
  type ObservedContexts,
  observeRelations,
} from "./input.ts";
import {
  type ExperimentCohort,
  type ExperimentRecord,
  type ExperimentTask,
  parseExperimentCohort,
  parseExperimentTasks,
} from "./schema.ts";

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function gitMetadata(): {
  git_commit: string | null;
  git_dirty: boolean | null;
} {
  try {
    return {
      git_commit: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      git_dirty:
        execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()
          .length > 0,
    };
  } catch {
    return { git_commit: null, git_dirty: null };
  }
}

export interface CellPlan {
  task: ExperimentTask;
  arm: string;
}

/** Every task is run in every arm; rotate dispatch order within each task. */
export function schedule(tasks: ExperimentTask[], arms: string[]): CellPlan[] {
  if (arms.length === 0 || new Set(arms).size !== arms.length)
    throw new Error("Cohort arms must be nonempty and unique.");
  return tasks.flatMap((task, index) =>
    arms.map((_, offset) => ({ task, arm: arms[(index + offset) % arms.length]! })),
  );
}

export interface RunOptions {
  connection: BrowserConnection;
  fixturesUrl: string;
  plan: ExperimentCohort;
  task: ExperimentTask;
  arm: string;
  /** `scripted` drives the correct control without any model call. */
  provider: "scripted" | "model";
  experimentId: string;
  fixtureHash: string;
  sourceHash: string;
  beforeCall?: () => void;
  /** Test-only transport injection; never changes experiment provider metadata. */
  fetchImpl?: typeof fetch;
}

function usageNumbers(value: unknown): {
  input: number | null;
  output: number | null;
  total: number | null;
} {
  const record = value as Record<string, unknown> | null;
  const number = (key: string): number | null =>
    typeof record?.[key] === "number" && Number.isSafeInteger(record[key])
      ? (record[key] as number)
      : null;
  return {
    input: number("prompt_tokens") ?? number("input_tokens"),
    output: number("completion_tokens") ?? number("output_tokens"),
    total: number("total_tokens"),
  };
}

/** One task × one arm: a single trial recorded as one schema-v4 run record. */
export async function runCell(options: RunOptions): Promise<ExperimentRecord> {
  const { plan, task, arm } = options;
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const runId = randomUUID();
  const history: HistoryEntry[] = [];
  const trace: ExperimentRecord["trace"] = [];
  const responses: ExperimentRecord["responses"] = [];
  let firstPayload: unknown = null;
  let firstPayloadChars: number | null = null;
  let llmCalls = 0;
  let inputTokens: number | null = 0;
  let outputTokens: number | null = 0;
  let totalTokens: number | null = 0;
  const returnedModels = new Set<string>();
  let firstScored: "correct" | "wrong" | null = null;
  let wrongTargets: number | null = null;
  let correctTargets: number | null = null;
  let mutationCount: number | null = null;
  let status: ExperimentRecord["status"] = "failed";
  let reason = "Run did not start.";
  let failureStage: string | null = "setup";
  let steps = 0;
  let goalHeld = false;
  let session: BrowserSession | undefined;

  try {
    session = await openBrowserSession({
      url: new URL(task.url, options.fixturesUrl).href,
      client: options.connection.client,
    });
    const owned = session;
    const deadline = performance.now() + 5_000;
    while (true) {
      const ready = await owned.call("Runtime.evaluate", {
        expression: "Boolean(window.__prismEval)",
        returnByValue: true,
      });
      if (ready.result?.value === true) break;
      if (performance.now() >= deadline)
        throw new Error("Fixture did not become ready.");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    let evidence = await readEvidence(owned, task.success);

    for (let step = 1; step <= plan.maxSteps; step++) {
      if (performance.now() - start >= plan.timeoutMs) {
        status = "failed";
        reason = "Task wall-clock budget reached.";
        failureStage = "budget";
        break;
      }
      failureStage = "observation";
      const snapshot = await owned.observe();
      const contexts = (await actionEvidence(owned, snapshot)) as unknown as {
        contexts: ObservedContexts;
        status: string;
      };
      const relational = arm === "indexed-bound" || arm === "indexed-unbound";
      const relations = relational ? await observeRelations(owned, snapshot) : {};
      const payload = armPayload({
        arm,
        goal: task.goal,
        snapshot,
        evidence: contexts,
        relations,
        history,
      });
      const payloadChars = JSON.stringify(payload).length;
      if (firstPayload === null) {
        firstPayload = payload;
        firstPayloadChars = payloadChars;
      }
      const space = actionSpace(snapshot.actions);

      let selected: { operation: string; target: string | null; text: string | null };
      let selectedAction: (typeof snapshot.actions)[number] | undefined;
      let execution: "executed" | "rejected";
      if (options.provider === "scripted") {
        // The scripted driver only validates the fixture/oracle/payload path; it picks the
        // requested entity, not the arm-specific reading of the description.
        const offered = Object.fromEntries(
          Object.entries(space.targets).map(([operation, candidates]) => [
            operation,
            Object.fromEntries(
              Object.entries(candidates).map(([id, action]) => [id, action]),
            ),
          ]),
        );
        const correct = Object.entries(offered.CLICK ?? {}).find(
          ([, action]) => action.label === task.design.entity,
        );
        if (correct === undefined) throw new Error("Scripted driver found no control.");
        selectedAction = correct[1];
        selected = { operation: "CLICK", target: correct[0], text: null };
        execution = "executed";
      } else {
        failureStage = "decision";
        const decided = await armDecision({
          cohort: plan,
          apiKey: apiKey(plan),
          payload,
          snapshot,
          fetchImpl: options.fetchImpl,
          beforeAttempt: options.beforeCall,
          signal: AbortSignal.timeout(
            Math.max(1, Math.floor(plan.timeoutMs - (performance.now() - start))),
          ),
        });
        llmCalls += decided.httpCalls;
        responses.push({
          step,
          prompt_hash: decided.promptHash,
          request_body: decided.requestBody,
          raw_content: decided.rawContent,
          model: decided.model,
          usage: decided.usage,
          http_calls: decided.httpCalls,
          http_retries: decided.httpRetries,
          error: isFailure(decided) ? decided.message : null,
        });
        if (decided.model) returnedModels.add(decided.model);
        if (
          decided.model === null &&
          !(isFailure(decided) && decided.kind === "provider")
        ) {
          failureStage = "provider";
          throw new Error("Missing returned model identity; block stopped.");
        }
        if (decided.model !== null && decided.model !== plan.model)
          throw new Error(
            `Provider returned ${decided.model}; expected ${plan.model}.`,
          );
        if (isFailure(decided)) {
          inputTokens = outputTokens = totalTokens = null;
          const failure = decided;
          status = "failed";
          reason = failure.message;
          failureStage = failure.kind === "provider" ? "provider" : "decision";
          trace.push({
            step,
            operation: null,
            target: null,
            executed: false,
            assessment: null,
            valid: false,
            error: failure.message,
            payload_chars: payloadChars,
          });
          break;
        }
        const decision = decided;
        // Fail closed on silent model substitution. A credential or endpoint change must
        // never turn into a different model without stopping the block.
        if (decision.model) returnedModels.add(decision.model);
        if (decision.model === null || decision.model !== plan.model)
          throw new Error(
            `Provider returned ${decision.model} but the plan freezes ${plan.model}; block stopped.`,
          );
        const tokens =
          decision.httpRetries === 0
            ? usageNumbers(decision.usage)
            : { input: null, output: null, total: null };
        inputTokens =
          inputTokens === null || tokens.input === null
            ? null
            : inputTokens + tokens.input;
        outputTokens =
          outputTokens === null || tokens.output === null
            ? null
            : outputTokens + tokens.output;
        totalTokens =
          totalTokens === null || tokens.total === null
            ? null
            : totalTokens + tokens.total;
        selected = {
          operation: decision.operation,
          target: decision.target,
          text: decision.text,
        };
        execution = "rejected";
        if (decision.operation === "DONE" || decision.operation === "BLOCKED") {
          status = decision.operation === "DONE" ? "done" : "blocked";
          reason =
            decision.operation === "DONE"
              ? evaluateSuccess(evidence, task.success)
                ? "Policy reported DONE after the goal held."
                : "Policy reported DONE before the goal held."
              : "Policy reported BLOCKED.";
          trace.push({
            step,
            operation: decision.operation,
            target: null,
            executed: false,
            assessment: null,
            valid: true,
            error: null,
            payload_chars: payloadChars,
          });
          break;
        }
        selectedAction =
          decision.target === null
            ? space.controls[decision.operation]
            : space.targets[decision.operation]?.[decision.target];
        if (selectedAction === undefined)
          throw new Error("Selected action is not offered.");
        execution = "executed";
      }

      if (execution === "executed") {
        failureStage = "execution";
        const correct = selectedAction;
        if (correct === undefined) throw new Error("Selected action is not offered.");
        let assessment: "correct" | "wrong" | "neutral" | null = null;
        let stepError: string | null = null;
        try {
          assessment =
            correct.node === undefined
              ? null
              : await owned
                  .call("Runtime.evaluate", {
                    expression: `(() => { const el=window.__jevFast.nodes.get(${correct.node}); if(!el) return null; if(el.hasAttribute('data-correct')) return 'correct'; if(el.hasAttribute('data-target')) return 'wrong'; return 'neutral'; })()`,
                    returnByValue: true,
                  })
                  .then((response: any) => response.result?.value ?? null);
          await owned.act(correct, snapshot, selected.text ?? undefined);
          steps += 1;
        } catch (error) {
          stepError = error instanceof Error ? error.message : String(error);
          reason = stepError;
          failureStage = "execution";
        }
        if (
          firstScored === null &&
          stepError === null &&
          (assessment === "correct" || assessment === "wrong")
        )
          firstScored = assessment;
        trace.push({
          step,
          operation: selected.operation,
          target: selected.target,
          executed: stepError === null,
          assessment,
          valid: true,
          error: stepError,
          payload_chars: payloadChars,
        });
        if (stepError !== null) {
          status = "failed";
          break;
        }
        history.push({
          action: selected.operation,
          kind: correct.kind,
          text: selected.text,
          page_changed: null,
        });
        failureStage = "oracle";
        evidence = await readEvidence(owned, task.success);
        wrongTargets = evidence.wrong_targets;
        mutationCount = evidence.mutation_count;
        if (evaluateSuccess(evidence, task.success)) {
          correctTargets = 1;
          goalHeld = true;
        }
      }
      if (goalHeld && options.provider === "scripted") {
        // The deterministic driver stops the moment the oracle holds; the policy never ran,
        // so completion is by construction rather than a policy DONE.
        status = "done";
        reason = "Scripted control reached the goal.";
        break;
      }

      if (step === plan.maxSteps) {
        if (status === "failed") {
          // A scripted cell stops as soon as the goal holds; the policy never ran, so this
          // is completion by construction, not a policy DONE.
          status = goalHeld && options.provider === "scripted" ? "done" : "max-steps";
          reason =
            goalHeld && options.provider === "scripted"
              ? "Scripted control reached the goal."
              : "Step budget reached.";
        }
        break;
      }
    }
    if (status === "done" || status === "blocked") failureStage = null;
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error);
    status = "failed";
  } finally {
    try {
      await session?.close();
    } catch {
      /* The run result already carries the failure. */
    }
  }

  const done = status === "done" && reason.startsWith("Policy reported DONE after");
  const groundingSuccess = firstScored === "correct";
  return {
    schema_version: 4,
    record_type: "run",
    design: "relation-ablation-v1",
    experiment_id: options.experimentId,
    run_id: runId,
    task_id: task.id,
    arm: arm as ExperimentRecord["arm"],
    model: options.provider === "scripted" ? "scripted" : plan.model,
    started_at: startedAt,
    success: done,
    grounding_success: groundingSuccess,
    strict_task_success: done && groundingSuccess,
    status,
    reason,
    failure_stage: failureStage,
    steps,
    wrong_targets: wrongTargets,
    correct_targets: correctTargets,
    mutation_count: mutationCount,
    llm_calls: llmCalls,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    latency_ms: performance.now() - start,
    returned_models: [...returnedModels],
    first_payload: firstPayload,
    first_payload_chars: firstPayloadChars,
    trace,
    responses,
    metadata: {
      ...gitMetadata(),
      browser_version: plan.browserVersion,
      node_version: process.version,
      task_hash: sha256(JSON.stringify(task)),
      fixture_hash: options.fixtureHash,
      source_hash: options.sourceHash,
      system_prompt_hash: digest(`${SYSTEM_PROMPT}\n${TASK_PROMPT_FORMAT}`),
    },
  };
}

export interface ExperimentRunResult {
  records: ExperimentRecord[];
  files: { arm: string; path: string; records: number }[];
}

export async function runExperiment(options: {
  cohortPath: string;
  tasksPath: string;
  outputDir: string;
  provider: "scripted" | "model";
  browserUrl: string;
  limit?: number;
  freezePath?: string;
}): Promise<ExperimentRunResult> {
  const plan = parseExperimentCohort(
    JSON.parse(await readFile(options.cohortPath, "utf8")),
  );
  const tasks = parseExperimentTasks(
    JSON.parse(await readFile(options.tasksPath, "utf8")),
  );
  if (options.provider === "model") {
    if (plan.browserVersion === null)
      throw new Error("Pin browserVersion before model dispatch.");
    if (!options.freezePath)
      throw new Error("A verified freeze manifest is required before model dispatch.");
    const { verifyFreeze } = await import("./freeze.ts");
    await verifyFreeze(options.freezePath, options.cohortPath);
    apiKey(plan);
  }
  const fileModel = options.provider === "scripted" ? "scripted" : plan.model;
  await mkdir(options.outputDir, { recursive: true });
  const prefix = `${options.outputDir}/${plan.id}-${fileModel}`;
  const planPath = `${prefix}-cohort-plan.json`;
  const resultPaths = plan.arms.map((arm) => `${prefix}-${arm}.jsonl`);
  for (const path of [planPath, ...resultPaths]) {
    try {
      await readFile(path);
      throw new Error(`Result already exists: ${path}; choose a new output directory.`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const experimentId = randomUUID();
  await writeFile(
    planPath,
    JSON.stringify({
      experiment_id: experimentId,
      cohort: plan,
      freeze_path: options.freezePath ?? null,
      status: "running",
      expected_cells: tasks.length * plan.arms.length,
      completed_cells: 0,
      provider: options.provider,
    }),
    { flag: "wx" },
  );
  for (const path of resultPaths) await writeFile(path, "", { flag: "wx" });
  const writers = new Map(
    plan.arms.map((arm, i) => [arm, resultWriter(resultPaths[i]!)]),
  );
  const connection = await connectBrowser(parseBrowserUrl(options.browserUrl));
  const fixtures = await startFixtures(plan.fixturePort).catch(async (error) => {
    await connection.close();
    throw error;
  });
  const data: { arm: string; record: ExperimentRecord }[] = [];
  let llmCalls = 0;
  let stopped: string | null = null;
  let product: string | null = null;
  try {
    const browser = await connection.client.send("Browser.getVersion");
    product = typeof browser.product === "string" ? browser.product : null;
    if (plan.browserVersion === null)
      console.log(
        `Browser not pinned in the plan; observed ${product}. Set browserVersion before freezing.`,
      );
    else if (plan.browserVersion !== product)
      throw new Error(`Browser version differs from the frozen plan: ${product}`);
    const fixtureHash = await hashTree(`${fixtureRoot}/relation-ablation-v1`);
    const actualPlan = { ...plan, browserVersion: product };
    const sourceHash = await sourceHashTree();
    // The plan covers every task x arm; `--smoke` truncates that full block.
    const work = schedule(tasks, plan.arms)
      .map((cell, index) => ({ ...cell, index }))
      .filter((cell) => options.limit === undefined || cell.index < options.limit);
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < work.length && !stopped) {
        const cell = work[cursor++]!;
        if (options.provider === "model") {
          try {
            await (
              await import("./freeze.ts")
            ).verifyFreeze(options.freezePath!, options.cohortPath);
          } catch (error) {
            stopped = String(error);
            break;
          }
        }
        if (options.provider === "model" && llmCalls >= plan.maxLlmCalls) {
          stopped = "Cohort LLM call budget reached.";
          break;
        }
        const record = await runCell({
          connection,
          fixturesUrl: fixtures.url,
          plan: actualPlan,
          task: cell.task,
          arm: cell.arm,
          provider: options.provider,
          experimentId,
          fixtureHash,
          sourceHash,
          beforeCall: () => {
            if (stopped) throw new Error(stopped);
            if (llmCalls >= plan.maxLlmCalls) {
              stopped = "Cohort LLM call budget reached.";
              throw new Error(stopped);
            }
            llmCalls += 1;
          },
        });
        await writers.get(cell.arm as (typeof plan.arms)[number])!(
          `${JSON.stringify(record)}\n`,
        );
        data.push({ arm: cell.arm, record });
        if (
          options.provider === "model" &&
          record.returned_models.some((model) => model !== plan.model)
        )
          stopped = `Provider returned a different model; block stopped: ${record.returned_models.join(", ")}`;
        if (record.failure_stage === "provider")
          stopped = `Provider failure: ${record.reason}`;
        console.log(
          `${cell.index + 1}/${work.length} ${record.grounding_success ? "GROUNDED" : "UNGROUNDED"} ${cell.arm} ${record.task_id} status=${record.status} steps=${record.steps} wrong=${record.wrong_targets}`,
        );
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(plan.concurrency, plan.arms.length) }, worker),
    );
  } finally {
    await connection.close();
    await fixtures.close();
  }
  await mkdir(options.outputDir, { recursive: true });
  const files: ExperimentRunResult["files"] = plan.arms.map((arm, i) => ({
    arm,
    path: resultPaths[i]!,
    records: data.filter((entry) => entry.arm === arm).length,
  }));
  await writeFile(
    planPath,
    `${JSON.stringify(
      {
        experiment_id: experimentId,
        provider: options.provider,
        status:
          stopped || data.length !== tasks.length * plan.arms.length
            ? "incomplete"
            : "complete",
        freeze_path: options.freezePath ?? null,
        cohort: plan,
        expected_cells: tasks.length * plan.arms.length,
        completed_cells: data.length,
        stopped,
        llm_calls: llmCalls,
        credential_label: plan.credentialLabel,
        same_endpoint_as_history: plan.sameEndpointAsHistory,
        fixture_hash: await hashTree(`${fixtureRoot}/relation-ablation-v1`),
        source_hash: await sourceHashTree(),
        browser_version: product,
        git: gitMetadata(),
      },
      null,
      2,
    )}\n`,
  );
  return { records: data.map((entry) => entry.record), files };
}

/** Hashes the new block plus the frozen primitives it reads; never writes to them. */
export async function sourceHashTree(): Promise<string> {
  const { preparationFiles } = await import("./freeze.ts");
  return sha256(JSON.stringify(await preparationFiles()));
}
