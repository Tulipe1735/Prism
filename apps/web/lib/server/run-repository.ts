import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
/**
 * Field Desk 服务端 Run 仓库（repository）
 *
 * 位于 API 路由层与底层包之间，负责把 HTTP 语义组装成领域操作：
 *  - 惰性单例的 FileTrajectoryStore（按 PRISM_DATA_DIR 解析数据目录）；
 *  - Run 创建 / 列表 / 卷宗读取，损坏时降级为 failed 卷宗而非抛错；
 *  - live 混合编排的启动与等待（进程内单例，带初始修订门闩）；
 *  - 工作区请求执行（用 WorkspaceExecutor 受限执行并落证据）；
 *  - 浏览器基线采集（用 BrowserExecutor 采集并把产物写入存储）；
 *  - 内容寻址产物读取。
 *
 * 除明确调用方错误（Run ID 不匹配）外，业务失败大多返回 null 或
 * 降级卷宗，由路由层决定 HTTP 状态码。
 */
import path from "node:path";
import process from "node:process";

import { BrowserExecutor } from "@prism/action-broker";
import {
  type ArtifactRef,
  type BrowserBaselineRecord,
  type BrowserBaselineRequest,
  browserBaselineRequestSchema,
  type BrowserRuntimeResult,
  type BrowserRuntimeTaskEnvelope,
  CODE_ORACLE_REPORT_MEDIA_TYPE,
  type EffectApprovalDecision,
  type EffectApprovalProposal,
  type EffectDecisionRequest,
  FRONTEND_REPAIR_SPEC_MEDIA_TYPE,
  piRuntimeResultSchema,
  type RepairRequest,
  RUN_CREATION_SCHEMA_VERSION,
  type RunCreation,
  runCreationSchema,
  type RunDagNode,
  type RunDagNodeType,
  type RunDossier,
  runDossierSchema,
  runIdSchema,
  type RunSummary,
  runSummarySchema,
  type TerminalRunError,
  type WorkspaceEvidenceRecord,
  workspaceEvidenceRecordSchema,
  workspaceRequestSchema,
} from "@prism/contracts";
import {
  BrowserOracle,
  CodeOracle,
  createRoundButtonScenario,
  type RenderedTargetObservation,
  type ScenarioManifest,
} from "@prism/oracle";
import { type OrchestrationJournal, Orchestrator } from "@prism/orchestrator";
import {
  type BrowserPortFactory,
  BrowserRuntime,
  type BrowserSessionFactory,
  type BrowserVerifier,
  createConfiguredAgentPlanBrowserSessionFactory,
  PlaywrightBrowserPortFactory,
} from "@prism/runtime-browser";
import {
  createConfiguredPiSdkSessionFactory,
  PiCodingRuntime,
  type PiSessionFactory,
} from "@prism/runtime-pi";
import {
  type DurableRun,
  effectApprovalDigest,
  FileTrajectoryStore,
  RunIntegrityError,
  runTitleFromPrompt,
} from "@prism/trajectory-store";
import { WorkspaceExecutor } from "@prism/workspace-executor";

/** 工作区证据产物的媒体类型。 */
const WORKSPACE_EVIDENCE_MEDIA_TYPE = "application/vnd.prism.workspace-evidence+json";
/** 浏览器证据产物的媒体类型。 */
const BROWSER_EVIDENCE_MEDIA_TYPE = "application/vnd.prism.browser-evidence+json";
const BROWSER_ORACLE_OBSERVATION_MEDIA_TYPE =
  "application/vnd.prism.browser-oracle-observation+json";

/** 浏览器基线未配置（缺少 PRISM_BROWSER_BASE_URL）时抛出的错误。 */
export class BrowserBaselineConfigurationError extends Error {}

export type RecentRun = RunSummary;
export type { RunDossier };

/** 惰性初始化的全局轨迹存储单例。 */
let activeStore: { dataDirectory: string; store: FileTrajectoryStore } | undefined;
/** 进程内一次 live 混合运行的活动句柄。 */
interface ActiveHybridRun {
  /** 首个 DAG 修订已写入日志的门闩（写入成功前启动请求不返回）。 */
  initialRevisionCommitted: Promise<void>;
  /** 整个 live 运行完成的 promise。 */
  completion: Promise<void>;
  controller: AbortController;
}

const RUN_WORKSPACE_READ_PATTERNS = [
  "package.json",
  "README.md",
  "apps/**/*.{ts,tsx,css,json,mjs}",
  "packages/**/*.{ts,tsx,css,json,mjs}",
  "src/**/*.{ts,tsx,css,json,mjs}",
  "tests/**/*.{ts,tsx,css,json,mjs}",
] as const;
const RUN_WORKSPACE_DISCOVERY_PATTERNS = [
  "apps/**/*.{ts,tsx}",
  "packages/**/*.ts",
  "src/**/*.{ts,tsx}",
  "**/*.{test,spec}.{ts,tsx}",
] as const;

/** 进程内活动运行表，键为 dataDirectory:runId。 */
const activeHybridRuns = new Map<string, ActiveHybridRun>();

/** 生成活动运行的 Map 键。 */
function hybridRunKey(dataDirectory: string, runId: string): string {
  return `${dataDirectory}:${runId}`;
}

/** 解析数据目录：优先 PRISM_DATA_DIR，否则回退到 ".prism"。 */
function getDataDirectory() {
  const configured = process.env.PRISM_DATA_DIR?.trim();
  return path.resolve(configured && configured.length > 0 ? configured : ".prism");
}

/** 获取（或惰性创建）全局轨迹存储单例。 */
function getStore() {
  const dataDirectory = getDataDirectory();
  if (!activeStore || activeStore.dataDirectory !== dataDirectory) {
    activeStore = {
      dataDirectory,
      store: new FileTrajectoryStore({ dataDirectory }),
    };
  }

  return activeStore.store;
}

