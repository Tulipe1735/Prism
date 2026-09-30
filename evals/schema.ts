import { z } from "zod";

export const categorySchema = z.enum([
  "grounding",
  "stale",
  "ambiguity",
  "navigation",
  "form",
  "long-horizon",
]);
export const variantSchema = z.enum([
  "prism-full",
  "prism-no-stale-recovery",
  "prism-no-validation",
  "raw-selector",
  "indexed-compact",
  "indexed-role",
  "indexed-local",
  "indexed-structural",
  "indexed-adaptive",
]);
export const providerSchema = z.enum(["scripted", "model"]);
export const failureTypeSchema = z.enum([
  "ACTION_GROUNDING_ERROR",
  "SEMANTIC_AMBIGUITY",
  "INVALID_ACTION",
  "STALE_TARGET",
  "NAVIGATION_RACE",
  "OBSERVATION_ERROR",
  "DECISION_ERROR",
  "EXECUTION_ERROR",
  "BUDGET_EXCEEDED",
  "MODEL_OUTPUT_ERROR",
  "UNKNOWN",
]);
export type FailureType = z.infer<typeof failureTypeSchema>;
export type Variant = z.infer<typeof variantSchema>;
export type Provider = z.infer<typeof providerSchema>;

export const representationSchema = z.enum([
  "role",
  "compact",
  "local",
  "structural",
  "selector-dom",
  "adaptive",
]);
export const cohortSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    model: z.string().min(1),
    baseUrl: z.url().refine((value) => {
      const url = new URL(value);
      return !url.username && !url.password && !url.search && !url.hash;
    }, "Use an endpoint without credentials or query parameters"),
    apiKeyEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    temperature: z.number().min(0).max(2),
    topP: z.number().gt(0).max(1),
    maxTokens: z.number().int().positive(),
    reasoning: z.literal("provider-default"),
    repeats: z.number().int().positive(),
    maxSteps: z.number().int().positive(),
    httpRetries: z.literal(2),
    staleRetries: z.literal(5),
    viewport: z.object({ width: z.literal(1120), height: z.literal(780) }).strict(),
    browserVersion: z.string().min(1).nullable(),
    observation: z.enum(["matched-dom", "native", "action-representation"]),
    modalPolicy: z.enum(["observed", "active-dialog"]),
    repetitionOffset: z.number().int().nonnegative(),
    variants: z
      .array(variantSchema)
      .min(1)
      .refine((values) => new Set(values).size === values.length, "Duplicate variant"),
    tasks: z.string().min(1),
    categories: z.array(categorySchema).min(1),
    fixturePort: z.number().int().min(1024).max(65535),
    timeoutMs: z.number().int().positive().max(2147483647),
    concurrency: z.number().int().min(1).max(8),
    maxLlmCalls: z.number().int().positive(),
  })
  .strict()
  .refine(
    (cohort) =>
      cohort.observation !== "native" || !cohort.variants.includes("raw-selector"),
    "Raw selectors need DOM evidence",
  )
  .refine(
    (cohort) =>
      cohort.observation !== "action-representation" ||
      (cohort.modalPolicy === "observed" &&
        cohort.variants.every((v) => v.startsWith("indexed-") || v === "raw-selector")),
    "Representation studies must not include reliability ablations",
  );
export type Cohort = z.infer<typeof cohortSchema>;
export const adaptiveLevelSchema = z.enum(["compact", "role", "local", "structural"]);
const collisionGroupSchema = z
  .object({
    operation: z.string(),
    description: z.string(),
    candidates: z.array(z.string()).min(2),
  })
  .strict();
export const adaptiveSchema = z
  .object({
    initial_level: z.literal("compact"),
    // Maximum used level; individual candidates can remain at cheaper levels.
    final_level: adaptiveLevelSchema,
    number_of_candidates: z.number().int().nonnegative(),
    compact_collided: z.boolean(),
    role_collided: z.boolean(),
    local_collided: z.boolean(),
    compact_collisions: z.number().int().nonnegative(),
    role_collisions: z.number().int().nonnegative(),
    local_collisions: z.number().int().nonnegative(),
    structural_required: z.boolean(),
    unresolved_ambiguity: z.boolean(),
    collision_groups: z
      .object({
        compact: z.array(collisionGroupSchema),
        role: z.array(collisionGroupSchema),
        local: z.array(collisionGroupSchema),
        structural: z.array(collisionGroupSchema),
      })
      .strict(),
    candidate_levels: z.record(z.string(), z.record(z.string(), adaptiveLevelSchema)),
    unresolved_groups: z.array(collisionGroupSchema),
    representation_characters: z.number().int().nonnegative(),
    estimated_representation_tokens: z.number().int().nonnegative(),
  })
  .strict();
