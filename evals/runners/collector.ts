import type { AgentEvent, StaleEvent } from "../../src/runtime/agent.ts";
import type { Decision } from "../../src/shared/types.ts";
import type {
  EvalTask,
  Evidence,
  ModelInput,
  StepRecord,
  SummaryRecord,
} from "../schema.ts";
import { validateChoice } from "../../src/runtime/decision.ts";
import { representationCost } from "./representation.ts";

export type RunIdentity = Pick<
  SummaryRecord,
  | "schema_version"
  | "experiment_id"
  | "task_id"
  | "run_id"
  | "variant"
  | "provider"
  | "category"
  | "repetition"
>;

/** One row per decision attempt (including rejected/terminal decisions), not just inputs. */
export class Collector {
  readonly rows: StepRecord[] = [];
  readonly identity: RunIdentity;
  private current: StepRecord | undefined;
  private started = 0;
  private previousWrongTargets: number | null;

  private readonly annotation?: EvalTask["preregistered"];

  constructor(
    identity: RunIdentity,
    initialEvidence: Evidence | null,
    annotation?: EvalTask["preregistered"],
  ) {
    this.identity = identity;
    this.annotation = annotation;
    this.previousWrongTargets = initialEvidence?.wrong_targets ?? null;
  }

  begin(actionStep: number): void {
    this.finish();
    this.create(actionStep).decision_calls = 1;
  }

  private create(actionStep: number): StepRecord {
    this.started = performance.now();
    this.current = {
      ...this.identity,
      record_type: "step",
      step: this.rows.length + 1,
      action_step: actionStep,
      action: null,
      target: null,
      selected_target: null,
      action_attempt: false,
      valid: null,
      validation_valid: null,
      executed: false,
      wrong_target: null,
      retry_count: 0,
      http_retries: 0,
      stale_detected: false,
      stale_events: 0,
      stale_recoveries: 0,
      latency_ms: 0,
      decision_calls: 0,
      llm_calls: 0,
      models: [],
      usage: [],
      status: "unexecuted",
      failure_type: null,
      error: null,
      selector: null,
      selector_valid: null,
      selector_failure: null,
      confidence: null,
      target_confidence: null,
      target_assessment: null,
      model_input: null,
      representation_cost: null,
      prompt_hash: null,
      raw_model_output: null,
      system_fingerprint: null,
      provider_error: null,
      input_tokens: null,
      output_tokens: null,
      total_tokens: null,
    };
    return this.current;
  }

  httpCall(isRetry: boolean): void {
    if (this.current === undefined)
      throw new Error("Model call outside decision attempt.");
    this.current.llm_calls += 1;
    if (isRetry) {
      this.current.http_retries += 1;
      this.current.retry_count += 1;
    }
  }

  /** Audit the raw selected heads even when the no-validation variant accepts them. */
  response(body: any, output: any, recordUsage = true): void {
    const row = this.current;
    if (row === undefined) throw new Error("Response outside decision attempt.");
    if (recordUsage && typeof output?.model === "string") row.models.push(output.model);
    if (
      recordUsage &&
      output?.usage &&
      typeof output.usage === "object" &&
      !Array.isArray(output.usage)
    )
      row.usage.push(output.usage);
    const answers = output?.answers;
    row.confidence =
      typeof answers?.operation?.confidence === "number"
        ? answers.operation.confidence
        : null;
    const operation = answers?.operation?.choice;
    row.action = typeof operation === "string" ? operation : null;
    row.action_attempt = operation !== "DONE" && operation !== "BLOCKED";
    const operations = body.questions.operation.criteria;
    const targetQuestion =
      typeof operation === "string"
        ? body.questions[`${operation.toLowerCase()}_target`]
        : undefined;
    const target =
      targetQuestion === undefined
        ? null
        : answers?.[`${operation.toLowerCase()}_target`]?.choice;
    row.target = typeof target === "string" ? target : null;
    row.target_confidence =
      typeof operation === "string" &&
      typeof answers?.[`${operation.toLowerCase()}_target`]?.confidence === "number"
        ? answers[`${operation.toLowerCase()}_target`].confidence
        : null;
    row.valid =
      typeof operation === "string" &&
      Object.hasOwn(operations, operation) &&
      (targetQuestion === undefined ||
        (typeof target === "string" && Object.hasOwn(targetQuestion.criteria, target)));
    try {
      validateChoice(answers?.operation, operations);
      if (targetQuestion !== undefined)
        validateChoice(
          answers?.[`${operation.toLowerCase()}_target`],
          targetQuestion.criteria,
        );
      row.validation_valid = true;
    } catch {
      row.validation_valid = false;
    }
  }

  infrastructure(
    label: "PROVIDER_TIMEOUT" | "PROVIDER_HTTP_ERROR" | "ENDPOINT_FAILURE",
    status: number | null = null,
  ): void {
    if (!this.current) throw new Error("Infrastructure event outside attempt.");
    (this.current.infrastructure_events ??= []).push({
      attempt: this.current.llm_calls,
      label,
      status,
    });
  }