/** 从一次已加载的 DurableRun 组装可返回的卷宗（integrity=verified）。 */
function dossierFromRun(run: DurableRun): RunDossier {
  return runDossierSchema.parse({
    id: run.manifest.runId,
    title: run.snapshot.title,
    status: run.snapshot.status,
    createdAt: run.snapshot.createdAt,
    updatedAt: run.snapshot.updatedAt,
    lastSequence: run.snapshot.lastSequence,
    integrity: "verified",
    prompt: run.manifest.request.prompt,
    workspace: run.manifest.request.workspace,
    viewport: run.manifest.request.viewport,
    artifacts: run.snapshot.artifacts,
    workspaceEvidence: run.snapshot.workspaceEvidence,
    browserBaselines: run.snapshot.browserBaselines,
    browserActions: run.snapshot.browserActions,
    browserVerificationReports: run.snapshot.browserVerificationReports,
    repairSpec: run.snapshot.repairSpec,
    completion: run.snapshot.completion,
    dagRevisions: run.snapshot.dagRevisions,
    nodeProgress: run.snapshot.nodeProgress,
    effectLease: run.snapshot.effectLease,
    effectControls: run.snapshot.effectControls,
    terminalError: run.snapshot.terminalError,
  });
}

/**
 * 构造一个"读取失败"的降级卷宗（integrity=failed）。
 *
 * 尽可能从清单恢复展示信息（标题/请求/工作区），其余字段置空，
 * 并写入终止错误。清单损坏时只保留最基础的标题。
 */
async function failedDossier(runId: string, error: unknown): Promise<RunDossier> {
  const store = getStore();
  let manifest = null;
  try {
    manifest = await store.loadManifest(runId);
  } catch {
    // 清单损坏时不能安全贡献展示状态
  }

  const terminalError: TerminalRunError =
    error instanceof RunIntegrityError
      ? { code: error.code, message: error.message }
      : {
          code: "storage_error",
          message: `Run ${runId} could not be read from durable storage.`,
        };

  return runDossierSchema.parse({
    id: runId,
    title: manifest
      ? runTitleFromPrompt(manifest.request.prompt)
      : `Unreadable Run ${runId}`,
    status: "terminal_error",
    createdAt: manifest?.createdAt ?? null,
    updatedAt: manifest?.createdAt ?? null,
    lastSequence: 0,
    integrity: "failed",
    prompt: manifest?.request.prompt ?? null,
    workspace: manifest?.request.workspace ?? null,
    viewport: manifest?.request.viewport ?? null,
    artifacts: manifest ? [manifest.requestArtifact] : [],
    workspaceEvidence: [],
    browserBaselines: [],
    browserActions: [],
    browserVerificationReports: [],
    repairSpec: null,
    completion: null,
    effectControls: [],
    terminalError,
  });
}

/** 加载卷宗：正常路径返回 verified 卷宗，失败路径降级为 failed 卷宗。 */
async function loadDossier(runId: string): Promise<RunDossier> {
  try {
    return dossierFromRun(await getStore().loadRun(runId));
  } catch (error) {
    return failedDossier(runId, error);
  }
}

/**
 * 创建一次新的 Run（持久化清单与初始事件），返回创建响应。
 */
export async function createRun(request: RepairRequest): Promise<RunCreation> {
  const run = await getStore().createRun(request);
  return runCreationSchema.parse({
    schemaVersion: RUN_CREATION_SCHEMA_VERSION,
    status: "created",
    runId: run.manifest.runId,
    snapshot: run.snapshot,
  });
}

/** R9 当前唯一可执行场景；其它请求继续走通用运行时而不伪造规范。 */
async function roundButtonScenarioFor(
  run: DurableRun,
): Promise<ScenarioManifest | null> {
  if (
    run.manifest.request.prompt.trim() !==
    "Make the primary Save button clearly rounded instead of square."
  ) {
    return null;
  }
  const packageJson = JSON.parse(
    await readFile(
      path.join(run.manifest.request.workspace.path, "package.json"),
      "utf8",
    ),
  ) as { name?: string };
  if (packageJson.name !== "@prism/fixture-react-repair") return null;
  return createRoundButtonScenario({
    fixtureRoot: run.manifest.request.workspace.path,
  });
}

/** 在任何源码副作用前把规范与内容哈希一起写入 Journal。 */
async function commitRepairSpec(
  store: FileTrajectoryStore,
  run: DurableRun,
  scenario: ScenarioManifest,
): Promise<void> {
  if (run.snapshot.repairSpec) return;
  const artifact = await store.writeArtifact(
    `${JSON.stringify(scenario.spec)}\n`,
    FRONTEND_REPAIR_SPEC_MEDIA_TYPE,
  );
  await store.recordFrontendRepairSpec(run.manifest.runId, {
    spec: scenario.spec,
    artifact,
  });
}

function proposalDecision(
  run: DurableRun,
  proposalId: string,
): EffectApprovalDecision | undefined {
  return run.snapshot.effectControls.find(
    (control): control is EffectApprovalDecision =>
      control.kind === "decision" && control.proposalId === proposalId,
  );
}

function pendingProposal(run: DurableRun): EffectApprovalProposal | undefined {
  return [...run.snapshot.effectControls]
    .reverse()
    .find(
      (control): control is EffectApprovalProposal =>
        control.kind === "proposal" && !proposalDecision(run, control.proposalId),
    );
}

async function sourceReality(scenario: ScenarioManifest) {
  const fileHashes: Record<string, string> = {};
  for (const relativePath of Object.keys(scenario.knownBad.fileHashes).sort()) {
    fileHashes[relativePath] = createHash("sha256")
      .update(await readFile(path.join(scenario.fixturePath, relativePath)))
      .digest("hex");
  }
  return `${JSON.stringify({
    schemaVersion: "prism.source-observation/v1",
    fileHashes,
  })}\n`;
}

