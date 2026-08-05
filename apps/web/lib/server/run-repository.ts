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
  type RepairRequest,
  RUN_CREATION_SCHEMA_VERSION,
  type RunCreation,
  runCreationSchema,
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
import { type OrchestrationJournal, Orchestrator } from "@prism/orchestrator";
import {
  createConfiguredPiSdkSessionFactory,
  PiCodingRuntime,
  type PiSessionFactory,
} from "@prism/runtime-pi";
import {
  createConfiguredUiTarsSdkSessionFactory,
  PlaywrightBrowserPortFactory,
  type UiTarsBrowserPortFactory,
  UiTarsBrowserRuntime,
  type UiTarsSessionFactory,
  type UiTarsVerifier,
} from "@prism/runtime-ui-tars";
import {
  type DurableRun,
  FileTrajectoryStore,
  RunIntegrityError,
  runTitleFromPrompt,
} from "@prism/trajectory-store";
import { WorkspaceExecutor } from "@prism/workspace-executor";

/** 工作区证据产物的媒体类型。 */
const WORKSPACE_EVIDENCE_MEDIA_TYPE = "application/vnd.prism.workspace-evidence+json";
/** 浏览器证据产物的媒体类型。 */
const BROWSER_EVIDENCE_MEDIA_TYPE = "application/vnd.prism.browser-evidence+json";

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
}

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
    dagRevisions: run.snapshot.dagRevisions,
    nodeProgress: run.snapshot.nodeProgress,
    effectLease: run.snapshot.effectLease,
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
    uiTarsSessionFactory?: UiTarsSessionFactory;
    browserPortFactory?: UiTarsBrowserPortFactory;
    browserConfig?: {
      route: string;
      target: BrowserBaselineRequest["target"];
    };
    verifier?: UiTarsVerifier;
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

  const browserConfig = browserRunConfig(options.browserConfig);
  const uiTarsSessionFactory =
    options.uiTarsSessionFactory ??
    (await createConfiguredUiTarsSdkSessionFactory({}));
  const browserRuntime = new UiTarsBrowserRuntime({
    baseUrl: browserBaseUrl(),
    viewport: run.manifest.request.viewport,
    browserPortFactory:
      options.browserPortFactory ??
      new PlaywrightBrowserPortFactory({
        executablePath: process.env.PRISM_BROWSER_EXECUTABLE_PATH?.trim() || undefined,
      }),
    sessionFactory: uiTarsSessionFactory,
    verifier: options.verifier,
    artifacts: {
      commit: (content, mediaType) => store.writeArtifact(content, mediaType),
    },
  });

  // 门闩：首个 DAG 修订（revision 1）写入日志时放行启动请求
  let resolveInitialRevision: (() => void) | undefined;
  let rejectInitialRevision: ((reason?: unknown) => void) | undefined;
  let initialRevisionCommitted = false;
  const initialRevisionReady = new Promise<void>((resolve, reject) => {
    resolveInitialRevision = resolve;
    rejectInitialRevision = reject;
  });

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
  };
  const completion = new Orchestrator()
    .executeHybridRun({
      runId: parsedRunId.data,
      prompt: run.manifest.request.prompt,
      journal,
      codingRuntime,
      browserRuntime,
      browserConfig: {
        route: browserConfig.route,
        target: browserConfig.target,
      },
    })
    .then(() => undefined)
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
    allowedReadPatterns: [
      "package.json",
      "README.md",
      "apps/**/*.{ts,tsx,json,mjs}",
      "packages/**/*.{ts,tsx,json,mjs}",
      "src/**/*.{ts,tsx,json,mjs}",
      "tests/**/*.{ts,tsx,json,mjs}",
    ],
    allowedDiscoveryPatterns: [
      "apps/**/*.{ts,tsx}",
      "packages/**/*.ts",
      "src/**/*.{ts,tsx}",
      "**/*.{test,spec}.{ts,tsx}",
    ],
    allowedCommands: [
      {
        command: { executable: "pnpm", arguments: ["test"] },
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
function browserRunConfig(
  configured?: { route: string; target: BrowserBaselineRequest["target"] },
): { route: string; target: BrowserBaselineRequest["target"] } {
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