export type AdaptiveLevel = z.infer<typeof adaptiveLevelSchema>;
export type AdaptiveMetadata = z.infer<typeof adaptiveSchema>;

export const modelInputSchema = z.object({
  goal: z.string(),
  page: z.object({ url: z.string(), title: z.string(), text: z.string() }),
  dom: z.string().nullable(),
  dom_truncated: z.boolean(),
  representation: representationSchema,
  /** Audit metadata only: never included in the model request. */
  adaptive: adaptiveSchema.optional(),
  target_mode: z.enum(["indexed", "selector"]),
  targets: z.record(z.string(), z.record(z.string(), z.string())),
  operations: z.record(z.string(), z.string()),
  history: z.array(
    z.object({
      action: z.string(),
      kind: z.string(),
      text: z.string().nullable(),
      page_changed: z.boolean().nullable(),
    }),
  ),
});
export type ModelInput = z.infer<typeof modelInputSchema>;

const selector = z.string().min(1);
export const checkSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), selector, equals: z.string() }).strict(),
  z.object({ kind: z.literal("value"), selector, equals: z.string() }).strict(),
  z
    .object({
      kind: z.literal("attribute"),
      selector,
      attribute: z.string().min(1),
      equals: z.string(),
    })
    .strict(),
  z.object({ kind: z.literal("url"), equals: z.string() }).strict(),
]);
export const successSchema = z
  .object({
    checks: z.array(checkSchema).min(1),
    /** A monotonic fixture counter. Absent counters produce unknown, never zero. */
    wrongTargetCounter: z
      .object({ selector, attribute: z.string().min(1) })
      .strict()
      .optional(),
  })
  .strict();
export const taskSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    url: z.string().refine((value) => {
      if (/^\/(?!\/)/.test(value)) return true;
      try {
        return ["http:", "https:"].includes(new URL(value).protocol);
      } catch {
        return false;
      }
    }, "Expected an HTTP(S) URL or fixture path beginning with /"),
    goal: z.string().min(1),
    category: categorySchema,
    maxSteps: z.number().int().positive().optional(),
    success: successSchema,
    fixture: z
      .object({
        mutateAfterDecision: z.boolean().default(false),
        mutationCount: z.number().int().nonnegative().default(0),
      })
      .strict()
      .optional(),
    /** The deterministic driver uses labels from the actual observed action space. */
    script: z
      .array(
        z
          .object({
            kind: z.enum(["click", "fill", "select", "wait", "scroll"]),
            label: z.string().min(1),
            text: z.string().optional(),
          })
          .strict(),
      )
      .min(1)
      .optional(),
    /** Controlled malformed distribution, for a validation safety experiment. */
    fault: z.literal("non-argmax-target").optional(),
  })
  .strict();
export type EvalTask = z.infer<typeof taskSchema>;
export type SuccessCondition = z.infer<typeof successSchema>;

const nonnegative = z.number().int().nonnegative();
export const representationCostSchema = z
  .object({
    candidates: nonnegative,
    characters: nonnegative,
    estimated_tokens: nonnegative,
    estimator: z.literal("utf8-bytes-div-4"),
    chars_per_candidate: z.number().nonnegative(),
    estimated_tokens_per_candidate: z.number().nonnegative(),
  })
  .strict();