/** 用已提交现实证据创建一个绑定下一 fencing token 的最小源码审批提议。 */
async function proposeSourceEffect(
  store: FileTrajectoryStore,
  run: DurableRun,
  scenario: ScenarioManifest,
): Promise<void> {
  if (pendingProposal(run)) return;
  const node = run.snapshot.dagRevisions
    .at(-1)
    ?.nodes.find(({ nodeType }) => nodeType === "workspace.patch");
  if (!node) return;
  const observation = await store.writeArtifact(
    await sourceReality(scenario),
    "application/vnd.prism.source-observation+json",
  );

  const recordedAt = new Date();
  const digestInput: Omit<EffectApprovalProposal, "proposalDigest"> = {
    schemaVersion: "prism.effect-control/v1",
    kind: "proposal",
    controlId: randomUUID(),
    proposalId: randomUUID(),
    runId: run.manifest.runId,
    nodeId: node.nodeId,
    origin: "pi",
    target: {
      kind: "workspace",
      displayName: run.manifest.request.workspace.displayName,
      paths: scenario.codeOracle.scopedPaths.map((value) => value.replace(/\/$/u, "")),
    },
    effectClass: "source_effect",
    parameters: [
      { name: "operation", redactedValue: "apply a scoped source patch" },
      {
        name: "scope",
        redactedValue: scenario.codeOracle.scopedPaths.join(", "),
      },
    ],
    preconditions: {
      observationArtifact: observation,
      observationDigest: observation.hash,
      fencingToken: (run.snapshot.effectLease?.token ?? 0) + 1,
      expiresAt: new Date(recordedAt.getTime() + 15 * 60_000).toISOString(),
    },
    reason: "Pi proposes a scoped source repair after the committed browser baseline.",
    recordedAt: recordedAt.toISOString(),
  };
  await store.recordEffectControl(run.manifest.runId, {
    ...digestInput,
    proposalDigest: effectApprovalDigest(digestInput),
  });
}

/**
 * 被消费的源码效果若未提交终态，先与已知缺陷内容核对；只有逐字节未变化时
 * 才允许重新提议，任何部分效果或不可判定状态都转人工。
 */
async function reconcileInterruptedSourceEffect(
  store: FileTrajectoryStore,
  run: DurableRun,
  scenario: ScenarioManifest,
): Promise<boolean> {
  const activeLease =
    run.snapshot.effectLease?.state === "active" &&
    run.snapshot.effectLease.effectClass === "source_effect" &&
    !run.snapshot.nodeProgress.some(
      ({ nodeId, state }) =>
        nodeId === run.snapshot.effectLease?.holderNodeId &&
        ["succeeded", "failed", "blocked"].includes(state),
    )
      ? run.snapshot.effectLease
      : null;
  const consumption = [...run.snapshot.effectControls]
    .reverse()
    .find(
      (control) =>
        control.kind === "consumption" &&
        !run.snapshot.nodeProgress.some(
          ({ nodeId, state }) =>
            nodeId === control.nodeId &&
            ["succeeded", "failed", "blocked"].includes(state),
        ),
    );
  if ((!consumption || consumption.kind !== "consumption") && !activeLease) return true;
  const nodeId =
    consumption?.kind === "consumption"
      ? consumption.nodeId
      : activeLease!.holderNodeId;
  const proposalId =
    consumption?.kind === "consumption" ? consumption.proposalId : null;
  if (
    run.snapshot.effectControls.some(
      (control) => control.kind === "reconciliation" && control.nodeId === nodeId,
    )
  ) {
    return run.snapshot.status !== "blocked";
  }

  let outcome: "no_effect" | "effect_detected" | "unknown" = "no_effect";
  let observationDigest = "0".repeat(64);
  try {
    const reality = await sourceReality(scenario);
    observationDigest = createHash("sha256").update(reality).digest("hex");
    const current = JSON.parse(reality) as {
      fileHashes: Record<string, string>;
    };
    outcome = Object.entries(scenario.knownBad.fileHashes).every(
      ([relativePath, knownHash]) => current.fileHashes[relativePath] === knownHash,
    )
      ? "no_effect"
      : "effect_detected";
  } catch {
    outcome = "unknown";
  }
  const evidence = await store.writeArtifact(
    `${JSON.stringify({
      schemaVersion: "prism.effect-reality-check/v1",
      nodeId,
      outcome,
      knownBad: scenario.knownBad,
    })}\n`,
    "application/vnd.prism.effect-reality-check+json",
  );
  if (!proposalId && activeLease) {
    const proposal = [...run.snapshot.effectControls]
      .reverse()
      .find(
        (control): control is EffectApprovalProposal =>
          control.kind === "proposal" && control.nodeId === activeLease.holderNodeId,
      );
    if (
      proposal &&
      proposalDecision(run, proposal.proposalId)?.decision === "approved"
    ) {
      await store.recordEffectControl(run.manifest.runId, {
        schemaVersion: "prism.effect-control/v1",
        kind: "decision",
        controlId: randomUUID(),
        proposalId: proposal.proposalId,
        proposalDigest: proposal.proposalDigest,
        decision: "invalidated",
        observationDigest,
        fencingToken: activeLease.token,
        reason: "The process stopped before approved authority was consumed.",
        recordedAt: new Date().toISOString(),
      });
    }
  }
  if (activeLease) {
    await store.recordEffectLease(run.manifest.runId, {
      ...activeLease,
      state: "released",
      recordedAt: new Date().toISOString(),
    });
  }
  await store.recordEffectControl(run.manifest.runId, {
    schemaVersion: "prism.effect-control/v1",
    kind: "reconciliation",
    controlId: randomUUID(),
    proposalId,
    nodeId,
    effectClass: "source_effect",
    outcome,
    action: outcome === "no_effect" ? "repropose" : "human_review",
    evidenceRefs: [evidence],
    reason:
      outcome === "no_effect"
        ? "The interrupted source effect changed no scoped file; fresh authority is required."
        : "The interrupted source effect is partial or unknowable and requires human review.",
    recordedAt: new Date().toISOString(),
  });
  if (outcome !== "no_effect") return false;
  await proposeSourceEffect(store, await store.loadRun(run.manifest.runId), scenario);
  return false;
}

