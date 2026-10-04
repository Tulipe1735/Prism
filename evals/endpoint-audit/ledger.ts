import type { ResultRecord, StepRecord, SummaryRecord } from "../schema.ts";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resultSchema } from "../schema.ts";

/**
 * P0-C: derived endpoint ledger over the frozen confirmatory, replication and external
 * trajectories. This module reads the frozen JSONL and writes only new derived output.
 * It never re-scores a frozen record, never rewrites a step or summary, and never calls a
 * model. See docs/research/research-audit-2026-10-04.md section 11 (P0-C).
 */
export const DESIGN = "endpoint-audit-v1" as const;

export interface LedgerRow {
  cohort: string;
  run_id: string;
  task_id: string;
  variant: string;
  representation: string;
  repetition: number;
  model: string;
  /** Endpoints, derived from the frozen records without re-scoring. */
  success: boolean;
  grounding_success: boolean | null;
  strict_task_success: boolean | null;
  status: string;
  termination: "done" | "blocked" | "budget" | "failed";
  /** Coverage. */
  steps: number;
  executed_steps: number;
  scored_steps: number;
  attempts: number;
  valid_proposals: number;
  invalid_outputs: number;
  invalid_actions: number;
  no_scored_attempt: boolean;
  /** Target identity. */
  first_scored_assessment: "correct" | "wrong" | null;
  correct_selections: number;
  wrong_executions: number;
  wrong_selections: number;
  any_wrong_execution: boolean;
  /** Argument and state. */
  evidence_passed: number;
  evidence_total: number;
  evidence_complete: boolean;
  mutation_count: number | null;
  evidence_recorded: boolean;
  /** Derived failure, always reported next to the original label. */
  original_failure: string | null;
  derived_failure: string;
  /** Why the run stopped, independently of the failure label. */
  terminal_cause: "done" | "model-blocked" | "step-budget" | "task-deadline" | "error";
  /** Whether the summary carries a complete receipt for its own model calls. */
  receipt_complete: boolean;
  grounded_then_strict_failed: boolean;
  infrastructure_events: string[];
  reason: string;
  grounded_then_terminal_failure: boolean;
}

export interface CohortFile {
  cohort: string;
  path: string;
  rows: ResultRecord[];
}

