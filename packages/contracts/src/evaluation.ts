import { z } from "zod";

export const EVALUATION_SCHEMA_VERSION = "prism.evaluation/v1" as const;
export const EVALUATION_RESPONSE_SCHEMA_VERSION =
  "prism.evaluation-response/v1" as const;

export const evaluationIdSchema = z
  .string()
  .regex(/^eval_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);

const evaluationRunIdSchema = z.string().regex(
  /^run_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
);

export const capabilityScenarioIdSchema = z.enum([
  "round-button",
  "card-shadow",
  "profile-dialog",
  "form-enablement",
  "mobile-overflow",
  "occluded-menu",
]);

export const evaluationFailureClassSchema = z.enum([
  "setup",
  "reset",
  "code-oracle",
  "browser-oracle",
  "missing-evidence",
  "invalid-replay",
  "forbidden-effect",
  "route",
  "budget",
  "runtime",
]);

export const evaluationMetricsSchema = z
  .object({
    tokens: z.number().int().nonnegative(),
    modelCalls: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative(),
    wallTimeMs: z.number().nonnegative(),
    dagNodes: z.number().int().nonnegative(),
    verificationCycles: z.number().int().nonnegative(),
  })
  .strict();

export const capabilityAttemptSchema = z
  .object({
    attemptId: z.string().regex(/^capability-[a-z-]+-[1-3]$/u),
    scenarioId: capabilityScenarioIdSchema,
    ordinal: z.number().int().min(1).max(3),
    runId: evaluationRunIdSchema,
    reset: z.enum(["pending", "verified", "failed"]),
    resetMismatches: z.array(z.string().min(1).max(300)),
    status: z.enum([
      "planned",
      "running",
      "awaiting_approval",
      "passed",
      "failed",
    ]),
    passed: z.boolean().nullable(),
    failureClass: evaluationFailureClassSchema.nullable(),
    failureDetail: z.string().max(500).nullable(),
    metrics: evaluationMetricsSchema,
    diagnostics: z.array(z.string().min(1).max(300)).max(24),
  })
  .strict();

const pairedSettingsSchema = z
  .object({
    dataset: z.literal("princeton-nlp/SWE-bench_Verified"),
    split: z.literal("test"),
    selectionRule: z.string().min(1).max(300),
    model: z.string().min(1).max(200),
    promptTemplate: z.string().min(1).max(300),
    tools: z.array(z.string().min(1).max(80)).min(1).max(16),
    tokenBudget: z.number().int().positive(),
    modelCallBudget: z.number().int().positive(),
    timeoutMs: z.number().int().positive(),
    environment: z.string().min(1).max(300),
  })
  .strict();

export const sweBenchTaskSchema = z
  .object({
    instanceId: z.string().min(1).max(120),
    repository: z.string().min(1).max(200),
  })
  .strict();

export const sweBenchResultSchema = z
  .object({
    instanceId: z.string().min(1).max(120),
    mode: z.enum(["direct", "embedded"]),
    status: z.enum(["completed", "setup_excluded"]),
    resolved: z.boolean().nullable(),
    setupExclusion: z.string().min(1).max(500).nullable(),
    infrastructureFailure: z.boolean(),
    containmentFailure: z.boolean(),
    leakedProcess: z.boolean(),
    metrics: evaluationMetricsSchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (
      (result.status === "completed" && result.resolved === null) ||
      (result.status === "setup_excluded" && result.setupExclusion === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Completed results need a verdict; exclusions need a reason.",
      });
    }
  });

export const evaluationCapsSchema = z
  .object({
    maxTokens: z.number().int().positive(),
    maxModelCalls: z.number().int().positive(),
    maxDagNodes: z.number().int().positive(),
    maxVerificationCycles: z.number().int().positive(),
    maxWallTimeMs: z.number().int().positive(),
  })
  .strict();

export const evaluationRecordSchema = z
  .object({
    schemaVersion: z.literal(EVALUATION_SCHEMA_VERSION),
    evaluationId: evaluationIdSchema,
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    status: z.enum([
      "queued",
      "running",
      "awaiting_approval",
      "completed",
      "blocked",
    ]),
    capability: z
      .object({
        attemptsPerScenario: z.literal(3),
        minimumPerScenario: z.literal(2),
        minimumOverall: z.literal(15),
        caps: evaluationCapsSchema,
        attempts: z.array(capabilityAttemptSchema).length(18),
      })
      .strict(),
    coding: z
      .object({
        settings: pairedSettingsSchema,
        tasks: z.array(sweBenchTaskSchema).length(12),
        results: z.array(sweBenchResultSchema).length(24),
      })
      .strict(),
  })
  .strict();

export const scenarioEvaluationSummarySchema = z
  .object({
    scenarioId: capabilityScenarioIdSchema,
    successes: z.number().int().min(0).max(3),
    attempts: z.literal(3),
    passed: z.boolean(),
  })
  .strict();

export const evaluationSummarySchema = z
  .object({
    capability: z
      .object({
        successes: z.number().int().min(0).max(18),
        completed: z.number().int().min(0).max(18),
        passed: z.boolean(),
        scenarios: z.array(scenarioEvaluationSummarySchema).length(6),
        medianTokens: z.number().nonnegative(),
        p95Tokens: z.number().nonnegative(),
        medianCostUsd: z.number().nonnegative(),
        p95CostUsd: z.number().nonnegative(),
        medianWallTimeMs: z.number().nonnegative(),
        p95WallTimeMs: z.number().nonnegative(),
      })
      .strict(),
    coding: z
      .object({
        directResolved: z.number().int().nonnegative().nullable(),
        embeddedResolved: z.number().int().nonnegative().nullable(),
        setupExclusions: z.number().int().nonnegative(),
        infrastructureFailures: z.number().int().nonnegative(),
        containmentFailures: z.number().int().nonnegative(),
        passed: z.boolean().nullable(),
      })
      .strict(),
    releaseReady: z.boolean(),
  })
  .strict();

export const evaluationReportSchema = z
  .object({
    evaluation: evaluationRecordSchema,
    summary: evaluationSummarySchema,
  })
  .strict();

export const evaluationResponseSchema = z
  .object({
    schemaVersion: z.literal(EVALUATION_RESPONSE_SCHEMA_VERSION),
    report: evaluationReportSchema,
  })
  .strict();

export const evaluationListResponseSchema = z
  .object({
    schemaVersion: z.literal(EVALUATION_RESPONSE_SCHEMA_VERSION),
    evaluations: z.array(evaluationReportSchema),
  })
  .strict();

export type CapabilityAttempt = z.infer<typeof capabilityAttemptSchema>;
export type CapabilityScenarioId = z.infer<typeof capabilityScenarioIdSchema>;
export type EvaluationMetrics = z.infer<typeof evaluationMetricsSchema>;
export type EvaluationRecord = z.infer<typeof evaluationRecordSchema>;
export type EvaluationReport = z.infer<typeof evaluationReportSchema>;
export type SweBenchResult = z.infer<typeof sweBenchResultSchema>;
