import { randomUUID } from "node:crypto";

import {
  EVALUATION_SCHEMA_VERSION,
  type EvaluationRecord,
  evaluationRecordSchema,
} from "@prism/contracts";
import { describe, expect, it } from "vitest";

import { FROZEN_SWE_BENCH_TASKS, summarizeEvaluation } from "./evaluation-repository";

function evaluationRecord(): EvaluationRecord {
  const scenarios = [
    "round-button",
    "card-shadow",
    "profile-dialog",
    "form-enablement",
    "mobile-overflow",
    "occluded-menu",
  ] as const;
  const now = new Date().toISOString();
  return evaluationRecordSchema.parse({
    schemaVersion: EVALUATION_SCHEMA_VERSION,
    evaluationId: `eval_${randomUUID()}`,
    createdAt: now,
    updatedAt: now,
    status: "completed",
    capability: {
      attemptsPerScenario: 3,
      minimumPerScenario: 2,
      minimumOverall: 15,
      caps: {
        maxTokens: 240_000,
        maxModelCalls: 24,
        maxDagNodes: 15,
        maxVerificationCycles: 3,
        maxWallTimeMs: 900_000,
      },
      attempts: scenarios.flatMap((scenarioId, scenarioIndex) =>
        [1, 2, 3].map((ordinal) => ({
          attemptId: `capability-${scenarioId}-${ordinal}`,
          scenarioId,
          ordinal,
          runId: `run_${randomUUID()}`,
          reset: "verified",
          resetMismatches: [],
          status: ordinal === 3 && scenarioIndex < 3 ? "failed" : "passed",
          passed: !(ordinal === 3 && scenarioIndex < 3),
          failureClass: ordinal === 3 && scenarioIndex < 3 ? "browser-oracle" : null,
          failureDetail: ordinal === 3 && scenarioIndex < 3 ? "failed" : null,
          metrics: {
            tokens: ordinal * 100,
            modelCalls: ordinal,
            costUsd: ordinal,
            wallTimeMs: ordinal * 1_000,
            dagNodes: 5,
            verificationCycles: 1,
          },
          diagnostics: ["route:workspace.inspect → browser.observe"],
        })),
      ),
    },
    coding: {
      settings: {
        dataset: "princeton-nlp/SWE-bench_Verified",
        split: "test",
        selectionRule: "first per repository",
        model: "paired-model",
        promptTemplate: "same prompt",
        tools: ["patch", "test"],
        tokenBudget: 120_000,
        modelCallBudget: 12,
        timeoutMs: 900_000,
        environment: "same image",
      },
      tasks: FROZEN_SWE_BENCH_TASKS,
      results: FROZEN_SWE_BENCH_TASKS.flatMap(({ instanceId }, taskIndex) =>
        (["direct", "embedded"] as const).map((mode) => ({
          instanceId,
          mode,
          status: "completed",
          resolved: taskIndex < (mode === "direct" ? 8 : 7),
          setupExclusion: null,
          infrastructureFailure: false,
          containmentFailure: false,
          leakedProcess: false,
          metrics: {
            tokens: 1,
            modelCalls: 1,
            costUsd: 1,
            wallTimeMs: 1,
            dagNodes: 1,
            verificationCycles: 1,
          },
        })),
      ),
    },
  });
}

describe("evaluation reporting", () => {
  it("freezes one official task per repository and applies both release gates", () => {
    expect(FROZEN_SWE_BENCH_TASKS).toHaveLength(12);
    expect(
      new Set(FROZEN_SWE_BENCH_TASKS.map(({ repository }) => repository)).size,
    ).toBe(12);

    const report = summarizeEvaluation(evaluationRecord());
    expect(report.summary.capability).toMatchObject({
      successes: 15,
      completed: 18,
      passed: true,
      medianTokens: 200,
      p95Tokens: 300,
    });
    expect(report.summary.coding).toMatchObject({
      directResolved: 8,
      embeddedResolved: 7,
      passed: true,
    });
    expect(report.summary.releaseReady).toBe(true);
  });
});