export async function loadCohort(path: string): Promise<CohortFile> {
  const text = await readFile(path, "utf8");
  const rows: ResultRecord[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (!line.trim()) continue;
    try {
      rows.push(resultSchema.parse(JSON.parse(line)));
    } catch (error) {
      throw new Error(
        `${path}:${index + 1} failed the frozen schema: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return {
    cohort: path
      .split("/")
      .pop()!
      .replace(/\.jsonl$/, ""),
    path,
    rows,
  };
}

export function recordsFor(rows: ResultRecord[]): {
  summaries: SummaryRecord[];
  steps: StepRecord[];
} {
  const summaries: SummaryRecord[] = [];
  const steps: StepRecord[] = [];
  for (const row of rows) {
    if (row.record_type === "summary") summaries.push(row);
    else steps.push(row);
  }
  return { summaries, steps };
}

export function stepsForRun(steps: StepRecord[], runId: string): StepRecord[] {
  return steps.filter((step) => step.run_id === runId).sort((a, b) => a.step - b.step);
}

/**
 * Derived failure label. The order is fixed before the analysis: an explicit provider or
 * endpoint event first, because the external adapter records such an event only when a
 * request actually failed and does not record every receipt; then a rejected model output,
 * an invalid action, a failed selector; then the terminal state. Full-trajectory outcomes
 * are covered by `terminal_cause` and `coverage_note` next to the record, so a provider
 * event never erases the fact that the recorded label said something else.
 */
export function derivedFailure(summary: SummaryRecord, steps: StepRecord[]): string {
  const events = new Set((summary.infrastructure_failures ?? []).map(String));
  if (events.has("PROVIDER_TIMEOUT")) return "PROVIDER_TIMEOUT";
  if (events.has("PROVIDER_HTTP_ERROR")) return "PROVIDER_HTTP_ERROR";
  if (events.has("ENDPOINT_FAILURE")) return "ENDPOINT_FAILURE";
  if (summary.invalid_outputs > 0) return "INVALID_OUTPUT";
  if (
    summary.invalid_actions > 0 &&
    steps.some((step) => step.action_attempt && step.valid === false)
  )
    return "INVALID_ACTION";
  if (summary.invalid_selectors > 0) return "INVALID_SELECTOR";
  if (summary.stale_events > 0 && summary.stale_recoveries < summary.stale_events)
    return "STALE_UNRECOVERED";
  const correctIndex = steps.findIndex((step) => step.target_assessment === "correct");
  const wrongAfterCorrect =
    correctIndex >= 0 &&
    steps.slice(correctIndex + 1).some((step) => step.target_assessment === "wrong");
  if (summary.success) return "NONE";
  if (correctIndex >= 0) {
    if (wrongAfterCorrect) return "POST_GROUNDING_WRONG_ACTION";
    if (summary.status === "blocked") return "POST_GROUNDING_BLOCKED";
    if (/budget/i.test(summary.reason)) return "POST_GROUNDING_BUDGET";
    if (summary.status === "done") return "GOAL_STATE_INCOMPLETE";
    return "POST_GROUNDING_TERMINAL";
  }
  if (steps.some((step) => step.target_assessment === "wrong"))
    return "WRONG_EXECUTED_INPUT";
  if (!steps.some((step) => step.executed)) return "NO_EXECUTED_INPUT";
  if (summary.status === "blocked") return "BLOCKED_BEFORE_GROUNDING";
  if (/budget/i.test(summary.reason)) return "BUDGET_BEFORE_GROUNDING";
  return "UNKNOWN";
}

export function ledgerRow(
  file: CohortFile,
  summary: SummaryRecord,
  steps: StepRecord[],
): LedgerRow {
  const targeted = steps.filter(
    (step) =>
      step.target_assessment === "correct" || step.target_assessment === "wrong",
  );
  const first = steps.find((step) => step.executed && step.target_assessment !== null);
  const evidence = summary.evidence;
  const scored = steps.filter(
    (step) => step.target_assessment !== null && step.executed,
  );
  const derived = derivedFailure(summary, steps);
  return {
    cohort: file.cohort,
    run_id: summary.run_id,
    task_id: summary.task_id,
    variant: summary.variant,
    representation: summary.metadata.representation,
    repetition: summary.repetition,
    model: summary.metadata.model,
    success: summary.success,
    grounding_success: summary.grounding_success ?? null,
    strict_task_success: summary.strict_task_success ?? null,
    status: summary.status,
    termination:
      summary.status === "done"
        ? "done"
        : summary.status === "blocked"
          ? /budget/i.test(summary.reason)
            ? "budget"
            : "blocked"
          : "failed",
    steps: summary.steps,
    executed_steps: steps.filter((step) => step.executed).length,
    scored_steps: scored.length,
    attempts: summary.attempts,
    valid_proposals: steps.filter((step) => step.validation_valid === true).length,
    invalid_outputs: summary.invalid_outputs,
    invalid_actions: summary.invalid_actions,
    no_scored_attempt: scored.length === 0,
    first_scored_assessment:
      first?.target_assessment === "correct" || first?.target_assessment === "wrong"
        ? first.target_assessment
        : null,
    correct_selections: summary.correct_target_selections,
    wrong_executions: summary.wrong_target_actions ?? 0,
    wrong_selections: targeted.filter((step) => step.target_assessment === "wrong")
      .length,
    any_wrong_execution: (summary.wrong_target_actions ?? 0) > 0,
    evidence_passed: evidence?.checks.filter((check) => check.passed).length ?? 0,
    evidence_total: evidence?.checks.length ?? 0,
    evidence_complete:
      evidence !== null && evidence.checks.every((check) => check.passed),
    mutation_count: evidence?.mutation_count ?? null,
    evidence_recorded: evidence !== null,
    original_failure: summary.failure_type,
    derived_failure: derived,
    terminal_cause:
      summary.status === "done"
        ? "done"
        : /wall-clock budget/i.test(summary.reason)
          ? "task-deadline"
          : /action budget/i.test(summary.reason)
            ? "step-budget"
            : summary.status === "blocked"
              ? "model-blocked"
              : "error",
    receipt_complete:
      summary.total_tokens !== null && summary.llm_calls > 0 && summary.steps > 0,
    grounded_then_strict_failed:
      (summary.grounding_success ?? false) && !(summary.strict_task_success ?? false),
    infrastructure_events: [
      ...new Set((summary.infrastructure_failures ?? []).map(String)),
    ],
    reason: summary.reason,
    grounded_then_terminal_failure:
      (summary.grounding_success ?? false) && summary.status !== "done",
  };
}

export interface CohortAudit {
  cohort: string;
  path: string;
  sha256: string;
  summaries: number;
  steps: number;
  ledger: LedgerRow[];
  /** Runs whose recorded summary is not self-consistent. */
  inconsistencies: string[];
}

export async function auditCohort(path: string): Promise<CohortAudit> {
  const file = await loadCohort(path);
  const { summaries, steps } = recordsFor(file.rows);
  const ledger = summaries.map((summary) =>
    ledgerRow(file, summary, stepsForRun(steps, summary.run_id)),
  );
  const inconsistencies: string[] = [];
  for (const summary of summaries) {
    const runSteps = stepsForRun(steps, summary.run_id);
    const executed = runSteps.filter((step) => step.executed).length;
    if (executed !== summary.steps)
      inconsistencies.push(
        `${summary.run_id}: summary.steps=${summary.steps} but ${executed} executed steps`,
      );
    const wrong = runSteps.filter((step) => step.wrong_target === true).length;
    if (summary.wrong_target_actions !== null && wrong !== summary.wrong_target_actions)
      inconsistencies.push(
        `${summary.run_id}: summary.wrong_target_actions=${summary.wrong_target_actions} but ${wrong} wrong steps`,
      );
    const recordedGrounding = summary.grounding_success ?? null;
    if (recordedGrounding !== null) {
      const first = runSteps.find(
        (step) => step.executed && step.target_assessment !== null,
      );
      const derived =
        first?.target_assessment === "correct" && first.wrong_target === false;
      if (derived !== recordedGrounding)
        inconsistencies.push(
          `${summary.run_id}: recorded grounding=${recordedGrounding} but first scored execution is ${first?.target_assessment ?? "absent"}`,
        );
    }
  }
  return {
    cohort: file.cohort,
    path,
    sha256: createHash("sha256")
      .update(await readFile(path))
      .digest("hex"),
    summaries: summaries.length,
    steps: steps.length,
    ledger,
    inconsistencies,
  };
}

export function countBy<T extends string | number>(
  values: T[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) out[String(value)] = (out[String(value)] ?? 0) + 1;
  return out;
}

/** Arm-to-arm endpoint comparison on the same task and repetition. */
export function endpointPair(
  ledger: LedgerRow[],
  treatment: string,
  control: string,
  endpoint: (row: LedgerRow) => number,
): { tasks: number; mean: number; treatment: string; control: string } | null {
  const lookup = new Map(
    ledger.map((row) => [`${row.task_id}/${row.repetition}/${row.variant}`, row]),
  );
  const differences: number[] = [];
  for (const row of ledger) {
    if (row.variant !== treatment) continue;
    const other = lookup.get(`${row.task_id}/${row.repetition}/${control}`);
    if (other === undefined) continue;
    differences.push(endpoint(row) - endpoint(other));
  }
  if (!differences.length) return null;
  return {
    tasks: differences.length,
    mean: differences.reduce((total, value) => total + value, 0) / differences.length,
    treatment,
    control,
  };
}