export type RepresentationCost = z.infer<typeof representationCostSchema>;
const common = {
  schema_version: z.literal(3),
  experiment_id: z.string().uuid(),
  task_id: z.string(),
  run_id: z.string().uuid(),
  variant: variantSchema,
  provider: providerSchema,
  category: categorySchema,
  repetition: nonnegative,
};
export const stepSchema = z
  .object({
    ...common,
    record_type: z.literal("step"),
    step: nonnegative,
    action_step: nonnegative,
    action: z.string().nullable(),
    target: z.string().nullable(),
    selected_target: z
      .object({ action_id: z.string(), node: z.number().nullable(), label: z.string() })
      .nullable(),
    action_attempt: z.boolean(),
    valid: z.boolean().nullable(),
    validation_valid: z.boolean().nullable(),
    executed: z.boolean(),
    wrong_target: z.boolean().nullable(),
    retry_count: nonnegative,
    http_retries: nonnegative,
    stale_detected: z.boolean(),
    stale_events: nonnegative,
    stale_recoveries: nonnegative,
    latency_ms: z.number().nonnegative(),
    decision_calls: nonnegative,
    llm_calls: nonnegative,
    models: z.array(z.string()),
    usage: z.array(z.record(z.string(), z.unknown())),
    status: z.enum(["executed", "terminal", "stale", "failed", "unexecuted"]),
    failure_type: failureTypeSchema.nullable(),
    error: z.string().nullable(),
    selector: z.string().nullable(),
    selector_valid: z.boolean().nullable(),
    selector_failure: z
      .enum(["syntax", "no-match", "multiple-match", "ineligible"])
      .nullable(),
    confidence: z.number().nullable(),
    target_confidence: z.number().nullable(),
    target_assessment: z.enum(["correct", "wrong", "neutral"]).nullable(),
    model_input: modelInputSchema.nullable(),
    representation_cost: representationCostSchema.nullable(),
    adaptive: adaptiveSchema.nullable().optional(),
    prompt_hash: z.string().nullable(),
    raw_model_output: z.string().nullable(),
    system_fingerprint: z.string().nullable(),
    provider_error: z.string().nullable(),
    input_tokens: nonnegative.nullable(),
    output_tokens: nonnegative.nullable(),
    total_tokens: nonnegative.nullable(),
  })
  .strict();
export type StepRecord = z.infer<typeof stepSchema>;

export const evidenceSchema = z.object({
  checks: z.array(
    z.object({
      expected: z.string(),
      actual: z.string().nullable(),
      passed: z.boolean(),
    }),
  ),
  wrong_targets: nonnegative.nullable(),
  mutation_count: nonnegative.nullable(),
});
export type Evidence = z.infer<typeof evidenceSchema>;
export const summarySchema = z
  .object({
    ...common,
    record_type: z.literal("summary"),
    success: z.boolean(),
    status: z.enum(["done", "blocked", "failed"]),
    reason: z.string(),
    steps: nonnegative,
    attempts: nonnegative,
    invalid_actions: nonnegative,
    invalid_outputs: nonnegative,
    invalid_selectors: nonnegative,
    selector_attempts: nonnegative,
    target_attempts: nonnegative,
    scored_target_attempts: nonnegative,
    correct_target_selections: nonnegative,
    grounding_errors: nonnegative,
    input_tokens: nonnegative.nullable(),
    output_tokens: nonnegative.nullable(),
    total_tokens: nonnegative.nullable(),
    wrong_target_actions: nonnegative.nullable(),
    grounding_observed_actions: nonnegative,
    decision_calls: nonnegative,
    llm_calls: nonnegative,
    retries: nonnegative,
    http_retries: nonnegative,
    stale_events: nonnegative,
    stale_recoveries: nonnegative,
    latency_ms: z.number().nonnegative(),
    failure_type: failureTypeSchema.nullable(),
    evidence: evidenceSchema.nullable(),
    final_url: z.string().nullable(),
    representation_observations: nonnegative,
    representation_candidates_total: nonnegative,
    representation_chars_total: nonnegative,
    representation_estimated_tokens_total: nonnegative,
    metadata: z
      .object({
        started_at: z.string(),
        task_hash: z.string(),
        fixture_hash: z.string().nullable(),
        source_hash: z.string(),
        git_commit: z.string().nullable(),
        git_dirty: z.boolean().nullable(),
        node_version: z.string(),
        prism_version: z.string(),
        browser_version: z.string().nullable(),
        model: z.string(),
        text_model: z.string(),
        max_steps: nonnegative,
        timeout_ms: nonnegative,
        cohort: cohortSchema.nullable(),
        cohort_hash: z.string().nullable(),
        system_prompt_hash: z.string().nullable(),
        task_prompt_hash: z.string(),
        policy: z.enum(["typesafe-scripted", "chat-heads-v2"]),
        representation: representationSchema,
        returned_models: z.array(z.string()),
      })
      .strict(),
  })
  .strict();
export type SummaryRecord = z.infer<typeof summarySchema>;
export const resultSchema = z.discriminatedUnion("record_type", [
  stepSchema,
  summarySchema,
]);
export type ResultRecord = z.infer<typeof resultSchema>;

export function parseTasks(value: unknown): EvalTask[] {
  const tasks = z.array(taskSchema).min(1).parse(value);
  const ids = tasks.map((task) => task.id);
  if (new Set(ids).size !== ids.length)
    throw new Error("Duplicate evaluation task id.");
  return tasks;
}
