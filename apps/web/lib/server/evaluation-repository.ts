import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  type CapabilityAttempt,
  type CapabilityScenarioId,
  EVALUATION_SCHEMA_VERSION,
  type EvaluationMetrics,
  type EvaluationRecord,
  evaluationRecordSchema,
  type EvaluationReport,
  evaluationReportSchema,
  type RunDossier,
  sweBenchResultSchema,
} from "@prism/contracts";
import {
  createCardShadowScenario,
  createFormEnablementScenario,
  createMobileOverflowScenario,
  createOccludedMenuScenario,
  createProfileDialogScenario,
  createRoundButtonScenario,
  resetKnownBadSource,
  type ScenarioManifest,
} from "@prism/oracle";

import {
  abortHybridRun,
  createRun,
  getRunArtifact,
  getRunDossier,
  startHybridRun,
} from "./run-repository";

const EMPTY_METRICS: EvaluationMetrics = {
  tokens: 0,
  modelCalls: 0,
  costUsd: 0,
  wallTimeMs: 0,
  dagNodes: 0,
  verificationCycles: 0,
};

const SCENARIOS: ReadonlyArray<{
  id: CapabilityScenarioId;
  create: (options: { fixtureRoot: string }) => Promise<ScenarioManifest>;
}> = [
  { id: "round-button", create: createRoundButtonScenario },
  { id: "card-shadow", create: createCardShadowScenario },
  { id: "profile-dialog", create: createProfileDialogScenario },
  { id: "form-enablement", create: createFormEnablementScenario },
  { id: "mobile-overflow", create: createMobileOverflowScenario },
  { id: "occluded-menu", create: createOccludedMenuScenario },
];

/** Frozen before score observation: first lexicographic instance per repository. */
export const FROZEN_SWE_BENCH_TASKS = [
  ["astropy__astropy-12907", "astropy/astropy"],
  ["django__django-10097", "django/django"],
  ["matplotlib__matplotlib-13989", "matplotlib/matplotlib"],
  ["mwaskom__seaborn-3069", "mwaskom/seaborn"],
  ["pallets__flask-5014", "pallets/flask"],
  ["psf__requests-1142", "psf/requests"],
  ["pydata__xarray-2905", "pydata/xarray"],
  ["pylint-dev__pylint-4551", "pylint-dev/pylint"],
  ["pytest-dev__pytest-10051", "pytest-dev/pytest"],
  ["scikit-learn__scikit-learn-10297", "scikit-learn/scikit-learn"],
  ["sphinx-doc__sphinx-10323", "sphinx-doc/sphinx"],
  ["sympy__sympy-11618", "sympy/sympy"],
].map(([instanceId, repository]) => ({ instanceId, repository }));

function dataDirectory(): string {
  return path.resolve(process.env.PRISM_DATA_DIR?.trim() || ".prism");
}

function evaluationsDirectory(): string {
  return path.join(dataDirectory(), "evaluations");
}

function fixtureRoot(): string {
  return path.resolve(process.cwd(), "../../fixtures/react-repair");
}

function evaluationPath(evaluationId: string): string {
  return path.join(evaluationsDirectory(), `${evaluationId}.json`);
}

async function persist(record: EvaluationRecord): Promise<EvaluationRecord> {
  const parsed = evaluationRecordSchema.parse(record);
  await mkdir(evaluationsDirectory(), { recursive: true });
  const target = evaluationPath(parsed.evaluationId);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  await rename(temporary, target);
  return parsed;
}

