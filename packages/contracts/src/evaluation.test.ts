import { randomUUID } from "node:crypto";

import { expect, it } from "vitest";

import {
  EVALUATION_SCHEMA_VERSION,
  evaluationRecordSchema,
  type EvaluationMetrics,
} from "./evaluation";

const metrics: EvaluationMetrics = {
  tokens: 0,
  modelCalls: 0,
  costUsd: 0,
  wallTimeMs: 0,
  dagNodes: 0,
  verificationCycles: 0,
};

it("requires the frozen 18 capability attempts and 24 paired coding results", () => {
  const parsed = evaluationRecordSchema.parse({
    schemaVersion: EVALUATION_SCHEMA_VERSION,
    evaluationId: `eval_${randomUUID()}`,
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:00.000Z",
    status: "queued",
    capability: {
      attemptsPerScenario: 3,
      minimumPerScenario: 2,
      minimumOverall: 15,
      caps: {
        maxTokens: 240_000,
        maxModelCalls: 24,
        maxDagNodes: 12,
        maxVerificationCycles: 1,
        maxWallTimeMs: 600_000,
      },
      attempts: [
        "round-button",
        "card-shadow",
        "profile-dialog",
        "form-enablement",
        "mobile-overflow",
        "occluded-menu",
      ].flatMap((scenarioId) =>
        [1, 2, 3].map((ordinal) => ({
          attemptId: `capability-${scenarioId}-${ordinal}`,
          scenarioId,
          ordinal,
          runId: `run_${randomUUID()}`,
          reset: "pending",
          resetMismatches: [],
          status: "planned",
          passed: null,
          failureClass: null,
          failureDetail: null,
          metrics,
          diagnostics: [],
        })),
      ),
    },
    coding: {
      settings: {
        dataset: "princeton-nlp/SWE-bench_Verified",
        split: "test",
        selectionRule: "first lexicographic instance per repository",
        model: "same-model",
        promptTemplate: "problem_statement/v1",
        tools: ["read", "patch", "test"],
        tokenBudget: 120_000,
        modelCallBudget: 12,
        timeoutMs: 600_000,
        environment: "official SWE-bench Docker image",
      },
      tasks: Array.from({ length: 12 }, (_, index) => ({
        instanceId: `repo__repo-${index}`,
        repository: `owner/repo-${index}`,
      })),
      results: Array.from({ length: 12 }, (_, index) =>
        (["direct", "embedded"] as const).map((mode) => ({
          instanceId: `repo__repo-${index}`,
          mode,
          status: "setup_excluded",
          resolved: null,
          setupExclusion: "Official harness output is not configured.",
          infrastructureFailure: false,
          containmentFailure: false,
          leakedProcess: false,
          metrics,
        })),
      ).flat(),
    },
  });

  expect(parsed.capability.attempts).toHaveLength(18);
  expect(parsed.coding.results).toHaveLength(24);
});