/** 浏览器副作用中断后只提交当前渲染事实；无法证明动作是否发生，直接转人工。 */
async function reconcileInterruptedBrowserEffect(
  store: FileTrajectoryStore,
  run: DurableRun,
  scenario: ScenarioManifest,
): Promise<boolean> {
  const lease = run.snapshot.effectLease;
  if (
    lease?.state !== "active" ||
    lease.effectClass !== "browser_effect" ||
    run.snapshot.nodeProgress.some(
      ({ nodeId, state }) =>
        nodeId === lease.holderNodeId &&
        ["succeeded", "failed", "blocked"].includes(state),
    )
  ) {
    return true;
  }

  let observation: unknown;
  try {
    observation = await new BrowserOracle({
      baseUrl: browserBaseUrl(),
      route: scenario.route,
      viewport: scenario.viewport,
      target: scenario.browserOracle.target,
      executablePath: process.env.PRISM_BROWSER_EXECUTABLE_PATH?.trim() || undefined,
    }).observe();
  } catch {
    observation = { unavailable: true };
  }
  const evidence = await store.writeArtifact(
    `${JSON.stringify({
      schemaVersion: "prism.browser-effect-reality-check/v1",
      nodeId: lease.holderNodeId,
      observation,
    })}\n`,
    "application/vnd.prism.effect-reality-check+json",
  );
  await store.recordEffectLease(run.manifest.runId, {
    ...lease,
    state: "released",
    recordedAt: new Date().toISOString(),
  });
  await store.recordEffectControl(run.manifest.runId, {
    schemaVersion: "prism.effect-control/v1",
    kind: "reconciliation",
    controlId: randomUUID(),
    proposalId: null,
    nodeId: lease.holderNodeId,
    effectClass: "browser_effect",
    outcome: "unknown",
    action: "human_review",
    evidenceRefs: [evidence],
    reason:
      "Current browser reality is committed, but it cannot prove whether the interrupted input fired.",
    recordedAt: new Date().toISOString(),
  });
  return false;
}

/** 通过同一个 WorkspaceExecutor 运行权威 build/test，并提交一份 code Oracle。 */
async function runCodeOracle(
  store: FileTrajectoryStore,
  runId: string,
  executor: WorkspaceExecutor,
  scenario: ScenarioManifest,
) {
  const evidenceRefs: ArtifactRef[] = [];
  const result = await new CodeOracle({
    workspaceRoot: scenario.fixturePath,
    scopedPaths: scenario.codeOracle.scopedPaths,
    buildCommand: scenario.codeOracle.buildCommand,
    testCommand: scenario.codeOracle.testCommand,
    knownBadRevision: scenario.knownBad.revision,
    runner: {
      run: async (command, _cwd, timeoutMs) => {
        const record = await store.recordWorkspaceEffect(runId, async () => {
          const evidence = await executor.execute({
            schemaVersion: "prism.workspace-request/v1",
            requestId: randomUUID(),
            runId,
            operation: "test",
            command,
            workingDirectory: ".",
            timeoutMs: timeoutMs ?? 120_000,
          });
          const artifact = await store.writeArtifact(
            `${JSON.stringify(evidence)}\n`,
            WORKSPACE_EVIDENCE_MEDIA_TYPE,
          );
          return workspaceEvidenceRecordSchema.parse({ evidence, artifact });
        });
        evidenceRefs.push(record.artifact);
        const details = record.evidence.details;
        return details.operation === "test"
          ? {
              exitCode: details.exitCode,
              stdout: details.stdout,
              stderr: details.stderr,
            }
          : { exitCode: null, stdout: "", stderr: "Invalid command evidence." };
      },
    },
  }).verify();
  const artifact = await store.writeArtifact(
    `${JSON.stringify({ ...result, evidenceRefs })}\n`,
    CODE_ORACLE_REPORT_MEDIA_TYPE,
  );
  return { result, artifact };
}

/**
 * 启动一次 live 混合编排运行。
 *
 * 幂等：同一 Run 已在运行则等其初始修订写入后直接返回 true。
 * 首次启动时构造 OrchestrationJournal（把编排写入转发到轨迹存储），
 * 并创建受 WorkspaceExecutor 约束的 Pi Coding Runtime；用门闩等待首个
 * DAG 修订落盘后再返回，保证调用方看到的 Run 已可继续。
 *
 * @returns true 表示编排已在运行或已启动；false 表示 Run 不存在/ID 非法
 */
