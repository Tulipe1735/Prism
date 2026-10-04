import { z } from "zod";

/**
 * Frozen contract for the P0-A/P0-B relation ablation (see protocol.md).
 *
 * These schemas are deliberately separate from `evals/schema.ts`: the confirmatory,
 * replication and external evidence inventories hash those files, so this block carries
 * its own versioned contract instead of extending a frozen one.
 */
export const RELATION_DESIGN_VERSION = "relation-ablation-v1" as const;

export const relationEntrySchema = z
  .object({
    tag: z.number().int().positive(),
    text: z.string().min(1).max(24),
    scope: z.enum(["row", "card", "list-item", "fieldset", "group", "section"]),
  })
  .strict();
export type RelationEntry = z.infer<typeof relationEntrySchema>;
export const actionRelationsSchema = z.record(z.string(), z.array(relationEntrySchema));

export const experimentArmSchema = z.enum([
  "indexed-local",
  "indexed-unbound",
  "indexed-bound",
  "indexed-structural",
]);
export type ExperimentArm = z.infer<typeof experimentArmSchema>;

/**
 * Same oracle contract as the frozen `evals/schema.ts` success condition, redefined here
 * so this block never depends on a hashed file for its own validation.
 */
const selectorText = z.string().min(1);
const successSchemaForExperiment = z
  .object({
    checks: z
      .array(
        z.discriminatedUnion("kind", [
          z
            .object({
              kind: z.literal("text"),
              selector: selectorText,
              equals: z.string(),
            })
            .strict(),
          z
            .object({
              kind: z.literal("value"),
              selector: selectorText,
              equals: z.string(),
            })
            .strict(),
          z
            .object({
              kind: z.literal("attribute"),
              selector: selectorText,
              attribute: z.string().min(1),
              equals: z.string(),
            })
            .strict(),
          z.object({ kind: z.literal("url"), equals: z.string() }).strict(),
        ]),
      )
      .min(1),
    wrongTargetCounter: z
      .object({ selector: selectorText, attribute: z.string().min(1) })
      .strict()
      .optional(),
  })
  .strict();

export const experimentTaskSchema = z
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
    category: z.enum(["grounding", "ambiguity"]),
    /** Frozen design row; kept out of the frozen task schema on purpose. */
    design: z
      .object({
        page: z.string().min(1),
        family: z.enum(["section", "legend", "nested", "table"]),
        condition: z.enum(["local", "group"]),
        position: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        entity: z.string().min(1),
        group: z.string().min(1),
      })
      .strict(),
    preregistered: z
      .object({
        ambiguity_class: z.enum(["unique", "local", "structural"]),
        minimum_level: z.enum(["compact", "role", "local", "structural"]),
      })
      .strict(),
    success: successSchemaForExperiment,
  })
  .strict();
export type ExperimentTask = z.infer<typeof experimentTaskSchema>;

export const experimentCohortSchema = z
  .object({
    id: z.literal("relation-ablation-v1"),
    study: z.literal("P0-A/P0-B"),
    model: z.string().min(1),
    baseUrl: z.url().refine((value) => {
      const url = new URL(value);
      return !url.username && !url.password && !url.search && !url.hash;
    }, "Use an endpoint without credentials or query parameters"),
    apiKeyEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    /**
     * Non-secret label for the credential used by this plan. A credential is not an
     * experimental condition, but the paper must be able to state which one produced each
     * model's cells, because a credential change can also change the serving path.
     */
    credentialLabel: z.string().min(1).max(40),
    /**
     * True when this plan runs on the same endpoint as the frozen historical cohorts.
     * A false value means the model name matches but the serving path does not, so the
     * cells are a separate condition and never a replication of the historical runs.
     */
    sameEndpointAsHistory: z.boolean(),
    temperature: z.number().min(0).max(2),
    topP: z.number().gt(0).max(1),
    maxTokens: z.number().int().positive(),
    reasoning: z.literal("provider-default"),
    /** One full trial per task: the three position states live in the task list. */
    repeats: z.literal(1),
    maxSteps: z.number().int().positive(),
    /** HTTP retries only; failure feedback never enters the policy context (frozen behavior). */
    httpRetries: z.literal(2),
    viewport: z.object({ width: z.literal(1120), height: z.literal(780) }).strict(),
    /** Pinned product string; null until the operator verifies the browser at freeze. */
    browserVersion: z.string().min(1).nullable(),
    observation: z.literal("action-representation"),
    modalPolicy: z.literal("observed"),
    arms: z.array(experimentArmSchema).min(2),
    tasks: z.string().min(1),
    fixturePort: z.number().int().min(1024).max(65535),
    timeoutMs: z.number().int().positive().max(2_147_483_647),
    concurrency: z.number().int().min(1).max(8),
    maxLlmCalls: z.number().int().positive(),
    /** Primary contrast, fixed before any model call. */
    primaryContrast: z.tuple([experimentArmSchema, experimentArmSchema]),
  })
  .strict()
  .refine(
    (cohort) => new Set(cohort.arms).size === cohort.arms.length,
    "Duplicate arm in cohort",
  )
  .refine(
    (cohort) => cohort.primaryContrast.every((arm) => cohort.arms.includes(arm)),
    "Primary contrast arms must be in the cohort plan",
  );