  get infrastructureLabel():
    "PROVIDER_TIMEOUT" | "PROVIDER_HTTP_ERROR" | "ENDPOINT_FAILURE" | undefined {
    return this.current?.infrastructure_events?.at(-1)?.label;
  }

  providerError(message: string): void {
    if (this.current) this.current.provider_error = message;
  }

  prompt(input: ModelInput, hash: string): void {
    if (!this.current) throw new Error("Prompt outside attempt.");
    this.current.model_input = input;
    if (input.adaptive) {
      if (this.annotation)
        Object.assign(input.adaptive, {
          task_ambiguity_class: this.annotation.ambiguity_class,
          expected_minimum_level: this.annotation.minimum_level,
          matches_minimum_level:
            input.adaptive.final_level === this.annotation.minimum_level,
          task_phase: this.rows.some(
            (r) => r.executed && r.target_assessment === "correct",
          )
            ? "post-grounding"
            : "pre-grounding",
        });
      this.current.adaptive = input.adaptive;
    }
    this.current.representation_cost = representationCost(input);
    this.current.prompt_hash = hash;
  }

  chatResponse(output: any, content: string | null): void {
    if (!this.current) throw new Error("Response outside attempt.");
    const row = this.current;
    if (typeof output?.model === "string") row.models.push(output.model);
    if (output?.usage && typeof output.usage === "object") row.usage.push(output.usage);
    row.raw_model_output = content;
    row.system_fingerprint =
      typeof output?.system_fingerprint === "string" ? output.system_fingerprint : null;
    const token = (key: string): number | null =>
      Number.isSafeInteger(output?.usage?.[key]) && output.usage[key] >= 0
        ? output.usage[key]
        : null;
    row.input_tokens = token("prompt_tokens");
    row.output_tokens = token("completion_tokens");
    row.total_tokens = token("total_tokens");
  }

  selector(
    value: string | null,
    valid: boolean | null,
    failure: StepRecord["selector_failure"],
  ): void {
    if (!this.current) throw new Error("Selector outside attempt.");
    this.current.selector = value ?? null;
    this.current.selector_valid = valid;
    this.current.selector_failure = failure;
    if (valid === false) this.current.valid = false;
  }

  assessment(value: StepRecord["target_assessment"]): void {
    if (!this.current) throw new Error("Assessment outside attempt.");
    this.current.target_assessment = value;
  }

  get awaitingAudit(): boolean {
    return this.current?.executed === true && this.current.wrong_target === null;
  }

  decision(decision: Decision, selected: StepRecord["selected_target"]): void {
    if (this.current === undefined) throw new Error("Decision outside attempt.");
    Object.assign(this.current, {
      action: decision.operation,
      target: decision.target,
      selected_target: selected,
      action_attempt: decision.choice !== "DONE" && decision.choice !== "BLOCKED",
      status:
        decision.choice === "DONE" || decision.choice === "BLOCKED"
          ? "terminal"
          : "unexecuted",
    });
  }

  helper(model: string, usage: Record<string, unknown>): void {
    if (this.current === undefined) throw new Error("Text helper outside attempt.");
    this.current.models.push(model);
    this.current.usage.push(usage);
  }

  stale(event: StaleEvent, recovery: boolean): void {
    if (this.current?.executed || this.current?.status === "terminal") this.finish();
    const row = this.current ?? this.create(event.step);
    row.stale_detected = true;
    row.stale_events += 1;
    row.retry_count += recovery ? 1 : 0;
    row.status = "stale";
    row.failure_type =
      event.stage === "page" || event.stage === "terminal"
        ? "NAVIGATION_RACE"
        : "STALE_TARGET";
    row.error = event.reason;
  }

  executed(evidence: Evidence | null): void {
    if (this.current === undefined) throw new Error("Execution outside attempt.");
    this.current.executed = true;
    this.current.status = "executed";
    const wrong = evidence?.wrong_targets ?? null;
    this.current.wrong_target =
      wrong === null || this.previousWrongTargets === null
        ? null
        : wrong > this.previousWrongTargets;
    if (evidence !== null) this.previousWrongTargets = wrong;
    if (this.current.wrong_target) {
      this.current.failure_type =
        this.identity.category === "ambiguity"
          ? "SEMANTIC_AMBIGUITY"
          : "ACTION_GROUNDING_ERROR";
    }
    // A recovery means a subsequent input at the same agent step actually executed.
    for (const row of this.rows) {
      if (row.action_step === this.current.action_step && row.stale_detected)
        row.stale_recoveries = row.stale_events;
    }
  }

  event(event: AgentEvent): void {
    if (event.type === "finished" && this.current) this.current.status = "terminal";
  }

  fail(type: StepRecord["failure_type"], error: unknown): void {
    const row = this.current ?? this.create(0);
    row.status = "failed";
    row.failure_type = type;
    if (type === "MODEL_OUTPUT_ERROR") row.validation_valid = false;
    row.error = error instanceof Error ? error.message : String(error);
  }

  finish(): void {
    if (this.current === undefined) return;
    this.current.latency_ms = performance.now() - this.started;
    this.rows.push(this.current);
    this.current = undefined;
  }
}