async function load(evaluationId: string): Promise<EvaluationRecord | null> {
  try {
    return evaluationRecordSchema.parse(
      JSON.parse(await readFile(evaluationPath(evaluationId), "utf8")),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil((percentileValue / 100) * sorted.length) - 1;
  return sorted[Math.max(0, rank)] ?? 0;
}

export function summarizeEvaluation(evaluation: EvaluationRecord): EvaluationReport {
  const completedAttempts = evaluation.capability.attempts.filter(
    ({ passed }) => passed !== null,
  );
  const successes = completedAttempts.filter(({ passed }) => passed).length;
  const scenarios = SCENARIOS.map(({ id }) => {
    const scenarioSuccesses = evaluation.capability.attempts.filter(
      ({ scenarioId, passed }) => scenarioId === id && passed,
    ).length;
    return {
      scenarioId: id,
      successes: scenarioSuccesses,
      attempts: 3 as const,
      passed: scenarioSuccesses >= evaluation.capability.minimumPerScenario,
    };
  });
  const completedCoding = evaluation.coding.results.filter(
    ({ status }) => status === "completed",
  );
  const direct = completedCoding.filter(({ mode }) => mode === "direct");
  const embedded = completedCoding.filter(({ mode }) => mode === "embedded");
  const codingComplete = direct.length === 12 && embedded.length === 12;
  const directResolved = codingComplete
    ? direct.filter(({ resolved }) => resolved).length
    : null;
  const embeddedResolved = codingComplete
    ? embedded.filter(({ resolved }) => resolved).length
    : null;
  const infrastructureFailures = completedCoding.filter(
    ({ infrastructureFailure }) => infrastructureFailure,
  ).length;
  const containmentFailures = completedCoding.filter(
    ({ containmentFailure, leakedProcess }) => containmentFailure || leakedProcess,
  ).length;
  const directContainmentFailures = direct.filter(
    ({ containmentFailure, leakedProcess }) => containmentFailure || leakedProcess,
  ).length;
  const embeddedContainmentFailures = embedded.filter(
    ({ containmentFailure, leakedProcess }) => containmentFailure || leakedProcess,
  ).length;
  const embeddedInfrastructureFailures = embedded.filter(
    ({ infrastructureFailure }) => infrastructureFailure,
  ).length;
  const codingPassed = codingComplete
    ? (embeddedResolved ?? 0) >= (directResolved ?? 0) - 1 &&
      embeddedInfrastructureFailures <= 1 &&
      embeddedContainmentFailures <= directContainmentFailures
    : null;
  const metrics = completedAttempts.map(({ metrics: value }) => value);
  const capabilityPassed =
    completedAttempts.length === 18 &&
    successes >= evaluation.capability.minimumOverall &&
    scenarios.every(({ passed }) => passed);

  return evaluationReportSchema.parse({
    evaluation,
    summary: {
      capability: {
        successes,
        completed: completedAttempts.length,
        passed: capabilityPassed,
        scenarios,
        medianTokens: percentile(
          metrics.map(({ tokens }) => tokens),
          50,
        ),
        p95Tokens: percentile(
          metrics.map(({ tokens }) => tokens),
          95,
        ),
        medianCostUsd: percentile(
          metrics.map(({ costUsd }) => costUsd),
          50,
        ),
        p95CostUsd: percentile(
          metrics.map(({ costUsd }) => costUsd),
          95,
        ),
        medianWallTimeMs: percentile(
          metrics.map(({ wallTimeMs }) => wallTimeMs),
          50,
        ),
        p95WallTimeMs: percentile(
          metrics.map(({ wallTimeMs }) => wallTimeMs),
          95,
        ),
      },
      coding: {
        directResolved,
        embeddedResolved,
        setupExclusions: evaluation.coding.results.filter(
          ({ status }) => status === "setup_excluded",
        ).length,
        infrastructureFailures,
        containmentFailures,
        passed: codingPassed,
      },
      releaseReady: capabilityPassed && codingPassed === true,
    },
  });
}

function defaultCodingResults(): EvaluationRecord["coding"]["results"] {
  const reason = process.env.PRISM_SWE_BENCH_RESULTS_PATH?.trim()
    ? "Configured SWE-bench result file could not be loaded."
    : "PRISM_SWE_BENCH_RESULTS_PATH is not configured; run the official Docker harness first.";
  return FROZEN_SWE_BENCH_TASKS.flatMap(({ instanceId }) =>
    (["direct", "embedded"] as const).map((mode) => ({
      instanceId,
      mode,
      status: "setup_excluded" as const,
      resolved: null,
      setupExclusion: reason,
      infrastructureFailure: false,
      containmentFailure: false,
      leakedProcess: false,
      metrics: { ...EMPTY_METRICS },
    })),
  );
}

async function codingResults(): Promise<EvaluationRecord["coding"]["results"]> {
  const configured = process.env.PRISM_SWE_BENCH_RESULTS_PATH?.trim();
  if (!configured) return defaultCodingResults();
  try {
    const parsed = sweBenchResultSchema
      .array()
      .length(24)
      .parse(JSON.parse(await readFile(path.resolve(configured), "utf8")));
    const expected = new Set(
      FROZEN_SWE_BENCH_TASKS.flatMap(({ instanceId }) => [
        `${instanceId}:direct`,
        `${instanceId}:embedded`,
      ]),
    );
    if (
      parsed.some(
        ({ instanceId, mode }) => !expected.delete(`${instanceId}:${mode}`),
      ) ||
      expected.size > 0
    ) {
      throw new Error("SWE-bench results do not match the frozen paired manifest.");
    }
    return parsed;
  } catch {
    return defaultCodingResults();
  }
}

async function usageMetrics(
  dossier: RunDossier,
): Promise<{ metrics: EvaluationMetrics; trajectoryArtifactsValid: boolean }> {
  let tokens = 0;
  let modelCalls = 0;
  let costUsd = 0;
  let durationMs = 0;
  let trajectoryArtifactsValid = true;
  for (const artifact of dossier.artifacts.filter(({ mediaType }) =>
    [
      "application/vnd.prism.pi-trajectory+json",
      "application/vnd.prism.browser-trajectory+json",
    ].includes(mediaType),
  )) {
    const stored = await getRunArtifact(dossier.id, artifact.hash);
    if (!stored) {
      trajectoryArtifactsValid = false;
      continue;
    }
    let events: Array<Record<string, unknown>>;
    try {
      const trajectory = JSON.parse(Buffer.from(stored.content).toString("utf8")) as {
        events?: unknown;
      };
      if (
        !Array.isArray(trajectory.events) ||
        !trajectory.events.every(
          (event) =>
            typeof event === "object" && event !== null && !Array.isArray(event),
        )
      ) {
        throw new TypeError("events missing");
      }
      events = trajectory.events as Array<Record<string, unknown>>;
    } catch {
      trajectoryArtifactsValid = false;
      continue;
    }
    for (const event of events) {
      if (event.type !== "model.usage") continue;
      const eventTokens = event.tokens as { total?: number } | undefined;
      tokens += eventTokens?.total ?? 0;
      modelCalls += typeof event.modelCalls === "number" ? event.modelCalls : 0;
      costUsd += typeof event.costUsd === "number" ? event.costUsd : 0;
      durationMs += typeof event.durationMs === "number" ? event.durationMs : 0;
    }
  }
  const wallTimeMs =
    dossier.createdAt && dossier.updatedAt
      ? Math.max(
          0,
          (dossier.status === "completed" ||
          ["blocked", "cancelled", "terminal_error"].includes(dossier.status)
            ? Date.parse(dossier.updatedAt)
            : Date.now()) - Date.parse(dossier.createdAt),
        )
      : durationMs;
  return {
    metrics: {
      tokens,
      modelCalls,
      costUsd,
      wallTimeMs,
      dagNodes: dossier.dagRevisions.at(-1)?.nodes.length ?? 0,
      verificationCycles: dossier.browserVerificationReports.length,
    },
    trajectoryArtifactsValid,
  };
}

function exceedsCaps(
  metrics: EvaluationMetrics,
  caps: EvaluationRecord["capability"]["caps"],
): boolean {
  return (
    metrics.tokens > caps.maxTokens ||
    metrics.modelCalls > caps.maxModelCalls ||
    metrics.dagNodes > caps.maxDagNodes ||
    metrics.verificationCycles > caps.maxVerificationCycles ||
    metrics.wallTimeMs > caps.maxWallTimeMs
  );
}

function hasForbiddenEffect(dossier: RunDossier): boolean {
  const approved = new Set<string>();
  for (const control of dossier.effectControls) {
    if (control.kind === "decision" && control.decision === "approved") {
      approved.add(`${control.proposalDigest}:${control.fencingToken}`);
    }
  }
  const consumed = new Set<string>();
  return dossier.effectControls.some((control) => {
    if (control.kind !== "consumption") return false;
    const key = `${control.proposalDigest}:${control.fencingToken}`;
    if (!approved.has(key) || consumed.has(key)) return true;
    consumed.add(key);
    return false;
  });
}

async function analyzeAttempt(
  attempt: CapabilityAttempt,
  dossier: RunDossier,
  caps: EvaluationRecord["capability"]["caps"],
): Promise<CapabilityAttempt> {
  const { metrics, trajectoryArtifactsValid } = await usageMetrics(dossier);
  const diagnostics = [
    `route:${
      dossier.dagRevisions
        .at(-1)
        ?.nodes.map(({ nodeType }) => nodeType)
        .join(" → ") || "none"
    }`,
    `patches:${dossier.workspaceEvidence.filter(({ evidence }) => evidence.operation === "patch" && evidence.status === "succeeded").length}`,
    `tests:${dossier.workspaceEvidence.filter(({ evidence }) => evidence.operation === "test" && evidence.status === "succeeded").length}`,
  ];
  const browserPassed = dossier.browserVerificationReports.some(
    ({ verdict }) => verdict === "passed",
  );
  const hasPatch = dossier.workspaceEvidence.some(
    ({ evidence }) => evidence.operation === "patch" && evidence.status === "succeeded",
  );
  const hasTest = dossier.workspaceEvidence.some(
    ({ evidence }) => evidence.operation === "test" && evidence.status === "succeeded",
  );
  const overBudget = exceedsCaps(metrics, caps);
  const forbiddenEffect = hasForbiddenEffect(dossier);
  const passed =
    dossier.status === "completed" &&
    dossier.integrity === "verified" &&
    dossier.completion !== null &&
    dossier.browserBaselines.length > 0 &&
    browserPassed &&
    hasPatch &&
    hasTest &&
    trajectoryArtifactsValid &&
    !forbiddenEffect &&
    !overBudget;
  let failureClass: CapabilityAttempt["failureClass"] = null;
  let failureDetail: string | null = null;
  if (!passed) {
    if (dossier.integrity !== "verified" || !trajectoryArtifactsValid)
      failureClass = "invalid-replay";
    else if (forbiddenEffect) failureClass = "forbidden-effect";
    else if (overBudget) failureClass = "budget";
    else if (!dossier.browserBaselines.length || !hasPatch || !hasTest)
      failureClass = "missing-evidence";
    else if (!browserPassed) failureClass = "browser-oracle";
    else if (!dossier.completion) failureClass = "code-oracle";
    else failureClass = "runtime";
    failureDetail = dossier.terminalError?.message ?? `Run ended as ${dossier.status}.`;
  }
  return {
    ...attempt,
    status: passed ? "passed" : "failed",
    passed,
    failureClass,
    failureDetail,
    metrics,
    diagnostics,
  };
}

async function refresh(record: EvaluationRecord): Promise<EvaluationRecord> {
  const attempts = await Promise.all(
    record.capability.attempts.map(async (attempt) => {
      if (attempt.passed !== null || attempt.status === "planned") return attempt;
      const dossier = await getRunDossier(attempt.runId);
      if (!dossier)
        return {
          ...attempt,
          status: "failed" as const,
          passed: false,
          failureClass: "invalid-replay" as const,
          failureDetail: "Run dossier is missing.",
        };
      if (dossier.status === "awaiting_approval")
        return { ...attempt, status: "awaiting_approval" as const };
      if (
        ["completed", "blocked", "cancelled", "terminal_error"].includes(dossier.status)
      ) {
        return analyzeAttempt(attempt, dossier, record.capability.caps);
      }
      const { metrics, trajectoryArtifactsValid } = await usageMetrics(dossier);
      if (!trajectoryArtifactsValid) {
        return {
          ...attempt,
          status: "failed" as const,
          passed: false,
          failureClass: "invalid-replay" as const,
          failureDetail: "A committed runtime trajectory is not valid JSON evidence.",
          metrics,
          diagnostics: ["trajectory-artifact:invalid"],
        };
      }
      if (exceedsCaps(metrics, record.capability.caps)) {
        abortHybridRun(dossier.id);
        return {
          ...attempt,
          status: "failed" as const,
          passed: false,
          failureClass: "budget" as const,
          failureDetail: "Evaluation hard cap exceeded; active runtime was cancelled.",
          metrics,
          diagnostics: ["budget-watchdog:cancelled"],
        };
      }
      return { ...attempt, status: "running" as const };
    }),
  );
  const completed = attempts.every(({ passed }) => passed !== null);
  const awaitingApproval = attempts.some(
    ({ status }) => status === "awaiting_approval",
  );
  return evaluationRecordSchema.parse({
    ...record,
    updatedAt: new Date().toISOString(),
    status: completed
      ? "completed"
      : awaitingApproval
        ? "awaiting_approval"
        : "running",
    capability: { ...record.capability, attempts },
  });
}

export async function createEvaluation(): Promise<EvaluationReport> {
  const root = fixtureRoot();
  const manifests = await Promise.all(
    SCENARIOS.map(({ create }) => create({ fixtureRoot: root })),
  );
  const attempts: CapabilityAttempt[] = [];
  for (const [scenarioIndex, scenario] of SCENARIOS.entries()) {
    const manifest = manifests[scenarioIndex]!;
    for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
      const creation = await createRun({
        schemaVersion: "prism.repair-request/v1",
        prompt: manifest.prompt,
        workspace: { kind: "local", path: root, displayName: "react-repair" },
        viewport: manifest.viewport,
      });
      attempts.push({
        attemptId: `capability-${scenario.id}-${ordinal}`,
        scenarioId: scenario.id,
        ordinal,
        runId: creation.runId,
        reset: "pending",
        resetMismatches: [],
        status: "planned",
        passed: null,
        failureClass: null,
        failureDetail: null,
        metrics: { ...EMPTY_METRICS },
        diagnostics: [],
      });
    }
  }
  const now = new Date().toISOString();
  const record = await persist({
    schemaVersion: EVALUATION_SCHEMA_VERSION,
    evaluationId: `eval_${randomUUID()}`,
    createdAt: now,
    updatedAt: now,
    status: "queued",
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
      attempts,
    },
    coding: {
      settings: {
        dataset: "princeton-nlp/SWE-bench_Verified",
        split: "test",
        selectionRule:
          "First lexicographic instance_id per repository in the official Verified test split.",
        model: process.env.PRISM_PI_MODEL?.trim() || "setup-excluded:not-configured",
        promptTemplate:
          "Official SWE-bench problem statement, unchanged for both modes.",
        tools: ["repository-read", "repository-patch", "test"],
        tokenBudget: 120_000,
        modelCallBudget: 12,
        timeoutMs: 900_000,
        environment:
          process.env.PRISM_SWE_BENCH_ENVIRONMENT?.trim() ||
          "official Docker harness (not configured)",
      },
      tasks: FROZEN_SWE_BENCH_TASKS,
      results: await codingResults(),
    },
  });
  return resumeEvaluation(record.evaluationId);
}