export type ExperimentCohort = z.infer<typeof experimentCohortSchema>;

export const experimentRecordSchema = z
  .object({
    schema_version: z.literal(4),
    record_type: z.literal("run"),
    design: z.literal(RELATION_DESIGN_VERSION),
    experiment_id: z.string().uuid(),
    run_id: z.string().uuid(),
    task_id: z.string().min(1),
    arm: experimentArmSchema,
    model: z.string().min(1),
    started_at: z.string().min(1),
    success: z.boolean(),
    /** First scored executed input selected the intended target. */
    grounding_success: z.boolean(),
    /** Success plus an explicit DONE from the policy. */
    strict_task_success: z.boolean(),
    status: z.enum(["done", "blocked", "failed", "max-steps"]),
    reason: z.string(),
    failure_stage: z.string().nullable(),
    steps: z.number().int().nonnegative(),
    wrong_targets: z.number().int().nonnegative().nullable(),
    correct_targets: z.number().int().nonnegative().nullable(),
    mutation_count: z.number().int().nonnegative().nullable(),
    llm_calls: z.number().int().nonnegative(),
    input_tokens: z.number().int().nonnegative().nullable(),
    output_tokens: z.number().int().nonnegative().nullable(),
    total_tokens: z.number().int().nonnegative().nullable(),
    latency_ms: z.number().nonnegative(),
    returned_models: z.array(z.string()),
    /** Exact model-facing payload of the first decision, for audit and cost checks. */
    first_payload: z.unknown().nullable(),
    first_payload_chars: z.number().int().nonnegative().nullable(),
    trace: z.array(
      z
        .object({
          step: z.number().int().positive(),
          operation: z.string().nullable(),
          target: z.string().nullable(),
          executed: z.boolean(),
          assessment: z.enum(["correct", "wrong", "neutral"]).nullable(),
          valid: z.boolean(),
          error: z.string().nullable(),
          payload_chars: z.number().int().nonnegative().nullable(),
        })
        .strict(),
    ),
    responses: z.array(
      z
        .object({
          step: z.number().int().positive(),
          prompt_hash: z.string(),
          request_body: z.unknown(),
          raw_content: z.string().nullable(),
          model: z.string().nullable(),
          usage: z.record(z.string(), z.unknown()),
          http_calls: z.number().int().nonnegative(),
          http_retries: z.number().int().nonnegative(),
          error: z.string().nullable(),
        })
        .strict(),
    ),
    metadata: z
      .object({
        git_commit: z.string().nullable(),
        git_dirty: z.boolean().nullable(),
        browser_version: z.string().nullable(),
        node_version: z.string().min(1),
        task_hash: z.string().min(1),
        fixture_hash: z.string().min(1),
        source_hash: z.string().min(1),
        system_prompt_hash: z.string().min(1),
      })
      .strict(),
  })
  .strict();
export type ExperimentRecord = z.infer<typeof experimentRecordSchema>;

export function parseExperimentTasks(value: unknown): ExperimentTask[] {
  const tasks = z.array(experimentTaskSchema).min(1).parse(value);
  const ids = tasks.map((task) => task.id);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate task ids");
  return tasks;
}

export function parseExperimentCohort(value: unknown): ExperimentCohort {
  return experimentCohortSchema.parse(value);
}
