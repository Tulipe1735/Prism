import type { EvalTask, Evidence, FailureType } from "./schema.ts";
import { ExecutionError, StalePageError } from "../src/browser/session.ts";
import { InvalidActionError, ModelOutputError } from "../src/shared/errors.ts";

export type FailureStage =
  "setup" | "observation" | "decision" | "execution" | "oracle";

export function classifyFailure(input: {
  error?: unknown;
  stage?: FailureStage;
  reason?: string;
  task: Pick<EvalTask, "category">;
  evidence?: Evidence | null;
  timedOut?: boolean;
}): FailureType {
  const { error, stage, reason = "", task, evidence } = input;
  // A concrete wrong click is stronger evidence than a later terminal/runtime error.
  if (evidence?.wrong_targets != null && evidence.wrong_targets > 0)
    return task.category === "ambiguity"
      ? "SEMANTIC_AMBIGUITY"
      : "ACTION_GROUNDING_ERROR";
  if (input.timedOut || /budget/i.test(reason)) return "BUDGET_EXCEEDED";
  if (error instanceof InvalidActionError) return "INVALID_ACTION";
  if (
    error instanceof ModelOutputError ||
    (error instanceof Error &&
      /returned invalid JSON; no action executed/.test(error.message))
  )
    return "MODEL_OUTPUT_ERROR";
  if (error instanceof StalePageError)
    return /document|navigat|URL/i.test(error.message)
      ? "NAVIGATION_RACE"
      : "STALE_TARGET";
  if (/page kept changing/i.test(reason)) return "STALE_TARGET";
  if (stage === "observation" || stage === "oracle") return "OBSERVATION_ERROR";
  if (error instanceof ExecutionError || stage === "execution")
    return "EXECUTION_ERROR";
  if (stage === "decision" || /model reported/i.test(reason)) return "DECISION_ERROR";
  return "UNKNOWN";
}
