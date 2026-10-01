import type { BrowserConnection } from "../../src/browser/connect.ts";
import type { BrowserSession } from "../../src/browser/session.ts";
import type { AgentResult } from "../../src/runtime/agent.ts";
import type { FailureStage } from "../failures.ts";
import type {
  Cohort,
  EvalTask,
  Evidence,
  Provider,
  StepRecord,
  SummaryRecord,
  Variant,
} from "../schema.ts";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import process from "node:process";
import { openBrowserSession } from "../../src/browser/session.ts";
import { runAgent } from "../../src/runtime/agent.ts";
import { VERSION } from "../../src/shared/version.ts";
import { classifyFailure } from "../failures.ts";
import { stepSchema, summarySchema } from "../schema.ts";
import { evaluateSuccess, readEvidence } from "../success.ts";
import { Collector } from "./collector.ts";
import { digest, SYSTEM_PROMPT, TASK_PROMPT_FORMAT } from "./model.ts";
import { createDependencies } from "./providers.ts";
import { filterModalObservation, representationFor } from "./representation.ts";

export function firstGroundingSuccess(rows: StepRecord[]): boolean {
  const first = rows.find(
    (r) => r.executed && ["correct", "wrong"].includes(r.target_assessment ?? ""),
  );
  return first?.target_assessment === "correct" && first.wrong_target === false;
}