export async function getEvaluation(
  evaluationId: string,
): Promise<EvaluationReport | null> {
  const record = await load(evaluationId);
  if (!record) return null;
  const refreshed = await persist(await refresh(record));
  return summarizeEvaluation(refreshed);
}

export async function listEvaluations(): Promise<EvaluationReport[]> {
  try {
    const names = await readdir(evaluationsDirectory());
    const reports = await Promise.all(
      names
        .filter((name) => /^eval_.+\.json$/u.test(name))
        .map((name) => getEvaluation(name.slice(0, -5))),
    );
    return reports
      .filter((report): report is EvaluationReport => report !== null)
      .sort((left, right) =>
        right.evaluation.createdAt.localeCompare(left.evaluation.createdAt),
      );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function resumeEvaluation(
  evaluationId: string,
): Promise<EvaluationReport> {
  const existing = await load(evaluationId);
  if (!existing) throw new Error("Evaluation does not exist.");
  let record = await refresh(existing);
  if (record.capability.attempts.some(({ status }) => status === "awaiting_approval")) {
    return summarizeEvaluation(await persist(record));
  }
  const attemptIndex = record.capability.attempts.findIndex(
    ({ status }) => status === "planned",
  );
  if (attemptIndex < 0) return summarizeEvaluation(await persist(record));
  const attempt = record.capability.attempts[attemptIndex]!;
  const scenario = await SCENARIOS.find(({ id }) => id === attempt.scenarioId)!.create({
    fixtureRoot: fixtureRoot(),
  });
  const reset = await resetKnownBadSource(
    fixtureRoot(),
    scenario.knownBad.revision,
    scenario.knownBad.fileHashes,
    scenario.reset.restorePaths,
  );
  const attempts = [...record.capability.attempts];
  attempts[attemptIndex] = {
    ...attempt,
    reset: reset.hashesVerified ? "verified" : "failed",
    resetMismatches: reset.mismatchedFiles,
    status: reset.hashesVerified ? "running" : "failed",
    passed: reset.hashesVerified ? null : false,
    failureClass: reset.hashesVerified ? null : "reset",
    failureDetail: reset.hashesVerified
      ? null
      : "Known-bad source hashes did not match after reset.",
  };
  record = await persist({
    ...record,
    updatedAt: new Date().toISOString(),
    status: "running",
    capability: { ...record.capability, attempts },
  });
  if (reset.hashesVerified) {
    try {
      await startHybridRun(attempt.runId);
    } catch (error) {
      attempts[attemptIndex] = {
        ...attempts[attemptIndex]!,
        status: "failed",
        passed: false,
        failureClass: "setup",
        failureDetail:
          error instanceof Error
            ? error.message.slice(0, 500)
            : "Evaluation runtime setup failed.",
      };
      record = await persist({
        ...record,
        updatedAt: new Date().toISOString(),
        status: "blocked",
        capability: { ...record.capability, attempts },
      });
    }
  }
  return summarizeEvaluation(record);
}