export async function startHybridRun(
  runIdInput: string,
  options: {
    piSessionFactory?: PiSessionFactory;
    browserSessionFactory?: BrowserSessionFactory;
    browserPortFactory?: BrowserPortFactory;
    browserConfig?: {
      route: string;
      target: BrowserBaselineRequest["target"];
    };
    verifier?: BrowserVerifier;
    stopAfterNodeType?: RunDagNodeType;
  } = {},
): Promise<boolean> {
  const parsedRunId = runIdSchema.safeParse(runIdInput);
  if (!parsedRunId.success) return false;

  const store = getStore();
  const runIds = await store.listRunIds();
  if (!runIds.includes(parsedRunId.data)) return false;

  const key = hybridRunKey(store.dataDirectory, parsedRunId.data);
  const activeRun = activeHybridRuns.get(key);
  if (activeRun) {
    await activeRun.initialRevisionCommitted;
    return true;
  }

  const run = await store.loadRun(parsedRunId.data);
  if (["completed", "blocked", "cancelled"].includes(run.snapshot.status)) return true;
  const scenario = await roundButtonScenarioFor(run);
  if (scenario) await commitRepairSpec(store, run, scenario);
  let resumedRun = await store.loadRun(parsedRunId.data);
  if (resumedRun.snapshot.status === "awaiting_approval") return true;
  if (
    scenario &&
    !(await reconcileInterruptedSourceEffect(store, resumedRun, scenario))
  ) {
    return true;
  }
  resumedRun = await store.loadRun(parsedRunId.data);
  if (
    scenario &&
    !(await reconcileInterruptedBrowserEffect(store, resumedRun, scenario))
  ) {
    return true;
  }
  resumedRun = await store.loadRun(parsedRunId.data);
  const latestRevision = resumedRun.snapshot.dagRevisions.at(-1);
  const resume = latestRevision
    ? {
        revision: latestRevision,
        completedNodeIds: Array.from(
          new Set(
            resumedRun.snapshot.nodeProgress
              .filter(({ state }) => state === "succeeded")
              .map(({ nodeId }) => nodeId),
          ),
        ),
        artifacts: resumedRun.snapshot.artifacts,
        latestVerificationReport:
          resumedRun.snapshot.browserVerificationReports.at(-1) ?? null,
        fencingTokenFloor: resumedRun.snapshot.effectLease?.token ?? 0,
      }
    : undefined;
  const piSessionFactory =
    options.piSessionFactory ??
    (await createConfiguredPiSdkSessionFactory({
      cwd: run.manifest.request.workspace.path,
      provider: process.env.PRISM_PI_PROVIDER?.trim() || undefined,
      modelId: process.env.PRISM_PI_MODEL?.trim() || undefined,
    }));
  const workspaceExecutor = await createRunWorkspaceExecutor(
    run.manifest.request.workspace.path,
  );
  const codingRuntime = new PiCodingRuntime({
    sessionFactory: piSessionFactory,
    artifacts: {
      commit: (content, mediaType) => store.writeArtifact(content, mediaType),
    },
    workspace: {
      guidance: {
        allowedReadPatterns: RUN_WORKSPACE_READ_PATTERNS,
        allowedDiscoveryPatterns: RUN_WORKSPACE_DISCOVERY_PATTERNS,
      },
      execute: (request, signal) =>
        store.recordWorkspaceEffect(parsedRunId.data, async () => {
          const evidence = await workspaceExecutor.execute(request, { signal });
          const artifact = await store.writeArtifact(
            `${JSON.stringify(evidence)}\n`,
            WORKSPACE_EVIDENCE_MEDIA_TYPE,
          );
          return workspaceEvidenceRecordSchema.parse({ evidence, artifact });
        }),
    },
  });
  const gatedCodingRuntime = scenario
    ? {
        execute: async (
          envelope: Parameters<PiCodingRuntime["execute"]>[0],
          executionOptions?: Parameters<PiCodingRuntime["execute"]>[1],
        ) => {
          const runtimeResult = await codingRuntime.execute(envelope, executionOptions);
          if (
            envelope.nodeType !== "workspace.patch" ||
            runtimeResult.outcome.state !== "succeeded"
          ) {
            return runtimeResult;
          }

          const oracle = await runCodeOracle(
            store,
            parsedRunId.data,
            workspaceExecutor,
            scenario,
          );
          return piRuntimeResultSchema.parse({
            ...runtimeResult,
            outcome: oracle.result.passed
              ? runtimeResult.outcome
              : {
                  nodeId: envelope.nodeId,
                  attempt: envelope.attempt,
                  state: "failed",
                  summary: "The scoped code Oracle failed.",
                  request: { kind: "none" },
                  failure: { code: "verification_failed", retryable: false },
                },
            artifacts: oracle.result.passed
              ? [...runtimeResult.artifacts, oracle.artifact]
              : runtimeResult.artifacts,
          });
        },
      }
    : codingRuntime;

  const browserConfig = browserRunConfig(
    options.browserConfig ??
      (scenario
        ? { route: scenario.route, target: scenario.browserOracle.target }
        : undefined),
  );
  const baseUrl = browserBaseUrl();
  const storedBaselineObservation = resumedRun.snapshot.artifacts.find(
    ({ mediaType }) => mediaType === BROWSER_ORACLE_OBSERVATION_MEDIA_TYPE,
  );
  let baselineObservation: RenderedTargetObservation | null = storedBaselineObservation
    ? (JSON.parse(
        Buffer.from(await store.readArtifact(storedBaselineObservation)).toString(
          "utf8",
        ),
      ) as RenderedTargetObservation)
    : null;
  const browserOracle = scenario
    ? new BrowserOracle({
        baseUrl,
        route: scenario.route,
        viewport: scenario.viewport,
        target: scenario.browserOracle.target,
        executablePath: process.env.PRISM_BROWSER_EXECUTABLE_PATH?.trim() || undefined,
      })
    : null;
  const browserSessionFactory =
    options.browserSessionFactory ??
    (await createConfiguredAgentPlanBrowserSessionFactory({}));
  const browserRuntime = new BrowserRuntime({
    baseUrl,
    viewport: run.manifest.request.viewport,
    browserPortFactory:
      options.browserPortFactory ??
      new PlaywrightBrowserPortFactory({
        executablePath: process.env.PRISM_BROWSER_EXECUTABLE_PATH?.trim() || undefined,
      }),
    sessionFactory: browserSessionFactory,
    verifier:
      scenario && browserOracle
        ? {
            verify: async () => {
              if (!baselineObservation) {
                return {
                  assertion: "The committed rendered baseline is unavailable.",
                  status: "inconclusive" as const,
                };
              }
              const after = await browserOracle.observe();
              const evaluation = BrowserOracle.evaluateSpec(
                scenario.spec,
                baselineObservation,
                after,
              );
              const evidence = await store.writeArtifact(
                `${JSON.stringify({
                  schemaVersion: "prism.browser-oracle-evaluation/v1",
                  before: baselineObservation,
                  after,
                  evaluation,
                })}\n`,
                "application/vnd.prism.browser-oracle-evaluation+json",
              );
              return {
                assertion: evaluation.assertions
                  .map(({ assertion }) => assertion)
                  .join(" "),
                status: evaluation.verdict,
                evidenceRefs: [evidence],
              };
            },
          }
        : options.verifier,
    artifacts: {
      commit: (content, mediaType) => store.writeArtifact(content, mediaType),
    },
  });
  const browserRuntimeWithBaseline =
    scenario && browserOracle
      ? {
          execute: async (
            envelope: BrowserRuntimeTaskEnvelope,
            executionOptions?: Parameters<BrowserRuntime["execute"]>[1],
          ) => {
            let observationArtifact: ArtifactRef | null = null;
            if (envelope.nodeType === "browser.observe" && !baselineObservation) {
              await captureBrowserBaseline(parsedRunId.data, {
                schemaVersion: "prism.browser-baseline-request/v1",
                requestId: randomUUID(),
                runId: parsedRunId.data,
                route: scenario.route,
                target: scenario.browserOracle.target,
              });
              baselineObservation = await browserOracle.observe();
              observationArtifact = await store.writeArtifact(
                `${JSON.stringify(baselineObservation)}\n`,
                BROWSER_ORACLE_OBSERVATION_MEDIA_TYPE,
              );
            }
            const result = await browserRuntime.execute(envelope, executionOptions);
            return {
              ...result,
              artifacts: observationArtifact
                ? [...result.artifacts, observationArtifact]
                : result.artifacts,
            } satisfies BrowserRuntimeResult;
          },
        }
      : browserRuntime;

  // 门闩：首个 DAG 修订（revision 1）写入日志时放行启动请求
  let resolveInitialRevision: (() => void) | undefined;
  let rejectInitialRevision: ((reason?: unknown) => void) | undefined;
  let initialRevisionCommitted = false;
  const initialRevisionReady = new Promise<void>((resolve, reject) => {
    resolveInitialRevision = resolve;
    rejectInitialRevision = reject;
  });
  if (resume) {
    initialRevisionCommitted = true;
    resolveInitialRevision?.();
  }

  const journal: OrchestrationJournal = {
    appendDagRevision: async (revision) => {
      await store.recordDagRevision(parsedRunId.data, revision);
      if (revision.revision === 1) {
        initialRevisionCommitted = true;
        resolveInitialRevision?.();
      }
    },
    appendNodeProgress: async (progress) => {
      await store.recordNodeProgress(parsedRunId.data, progress);
    },
    appendEffectLease: async (lease) => {
      await store.recordEffectLease(parsedRunId.data, lease);
    },
    appendBrowserAction: async (record) => {
      await store.recordBrowserAction(parsedRunId.data, async () => record);
    },
    appendVerificationReport: async (report) => {
      await store.recordBrowserVerification(parsedRunId.data, async () => report);
    },
    appendRunCompletion: async (completionRecord) => {
      await store.recordRunCompletion(parsedRunId.data, completionRecord);
    },
  };
  const controller = new AbortController();
  const approvedEffectClasses: Array<"source_effect" | "browser_effect"> = [];
  const authorizeEffect = async (node: RunDagNode, fencingToken: number) => {
    if (node.effectClass === "browser_effect") return true;
    const current = await store.loadRun(parsedRunId.data);
    const proposal = [...current.snapshot.effectControls]
      .reverse()
      .find(
        (control): control is EffectApprovalProposal =>
          control.kind === "proposal" && control.nodeId === node.nodeId,
      );
    const decision = proposal && proposalDecision(current, proposal.proposalId);
    const consumed = proposal
      ? current.snapshot.effectControls.some(
          (control) =>
            control.kind === "consumption" &&
            control.proposalId === proposal.proposalId,
        )
      : false;
    let observationDigest = proposal?.preconditions.observationDigest;
    try {
      if (scenario) {
        observationDigest = createHash("sha256")
          .update(await sourceReality(scenario))
          .digest("hex");
      }
    } catch {
      observationDigest = "0".repeat(64);
    }
    if (
      !proposal ||
      decision?.decision !== "approved" ||
      consumed ||
      proposal.preconditions.fencingToken !== fencingToken ||
      Date.parse(proposal.preconditions.expiresAt) < Date.now() ||
      observationDigest !== proposal.preconditions.observationDigest
    ) {
      if (proposal && decision?.decision === "approved" && !consumed) {
        await store.recordEffectControl(parsedRunId.data, {
          schemaVersion: "prism.effect-control/v1",
          kind: "decision",
          controlId: randomUUID(),
          proposalId: proposal.proposalId,
          proposalDigest: proposal.proposalDigest,
          decision: "invalidated",
          observationDigest: observationDigest ?? "0".repeat(64),
          fencingToken,
          reason:
            "The approved proposal expired or its bound observation or fencing token drifted before consumption.",
          recordedAt: new Date().toISOString(),
        });
      }
      return false;
    }
    await store.recordEffectControl(parsedRunId.data, {
      schemaVersion: "prism.effect-control/v1",
      kind: "consumption",
      controlId: randomUUID(),
      proposalId: proposal.proposalId,
      proposalDigest: proposal.proposalDigest,
      nodeId: node.nodeId,
      fencingToken,
      recordedAt: new Date().toISOString(),
    });
    approvedEffectClasses.push("source_effect");
    return true;
  };
  const requireInitialSourceApproval =
    scenario &&
    !resumedRun.snapshot.effectControls.some(
      (control) =>
        control.kind === "proposal" && control.effectClass === "source_effect",
    );
  const completion = new Orchestrator()
    .executeHybridRun({
      runId: parsedRunId.data,
      prompt: run.manifest.request.prompt,
      journal,
      codingRuntime: gatedCodingRuntime,
      browserRuntime: browserRuntimeWithBaseline,
      browserConfig: {
        route: browserConfig.route,
        target: browserConfig.target,
      },
      resume,
      signal: controller.signal,
      authorizeEffect: scenario ? authorizeEffect : undefined,
      approvedEffectClasses,
      stopAfterNodeType: requireInitialSourceApproval
        ? "browser.observe"
        : options.stopAfterNodeType,
    })
    .then(async () => {
      if (scenario) {
        const current = await store.loadRun(parsedRunId.data);
        if (
          current.snapshot.status === "queued" &&
          !current.snapshot.nodeProgress.some(
            ({ nodeType, state }) =>
              nodeType === "workspace.patch" && state === "succeeded",
          )
        ) {
          await proposeSourceEffect(store, current, scenario);
        }
      }
    })
    .catch((error) => {
      // 若首个修订尚未落盘即失败，放开门闩并让启动请求收到错误
      if (!initialRevisionCommitted) {
        rejectInitialRevision?.(error);
      }
      return undefined;
    })
    .finally(() => {
      activeHybridRuns.delete(key);
    });
  activeHybridRuns.set(key, {
    initialRevisionCommitted: initialRevisionReady,
    completion,
    controller,
  });
  await initialRevisionReady;
  return true;
}