export function hash(value: string): string {
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

export async function runOne(options: {
  connection: BrowserConnection;
  fixtureUrl: string;
  task: EvalTask;
  variant: Variant;
  provider: Provider;
  experimentId: string;
  repetition: number;
  output: string;
  metadata: Pick<
    SummaryRecord["metadata"],
    "git_commit" | "git_dirty" | "source_hash" | "fixture_hash" | "browser_version"
  >;
  timeoutMs: number;
  cohort?: Cohort;
  beforeCall?: () => void;
  writeRecords?: (data: string) => Promise<void>;
}): Promise<SummaryRecord> {
  const { task, variant, provider } = options;
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const identity = {
    schema_version: 3 as const,
    experiment_id: options.experimentId,
    task_id: task.id,
    run_id: randomUUID(),
    variant,
    provider,
    category: task.category,
    repetition: options.repetition,
  };
  let session: BrowserSession | undefined;
  let result: AgentResult | undefined;
  const state: { evidence: Evidence | null } = { evidence: null };
  let error: unknown;
  let stage: FailureStage = "setup";
  let timedOut = false;
  const abort = new AbortController();
  let collector = new Collector(identity, null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const work = (async () => {
    session = await openBrowserSession({
      url: new URL(task.url, options.fixtureUrl).href,
      client: options.connection.client,
    });
    if (abort.signal.aborted) {
      await session.close();
      abort.signal.throwIfAborted();
    }
    // Page.navigate can return while the initial document is still committing.
    if (task.url.startsWith("/")) {
      const deadline = performance.now() + 5_000;
      while (true) {
        abort.signal.throwIfAborted();
        const response = await session.call("Runtime.evaluate", {
          expression: "Boolean(window.__prismEval)",
          returnByValue: true,
        });
        if (response.result?.value === true) break;
        if (performance.now() >= deadline)
          throw new Error("Fixture did not become ready.");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    stage = "oracle";
    state.evidence = await readEvidence(session, task.success);
    collector = new Collector(identity, state.evidence, task.preregistered);
    let mutated = false;
    const ownedSession = session;
    const observe = session.observe.bind(session);
    session.observe = async (settings) => {
      abort.signal.throwIfAborted();
      stage = "observation";
      const observed = await observe(settings);
      const snapshot =
        options.cohort?.modalPolicy === "active-dialog"
          ? await filterModalObservation(ownedSession, observed)
          : observed;
      if (collector.awaitingAudit) {
        stage = "oracle";
        state.evidence = await readEvidence(ownedSession, task.success);
        collector.executed(state.evidence);
      }
      return snapshot;
    };
    const act = session.act.bind(session);
    session.act = async (...args) => {
      abort.signal.throwIfAborted();
      stage = "execution";
      await act(...args);
      collector.executed(null);
      stage = "oracle";
      state.evidence = await readEvidence(ownedSession, task.success);
      collector.executed(state.evidence);
      abort.signal.throwIfAborted();
    };
    result = await runAgent({
      session,
      goal: task.goal,
      maxSteps: task.maxSteps ?? 10,
      signal: abort.signal,
      staleRecovery: variant !== "prism-no-stale-recovery",
      onStale: (event) => collector.stale(event, variant !== "prism-no-stale-recovery"),
      onEvent: (event) => collector.event(event),
      dependencies: createDependencies({
        session: ownedSession,
        cohort: options.cohort,
        beforeCall: options.beforeCall,
        task,
        variant,
        provider,
        collector,
        signal: abort.signal,
        setStage: (value) => {
          stage = value;
        },
        afterDecision: async () => {
          if (task.fixture?.mutateAfterDecision && !mutated) {
            stage = "setup";
            mutated = true;
            const response = await ownedSession.call("Runtime.evaluate", {
              expression: "window.__prismEval.mutate()",
              returnByValue: true,
              awaitPromise: true,
            });
            if (response.exceptionDetails) throw new Error("Fixture mutation failed.");
          }
        },
      }),
    });
    stage = "oracle";
    state.evidence = await readEvidence(session, task.success);
  })();
  try {
    await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          abort.abort(new Error("Evaluation wall-clock budget exceeded."));
          reject(abort.signal.reason);
        }, options.timeoutMs);
      }),
    ]);
  } catch (caught) {
    error = caught;
    // Preserve the last concrete browser evidence, but never turn runtime failure into success.
  } finally {
    clearTimeout(timer);
    abort.abort();
    if (error !== undefined && session !== undefined && !timedOut) {
      try {
        state.evidence = await readEvidence(session, task.success);
      } catch {
        /* Preserve the original error and last available oracle evidence. */
      }
    }
    try {
      await session?.close();
    } catch (caught) {
      error ??= caught;
    }
  }
  const mutationMatched =
    task.fixture === undefined ||
    state.evidence?.mutation_count === task.fixture.mutationCount;
  const success =
    error === undefined &&
    result !== undefined &&
    state.evidence !== null &&
    evaluateSuccess(state.evidence, task.success) &&
    (!task.preregistered || result.status === "done") &&
    mutationMatched;
  const reason =
    error instanceof Error
      ? error.message
      : !mutationMatched
        ? "Fixture mutation count did not match the task definition."
        : (result?.reason ?? "Evaluation failed before execution.");
  const failureType = success
    ? null
    : classifyFailure({
        task,
        evidence: state.evidence,
        error,
        stage:
          !mutationMatched && error === undefined
            ? "decision"
            : error === undefined
              ? undefined
              : stage,
        reason,
        timedOut,
      });
  if (error !== undefined) collector.fail(failureType, error);
  collector.finish();
  const rows = collector.rows.map((row) => stepSchema.parse(row));
  const sum = (
    key:
      | "decision_calls"
      | "llm_calls"
      | "retry_count"
      | "http_retries"
      | "stale_events"
      | "stale_recoveries",
  ): number => rows.reduce((total, row) => total + row[key], 0);
  const summary = summarySchema.parse({
    ...identity,
    record_type: "summary",
    success,
    ...(task.preregistered
      ? {
          // First scored execution is the confirmatory grounding trial. Later corrections
          // never erase an earlier wrong input; terminal/provider errors are independent.
          grounding_success: firstGroundingSuccess(rows),
          strict_task_success: success && result?.status === "done",
          infrastructure_failures: [
            ...new Set(
              rows.flatMap((r) => (r.infrastructure_events ?? []).map((e) => e.label)),
            ),
          ],
        }
      : {}),
    status: error === undefined ? (result?.status ?? "failed") : "failed",
    reason,
    steps: rows.filter((row) => row.executed).length,
    attempts: rows.filter((row) => row.action_attempt).length,
    invalid_actions: rows.filter((row) => row.action_attempt && row.valid === false)
      .length,
    invalid_outputs: rows.filter((row) => row.validation_valid === false).length,
    invalid_selectors: rows.filter((r) => r.selector_valid === false).length,
    selector_attempts: rows.filter((r) => r.selector !== null).length,
    target_attempts: rows.filter((r) => r.selected_target !== null).length,
    scored_target_attempts: rows.filter(
      (r) => r.target_assessment === "correct" || r.target_assessment === "wrong",
    ).length,
    correct_target_selections: rows.filter((r) => r.target_assessment === "correct")
      .length,
    grounding_errors: rows.filter(
      (r) => r.target_assessment === "wrong" || r.selector_valid === false,
    ).length,
    ...Object.fromEntries(
      ["input_tokens", "output_tokens", "total_tokens"].map((key) => [
        key,
        rows.length &&
        rows.every((r) => r[key as "total_tokens"] !== null && r.llm_calls <= 1)
          ? rows.reduce((sum, r) => sum + r[key as "total_tokens"]!, 0)
          : null,
      ]),
    ),
    wrong_target_actions: state.evidence?.wrong_targets ?? null,
    grounding_observed_actions: rows.filter(
      (row) =>
        row.executed &&
        row.wrong_target !== null &&
        ["CLICK", "TYPE_TEXT", "SELECT"].includes(row.action ?? ""),
    ).length,
    decision_calls: sum("decision_calls"),
    llm_calls: sum("llm_calls"),
    retries: sum("retry_count"),
    http_retries: sum("http_retries"),
    stale_events: sum("stale_events"),
    stale_recoveries: sum("stale_recoveries"),
    latency_ms: performance.now() - start,
    failure_type: failureType,
    evidence: state.evidence,
    final_url: result?.finalUrl ?? null,
    representation_observations: rows.filter((r) => r.representation_cost !== null)
      .length,
    representation_candidates_total: rows.reduce(
      (s, r) => s + (r.representation_cost?.candidates ?? 0),
      0,
    ),
    representation_chars_total: rows.reduce(
      (s, r) => s + (r.representation_cost?.characters ?? 0),
      0,
    ),
    representation_estimated_tokens_total: rows.reduce(
      (s, r) => s + (r.representation_cost?.estimated_tokens ?? 0),
      0,
    ),
    metadata: {
      ...options.metadata,
      started_at: startedAt,
      task_hash: hash(JSON.stringify(task)),
      node_version: process.version,
      prism_version: VERSION,
      model: provider === "scripted" ? "scripted-typesafe" : options.cohort!.model,
      text_model: provider === "scripted" ? "scripted-text" : options.cohort!.model,
      max_steps: task.maxSteps ?? 10,
      timeout_ms: options.timeoutMs,
      cohort: options.cohort ?? null,
      cohort_hash: options.cohort ? hash(JSON.stringify(options.cohort)) : null,
      system_prompt_hash: provider === "model" ? digest(SYSTEM_PROMPT) : null,
      task_prompt_hash: digest(TASK_PROMPT_FORMAT),
      policy: provider === "model" ? "chat-heads-v2" : "typesafe-scripted",
      representation: representationFor(variant),
      returned_models: [...new Set(rows.flatMap((r) => r.models))],
    },
  });
  await mkdir(dirname(options.output), { recursive: true });
  const data = [...rows, summary].map((row) => `${JSON.stringify(row)}\n`).join("");
  if (options.writeRecords) await options.writeRecords(data);
  else await appendFile(options.output, data);
  return summary;
}