/**
 * 等待一次 live 混合运行完成，返回最终卷宗。
 *
 * @returns 运行结束后的卷宗；Run 不存在/ID 非法返回 null
 */
export async function waitForHybridRun(runIdInput: string): Promise<RunDossier | null> {
  const parsedRunId = runIdSchema.safeParse(runIdInput);
  if (!parsedRunId.success) return null;

  const store = getStore();
  const key = hybridRunKey(store.dataDirectory, parsedRunId.data);
  await activeHybridRuns.get(key)?.completion;
  return getRunDossier(parsedRunId.data);
}

/** 提交一次绑定 proposal digest 的人类裁决；批准后从持久化节点边界继续。 */
export async function decideRunEffect(
  runIdInput: string,
  request: EffectDecisionRequest,
): Promise<RunDossier | null> {
  const parsedRunId = runIdSchema.safeParse(runIdInput);
  if (!parsedRunId.success) return null;
  const store = getStore();
  const run = await store.loadRun(parsedRunId.data);
  const proposal = pendingProposal(run);
  if (
    !proposal ||
    proposal.proposalId !== request.proposalId ||
    proposal.proposalDigest !== request.proposalDigest
  ) {
    throw new TypeError("The effect decision does not match the pending proposal.");
  }

  const scenario = await roundButtonScenarioFor(run);
  let observationDigest = proposal.preconditions.observationDigest;
  try {
    if (scenario) {
      observationDigest = createHash("sha256")
        .update(await sourceReality(scenario))
        .digest("hex");
    }
  } catch {
    observationDigest = "0".repeat(64);
  }
  const unchanged =
    observationDigest === proposal.preconditions.observationDigest &&
    proposal.preconditions.fencingToken ===
      (run.snapshot.effectLease?.token ?? 0) + 1 &&
    Date.parse(proposal.preconditions.expiresAt) >= Date.now();
  const decision = unchanged ? request.decision : "invalidated";
  await store.recordEffectControl(parsedRunId.data, {
    schemaVersion: "prism.effect-control/v1",
    kind: "decision",
    controlId: randomUUID(),
    proposalId: proposal.proposalId,
    proposalDigest: proposal.proposalDigest,
    decision,
    observationDigest,
    fencingToken: proposal.preconditions.fencingToken,
    reason:
      decision === "approved"
        ? "The user approved this exact bounded proposal once."
        : decision === "declined"
          ? "The user declined the proposed effect."
          : decision === "cancelled"
            ? "The user cancelled the Run before the proposed effect."
            : "The proposal expired or its bound observation or fencing token drifted.",
    recordedAt: new Date().toISOString(),
  });

  if (decision === "cancelled") {
    activeHybridRuns
      .get(hybridRunKey(store.dataDirectory, parsedRunId.data))
      ?.controller.abort();
  } else if (decision === "invalidated" && scenario) {
    await proposeSourceEffect(store, await store.loadRun(parsedRunId.data), scenario);
  }
  return getRunDossier(parsedRunId.data);
}

/**
 * 列出最近 Run 摘要，按创建时间倒序。
 *
 * 读取失败的 Run 以降级摘要（terminal_error / integrity=failed）参与排序。
 */
export async function listRecentRuns(): Promise<readonly RecentRun[]> {
  const runIds = await getStore().listRunIds();
  const dossiers = await Promise.all(runIds.map((runId) => loadDossier(runId)));

  return dossiers
    .map((dossier) =>
      runSummarySchema.parse({
        id: dossier.id,
        title: dossier.title,
        status: dossier.status,
        createdAt: dossier.createdAt,
        updatedAt: dossier.updatedAt,
        lastSequence: dossier.lastSequence,
        integrity: dossier.integrity,
      }),
    )
    .sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""));
}

/**
 * 获取单个 Run 的卷宗。
 *
 * @returns 卷宗；Run 不存在或 ID 非法返回 null（区别于读取失败的降级卷宗）
 */
export async function getRunDossier(runIdInput: string): Promise<RunDossier | null> {
  const parsedRunId = runIdSchema.safeParse(runIdInput);
  if (!parsedRunId.success) {
    return null;
  }

  const runIds = await getStore().listRunIds();
  if (!runIds.includes(parsedRunId.data)) {
    return null;
  }

  return loadDossier(parsedRunId.data);
}

/** 为一个 Run 创建唯一的受限 WorkspaceExecutor 配置。 */
async function createRunWorkspaceExecutor(workspaceRoot: string) {
  return WorkspaceExecutor.create({
    workspaceRoot,
    allowedReadPatterns: RUN_WORKSPACE_READ_PATTERNS,
    allowedDiscoveryPatterns: RUN_WORKSPACE_DISCOVERY_PATTERNS,
    allowedCommands: [
      {
        command: { executable: "pnpm", arguments: ["test"] },
        workingDirectories: ["."],
      },
      {
        command: { executable: "pnpm", arguments: ["build"] },
        workingDirectories: ["."],
      },
    ],
  });
}

/**
 * 对某 Run 执行一次工作区请求，并把证据落盘为一条工作区证据事件。
 *
 * WorkspaceExecutor 按 Run 请求中的工作区路径配置受限读写与允许命令
 * （读源码目录、发现测试文件、运行 pnpm test）。执行结果连同其内容
 * 寻址产物一并作为 evidence record 持久化。
 *
 * @throws TypeError 请求的 Run ID 与路由 Run ID 不一致时
 * @returns 证据记录；Run 不存在或 ID 非法返回 null
 */
export async function executeWorkspaceRequest(
  runIdInput: string,
  requestInput: unknown,
  signal?: AbortSignal,
): Promise<WorkspaceEvidenceRecord | null> {
  const parsedRunId = runIdSchema.safeParse(runIdInput);
  if (!parsedRunId.success) return null;

  const store = getStore();
  const runIds = await store.listRunIds();
  if (!runIds.includes(parsedRunId.data)) return null;

  const request = workspaceRequestSchema.parse(requestInput);
  if (request.runId !== parsedRunId.data) {
    throw new TypeError("Workspace request Run ID does not match the route Run ID.");
  }

  return store.recordWorkspaceEffect(parsedRunId.data, async (run) => {
    const executor = await createRunWorkspaceExecutor(
      run.manifest.request.workspace.path,
    );
    const evidence = await executor.execute(request, { signal });
    const artifact = await store.writeArtifact(
      `${JSON.stringify(evidence)}\n`,
      WORKSPACE_EVIDENCE_MEDIA_TYPE,
    );
    return workspaceEvidenceRecordSchema.parse({ evidence, artifact });
  });
}

/** 读取浏览器基线基础 URL；未配置时抛出配置错误。 */
function browserBaseUrl(): string {
  const configured = process.env.PRISM_BROWSER_BASE_URL?.trim();
  if (!configured) {
    throw new BrowserBaselineConfigurationError(
      "Set PRISM_BROWSER_BASE_URL to an allowlisted local HTTP origin.",
    );
  }

  return configured;
}

/** 浏览器运行的路由与采集目标配置（优先显式注入，否则用环境变量默认值）。 */
function browserRunConfig(configured?: {
  route: string;
  target: BrowserBaselineRequest["target"];
}): { route: string; target: BrowserBaselineRequest["target"] } {
  if (configured) return configured;

  return {
    route: "/",
    target: { kind: "semantic", role: "main", name: "main", exact: false },
  };
}

/** 构建身份标识，默认 "development"。 */
function browserBuildIdentity(): string {
  return process.env.PRISM_BUILD_ID?.trim() || "development";
}

/**
 * 为某 Run 采集一次浏览器基线，并把全部产物写入存储、证据事件落盘。
 *
 * @throws TypeError 请求的 Run ID 与路由 Run ID 不一致时
 * @returns 完整基线记录；Run 不存在或 ID 非法返回 null
 */
export async function captureBrowserBaseline(
  runIdInput: string,
  requestInput: unknown,
): Promise<BrowserBaselineRecord | null> {
  const parsedRunId = runIdSchema.safeParse(runIdInput);
  if (!parsedRunId.success) return null;

  const request: BrowserBaselineRequest =
    browserBaselineRequestSchema.parse(requestInput);
  if (request.runId !== parsedRunId.data) {
    throw new TypeError("Browser Baseline Run ID does not match the route Run ID.");
  }

  const store = getStore();
  const runIds = await store.listRunIds();
  if (!runIds.includes(parsedRunId.data)) return null;

  const baseUrl = browserBaseUrl();
  return store.recordBrowserEffect(parsedRunId.data, async (run) => {
    const executor = new BrowserExecutor({
      baseUrl,
      buildIdentity: browserBuildIdentity(),
      viewport: run.manifest.request.viewport,
      executablePath: process.env.PRISM_BROWSER_EXECUTABLE_PATH?.trim() || undefined,
    });
    const capture = await executor.captureBaseline(request);
    // 7 类产物并行写入内容寻址存储
    const [screenshot, dom, accessibility, computed, consoleArtifact, network, trace] =
      await Promise.all([
        store.writeArtifact(capture.artifacts.screenshot, "image/png"),
        store.writeArtifact(capture.artifacts.dom, BROWSER_EVIDENCE_MEDIA_TYPE),
        store.writeArtifact(
          capture.artifacts.accessibility,
          BROWSER_EVIDENCE_MEDIA_TYPE,
        ),
        store.writeArtifact(capture.artifacts.computed, BROWSER_EVIDENCE_MEDIA_TYPE),
        store.writeArtifact(capture.artifacts.console, BROWSER_EVIDENCE_MEDIA_TYPE),
        store.writeArtifact(capture.artifacts.network, BROWSER_EVIDENCE_MEDIA_TYPE),
        store.writeArtifact(capture.artifacts.trace, "application/zip"),
      ]);

    return {
      ...capture.baseline,
      screenshot,
      dom,
      accessibility,
      computed,
      console: consoleArtifact,
      network,
      trace,
    };
  });
}

/**
 * 读取某 Run 快照中引用的内容寻址产物。
 *
 * @returns 产物引用与字节内容；Run/产物不存在或 ID 非法返回 null
 */
export async function getRunArtifact(
  runIdInput: string,
  artifactHash: string,
): Promise<{ artifact: ArtifactRef; content: Uint8Array } | null> {
  const parsedRunId = runIdSchema.safeParse(runIdInput);
  if (!parsedRunId.success) return null;

  const store = getStore();
  const runIds = await store.listRunIds();
  if (!runIds.includes(parsedRunId.data)) return null;

  const run = await store.loadRun(parsedRunId.data);
  const artifact = run.snapshot.artifacts.find(
    (candidate) => candidate.hash === artifactHash,
  );
  if (!artifact) return null;

  return { artifact, content: await store.readArtifact(artifact) };
}
