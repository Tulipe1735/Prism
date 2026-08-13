/**
 * Prism 编排器（orchestrator）包
 *
 * 负责一次修复任务从"自然语言请求"到"可执行 Run DAG"的编排过程：
 *  - Router：根据请求文案做路由分类（编码 / 浏览器 / 混合 / 不确定），
 *    并生成首个 DAG 修订；
 *  - DagScheduler：调度 DAG 中的就绪节点，只读节点并发执行，
 *    副作用节点通过单调递增的 fencing token 串行持锁执行；
 *  - Orchestrator：把上述两部分串起来，调用真实 Coding Runtime、临时
 *    Browser Runtime，并把节点进度 / 修订 / 副作用租约写入事件日志。
 *
 * Coding Runtime 通过 RuntimeTaskEnvelope / PiRuntimeResult port 接入；
 * Browser Runtime 仍由其后续 ticket 替换当前确定性占位执行体。
 */
import {
  type ArtifactRef,
  BROWSER_RUNTIME_TASK_ENVELOPE_SCHEMA_VERSION,
  type BrowserActionRecord,
  type BrowserCaptureTarget,
  type BrowserRuntimeBudget,
  type BrowserRuntimeResult,
  browserRuntimeResultSchema,
  type BrowserRuntimeTaskEnvelope,
  type BrowserVerificationReport,
  CODE_ORACLE_REPORT_MEDIA_TYPE,
  type EffectLease,
  type NodeOutcome,
  nodeOutcomeSchema,
  type PiRuntimeResult,
  piRuntimeResultSchema,
  ROUTER_DECISION_SCHEMA_VERSION,
  type RouterClassification,
  type RouterDecision,
  routerDecisionSchema,
  type RunCompletion,
  type RunDagNode,
  runDagNodeRegistry,
  type RunDagNodeType,
  type RunDagRevision,
  runDagRevisionSchema,
  type RunNodeProgress,
  RUNTIME_TASK_ENVELOPE_SCHEMA_VERSION,
  type RuntimeBudget,
  type RuntimeTaskEnvelope,
} from "@prism/contracts";

/** 路由输入：一个待分类的修复请求，携带 Run 标识与请求文案。 */
export interface RouterInput {
  runId: string;
  prompt: string;
}

/** 判断字符串是否包含任一给定词元（小写匹配）。 */
function includesAny(value: string, terms: readonly string[]): boolean {
  return terms.some((term) => value.includes(term));
}

/**
 * 基于关键词的启发式路由分类。
 *
 * 命中不确定词（unclear/unsure/maybe/investigate）直接判为 uncertain；
 * 否则按编码相关词（按钮/CSS/样式/布局等）与浏览器相关词（可见/渲染/点击/
 * 页面等）的命中情况归类为 coding / browser / hybrid，都没命中则 uncertain。
 */
function classify(prompt: string): RouterClassification {
  const normalized = prompt.toLowerCase();
  if (includesAny(normalized, ["unclear", "unsure", "maybe", "investigate"])) {
    return "uncertain";
  }

  const coding = includesAny(normalized, [
    "button",
    "css",
    "style",
    "shadow",
    "dialog",
    "form",
    "layout",
    "radius",
  ]);
  const browser = includesAny(normalized, [
    "visible",
    "button",
    "render",
    "rendered",
    "click",
    "page",
    "browser",
    "ui",
  ]);

  if (coding && browser) return "hybrid";
  if (coding) return "coding";
  if (browser) return "browser";
  return "uncertain";
}

/**
 * 根据分类生成首个 DAG 修订的初始节点集合。
 *
 * coding 只调度工作区检查，browser 只调度浏览器观测，其余两类调度两者。
 */
function initialNodes(classification: RouterClassification): RunDagNode[] {
  const workspace: RunDagNode = {
    nodeId: "node-1-workspace-inspect",
    nodeType: "workspace.inspect",
    runtime: "coding",
    effectClass: "read_only",
    predecessorIds: [],
    maxAttempts: 2,
  };
  const browser: RunDagNode = {
    nodeId: "node-1-browser-observe",
    nodeType: "browser.observe",
    runtime: "browser",
    effectClass: "read_only",
    predecessorIds: [],
    maxAttempts: 2,
  };

  if (classification === "coding") return [workspace];
  if (classification === "browser") return [browser];
  return [workspace, browser];
}

/** 路由决策声明的必需能力，派生自 RouterDecision 类型。 */
type RequiredCapability = RouterDecision["requiredCapabilities"][number];

/** 按分类声明执行该任务所需的能力集合。 */
function capabilities(classification: RouterClassification): RequiredCapability[] {
  if (classification === "coding") return ["workspace_read", "source_effect"];
  if (classification === "browser") return ["browser_read", "browser_effect"];
  if (classification === "hybrid") {
    return ["workspace_read", "browser_read", "source_effect", "browser_effect"];
  }
  return ["workspace_read", "browser_read"];
}

/**
 * 路由分类器：把一次修复请求转化为合法的 RouterDecision（含首个 DAG 修订）。
 *
 * clock 可注入以便在测试中固定时间；route 的产物经过 routerDecisionSchema
 * 校验，保证分类、能力集与初始修订三者自洽。
 */
export class Router {
  constructor(private readonly clock: () => Date = () => new Date()) {}

  /** 对输入请求做分类并返回结构化决策。 */
  route(input: RouterInput): RouterDecision {
    const classification = classify(input.prompt);
    const initialRevision: RunDagRevision = {
      schemaVersion: "prism.run-dag-revision/v1",
      revision: 1,
      classification,
      createdAt: this.clock().toISOString(),
      nodes: initialNodes(classification),
    };

    return routerDecisionSchema.parse({
      schemaVersion: ROUTER_DECISION_SCHEMA_VERSION,
      classification,
      confidence: classification === "uncertain" ? 0.3 : 0.9,
      requiredCapabilities: capabilities(classification),
      initialRevision,
    });
  }
}

/** DagScheduler 构造选项。 */
export interface DagSchedulerOptions {
  /** 只读节点的最大并发数，至少为 1。 */
  maxReadOnlyConcurrency?: number;
  /** 时钟注入，便于测试固定时间。 */
  clock?: () => Date;
}

/** DagScheduler 运行期间的回调集合。 */
export interface DagSchedulerCallbacks {
  /** 副作用租约变更回调：节点持锁（active）与释放（released）时触发。 */
  onLease?: (lease: EffectLease) => void | Promise<void>;
}

/**
 * DAG 调度器：按副作用类别组织节点执行。
 *
 *  - 只读/无副作用节点：以限定的并发度并行执行，互不干扰；
 *  - 副作用节点：顺序执行，每个节点先取得单调递增的 fencing token
 *    作为租约，执行完毕后释放，从而串行化源码/浏览器副作用。
 */
export class DagScheduler {
  private readonly clock: () => Date;
  private readonly maxReadOnlyConcurrency: number;
  private nextFencingToken = 0;

  constructor(options: DagSchedulerOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
    this.maxReadOnlyConcurrency = Math.max(1, options.maxReadOnlyConcurrency ?? 2);
  }

  /** 恢复时把下一租约推进到持久化 token 之后。 */
  advanceFencingTokenTo(token: number): void {
    this.nextFencingToken = Math.max(this.nextFencingToken, token);
  }

  /**
   * 运行一组节点，返回 nodeId → 执行结果的映射。
   *
   * @param nodes 待调度的 DAG 节点（调用方需先保证其就绪：前驱已完成）
   * @param execute 单个节点的执行体；副作用节点会收到其持有租约的
   *   fencing token，只读节点收到 null
   * @param callbacks 租约变更回调
   * @returns 每个已执行节点的 nodeId 与其结果
   */
  async run<T>(
    nodes: readonly RunDagNode[],
    execute: (node: RunDagNode, fencingToken: number | null) => Promise<T>,
    callbacks: DagSchedulerCallbacks = {},
  ): Promise<Map<string, T>> {
    const results = new Map<string, T>();
    const readOnlyNodes = nodes.filter(
      (node) => node.effectClass === "read_only" || node.effectClass === "none",
    );
    const effectNodes = nodes.filter(
      (
        node,
      ): node is RunDagNode & {
        effectClass: "source_effect" | "browser_effect";
      } =>
        node.effectClass === "source_effect" || node.effectClass === "browser_effect",
    );
    let nextReadOnlyIndex = 0;

    // 用固定数量的 worker 轮流领取只读节点，实现并发但不失控
    await Promise.all(
      Array.from(
        { length: Math.min(this.maxReadOnlyConcurrency, readOnlyNodes.length) },
        async () => {
          while (nextReadOnlyIndex < readOnlyNodes.length) {
            const node = readOnlyNodes[nextReadOnlyIndex];
            nextReadOnlyIndex += 1;
            results.set(node.nodeId, await execute(node, null));
          }
        },
      ),
    );

    // 副作用节点串行执行，逐个持锁
    for (const node of effectNodes) {
      const token = ++this.nextFencingToken;
      const activeLease: EffectLease = {
        schemaVersion: "prism.effect-lease/v1",
        token,
        holderNodeId: node.nodeId,
        effectClass: node.effectClass,
        state: "active",
        recordedAt: this.clock().toISOString(),
      };
      await callbacks.onLease?.(activeLease);
      try {
        results.set(node.nodeId, await execute(node, token));
      } finally {
        // 无论执行成败都释放租约
        await callbacks.onLease?.({
          ...activeLease,
          state: "released",
          recordedAt: this.clock().toISOString(),
        });
      }
    }

    return results;
  }
}

/** 写入节点进度所需的输入：由调用方提供，其余信封字段由编排器补全。 */
export type RunNodeProgressInput = Omit<
  RunNodeProgress,
  "schemaVersion" | "journalPosition" | "causationEventId" | "recordedAt"
>;

/**
 * 编排日志接口：编排器推进 DAG 过程中所有持久化写入的抽象。
 *
 * 实现方负责把修订 / 进度 / 租约追加为事件，并把运行时证据写为
 * 内容寻址产物。
 */
export interface OrchestrationJournal {
  appendDagRevision: (revision: RunDagRevision) => Promise<void>;
  appendNodeProgress: (progress: RunNodeProgressInput) => Promise<void>;
  appendEffectLease: (lease: EffectLease) => Promise<void>;
  appendBrowserAction: (record: BrowserActionRecord) => Promise<void>;
  appendVerificationReport: (report: BrowserVerificationReport) => Promise<void>;
  appendRunCompletion: (completion: RunCompletion) => Promise<void>;
}

/** Pi Coding Runtime 的进程中立调用边界。 */
export interface CodingRuntime {
  execute: (
    envelope: RuntimeTaskEnvelope,
    options?: { signal?: AbortSignal },
  ) => Promise<PiRuntimeResult>;
}

/** UI-TARS Browser Runtime 的进程中立调用边界。 */
export interface BrowserRuntime {
  execute: (
    envelope: BrowserRuntimeTaskEnvelope,
    options?: { signal?: AbortSignal },
  ) => Promise<BrowserRuntimeResult>;
}

/** 浏览器节点的本地路由与采集目标配置。 */
export interface BrowserRunConfig {
  route: string;
  target: BrowserCaptureTarget;
}

/** 混合运行输入：Run 标识、请求、日志与两个真实运行时。 */
export interface ExecuteHybridRunInput {
  runId: string;
  prompt: string;
  journal: OrchestrationJournal;
  codingRuntime: CodingRuntime;
  browserRuntime: BrowserRuntime;
  browserConfig: BrowserRunConfig;
  budget?: RuntimeBudget;
  browserBudget?: BrowserRuntimeBudget;
  signal?: AbortSignal;
  resume?: {
    revision: RunDagRevision;
    completedNodeIds: readonly string[];
    artifacts: readonly ArtifactRef[];
    latestVerificationReport: BrowserVerificationReport | null;
    fencingTokenFloor: number;
  };
  stopAfterNodeType?: RunDagNodeType;
}

/** Orchestrator 构造选项，全部可注入以便测试。 */
export interface OrchestratorOptions {
  clock?: () => Date;
  router?: Router;
  scheduler?: DagScheduler;
}

/** 为指定修订/节点类型/尝试生成稳定的节点 ID。 */
function nextNodeId(
  revision: number,
  nodeType: RunDagNodeType,
  attempt: number,
): string {
  return `node-${revision}-${nodeType.replace(".", "-")}-attempt-${attempt}`;
}

/** 只读节点允许 2 次尝试，副作用节点只允许 1 次。 */
function attemptsFor(nodeType: RunDagNodeType): number {
  return runDagNodeRegistry[nodeType].effectClass === "read_only" ? 2 : 1;
}

/**
 * 生成确定性的临时 Orchestrator 节点结果。
 *
 * 真实 Coding 与 Browser 运行时都不经过这里；route.reclassify 由编排器
 * 自己执行（只读、无外部运行时）。
 */
function orchestratorOutcome(node: RunDagNode, attempt: number): NodeOutcome {
  return nodeOutcomeSchema.parse({
    nodeId: node.nodeId,
    attempt,
    state: "succeeded",
    summary: `Orchestrator completed ${node.nodeType}.`,
    request:
      node.nodeType === "route.reclassify"
        ? ({ kind: "reclassify", classification: "hybrid" } as const)
        : ({ kind: "none" } as const),
    failure: null,
  });
}

const DEFAULT_RUNTIME_BUDGET: RuntimeBudget = {
  maxModelCalls: 12,
  maxInputTokens: 100_000,
  maxOutputTokens: 20_000,
  maxTotalTokens: 120_000,
  maxCostUsd: 5,
  maxDurationMs: 300_000,
};

const DEFAULT_BROWSER_BUDGET: BrowserRuntimeBudget = {
  maxActions: 12,
  maxDurationMs: 300_000,
  maxCostUsd: 5,
};

function attemptFor(node: RunDagNode): number {
  const match = /-attempt-(\d+)$/u.exec(node.nodeId);
  return match ? Number(match[1]) : 1;
}

function uniqueArtifacts(artifacts: readonly ArtifactRef[]): ArtifactRef[] {
  return Array.from(
    new Map(artifacts.map((artifact) => [artifact.hash, artifact])).values(),
  );
}

/**
 * 编排器：把 Router 分类与 DagScheduler 调度串成完整的一次 Run 推进循环。
 */
export class Orchestrator {
  private readonly clock: () => Date;
  private readonly router: Router;
  private readonly scheduler: DagScheduler;

  constructor(options: OrchestratorOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
    this.router = options.router ?? new Router(this.clock);
    this.scheduler = options.scheduler ?? new DagScheduler({ clock: this.clock });
  }

  /**
   * 依据单个节点的结果推进 DAG，返回下一修订（或 null 表示无需扩展）。
   *
   * 校验并处理各类结果请求：
   *  - none：不产生新节点；
   *  - reclassify：仅 uncertain 路由允许，重分类并进入新一轮调度；
   *  - retry / successor：必须请求注册表中的合法后继；uncertain 路由
   *    在重分类前只允许只读证据；重试不得超过节点的 maxAttempts 上限；
   *    若目标类型节点已存在且本次不是重试，则跳过（不重复扩展）。
   *
   * @throws TypeError 当结果与已调度节点/尝试不匹配、后继非法或超出约束时
   */
  appendOutcomeRevision({
    revision,
    nodeId,
    attempt,
    outcome,
    completedNodeIds,
  }: {
    revision: RunDagRevision;
    nodeId: string;
    attempt: number;
    outcome: NodeOutcome;
    completedNodeIds: readonly string[];
  }): RunDagRevision | null {
    const node = revision.nodes.find((candidate) => candidate.nodeId === nodeId);
    if (!node || outcome.nodeId !== nodeId || outcome.attempt !== attempt) {
      throw new TypeError(
        "Runtime outcomes must match the scheduled Run DAG node attempt.",
      );
    }

    if (outcome.request.kind === "none") return null;
    if (outcome.request.kind === "reclassify") {
      if (revision.classification !== "uncertain") {
        throw new TypeError("Only uncertain routes may be reclassified.");
      }
      return runDagRevisionSchema.parse({
        ...revision,
        revision: revision.revision + 1,
        classification: outcome.request.classification,
        createdAt: this.clock().toISOString(),
      });
    }

    const targetType =
      outcome.request.kind === "retry" ? node.nodeType : outcome.request.nodeType;
    const targetDefinition = runDagNodeRegistry[targetType];
    const legalSuccessors = runDagNodeRegistry[node.nodeType]
      .legalSuccessors as readonly string[];
    if (!legalSuccessors.includes(targetType)) {
      throw new TypeError(
        "Runtime outcomes may request only registered legal successors.",
      );
    }
    if (
      revision.classification === "uncertain" &&
      targetDefinition.effectClass !== "read_only" &&
      targetDefinition.effectClass !== "none"
    ) {
      throw new TypeError(
        "Uncertain routes may request only read-only evidence before reclassification.",
      );
    }
    if (outcome.request.kind === "retry" && attempt >= node.maxAttempts) {
      throw new TypeError("The node exhausted its bounded retry allowance.");
    }
    // 目标类型节点已存在且本次不是重试时，不重复追加
    if (
      outcome.request.kind !== "retry" &&
      revision.nodes.some((candidate) => candidate.nodeType === targetType)
    ) {
      return null;
    }

    // 前驱 = 已完成节点中"能合法指向目标类型"的那些；重试则以原节点为前驱
    const predecessorIds =
      outcome.request.kind === "retry"
        ? [node.nodeId]
        : completedNodeIds.filter((candidateId) => {
            const predecessor = revision.nodes.find(
              (candidate) => candidate.nodeId === candidateId,
            );
            return (
              predecessor !== undefined &&
              (
                runDagNodeRegistry[predecessor.nodeType]
                  .legalSuccessors as readonly string[]
              ).includes(targetType)
            );
          });
    const nextAttempt = outcome.request.kind === "retry" ? attempt + 1 : 1;
    const nextNode: RunDagNode = {
      nodeId: nextNodeId(revision.revision + 1, targetType, nextAttempt),
      nodeType: targetType,
      runtime: targetDefinition.runtime,
      effectClass: targetDefinition.effectClass,
      predecessorIds,
      maxAttempts: attemptsFor(targetType),
    };

    return runDagRevisionSchema.parse({
      ...revision,
      revision: revision.revision + 1,
      createdAt: this.clock().toISOString(),
      nodes: [...revision.nodes, nextNode],
    });
  }

  /**
   * 执行一次混合运行，返回最终 DAG 修订。
   *
   * 流程：路由分类 → 写入初始修订 → 循环取就绪节点 → 调度执行（写进度、
   * 调用真实 Pi Coding Runtime / 临时 Browser Runtime、写结果进度）→
   * 依据结果扩展 DAG → 直至无就绪节点。
   *
   * @param input Run 标识、请求文案与日志写入器
   * @returns 无更多就绪节点时的最终修订（通常含 task.complete）
   */
  async executeHybridRun(input: ExecuteHybridRunInput): Promise<RunDagRevision> {
    const decision = input.resume
      ? null
      : this.router.route({ runId: input.runId, prompt: input.prompt });
    let revision = input.resume?.revision ?? decision!.initialRevision;
    const completedNodeIds = new Set(input.resume?.completedNodeIds ?? []);
    const artifacts: ArtifactRef[] = [...(input.resume?.artifacts ?? [])];
    let latestVerificationReport: BrowserVerificationReport | null =
      input.resume?.latestVerificationReport ?? null;
    const budget = input.budget ?? DEFAULT_RUNTIME_BUDGET;
    const browserBudget = input.browserBudget ?? DEFAULT_BROWSER_BUDGET;

    this.scheduler.advanceFencingTokenTo(input.resume?.fencingTokenFloor ?? 0);
    if (!input.resume) await input.journal.appendDagRevision(revision);

    while (true) {
      // 就绪节点 = 未完成 且 所有前驱已完成
      const ready = revision.nodes.filter(
        (node) =>
          !completedNodeIds.has(node.nodeId) &&
          node.predecessorIds.every((predecessorId) =>
            completedNodeIds.has(predecessorId),
          ),
      );
      if (ready.length === 0) return revision;

      const outcomes = await this.scheduler.run(
        ready,
        async (node) => {
          const attempt = attemptFor(node);
          await input.journal.appendNodeProgress({
            revision: revision.revision,
            nodeId: node.nodeId,
            nodeType: node.nodeType,
            attempt,
            runtime: node.runtime,
            effectClass: node.effectClass,
            state: "running",
            summary: `${node.runtime} runtime started ${node.nodeType}.`,
            artifacts: [],
            correlationId: input.runId,
          });

          let result: { outcome: NodeOutcome; artifacts: ArtifactRef[] };
          if (node.runtime === "coding") {
            const authority =
              node.nodeType === "workspace.inspect"
                ? (["inspect"] as const)
                : (["inspect", "patch", "test"] as const);
            const idempotencyKey = `${input.runId}:${revision.revision}:${node.nodeId}:${attempt}`;
            const envelope: RuntimeTaskEnvelope = {
              schemaVersion: RUNTIME_TASK_ENVELOPE_SCHEMA_VERSION,
              runId: input.runId,
              dagRevision: revision.revision,
              nodeId: node.nodeId,
              nodeType: node.nodeType as "workspace.inspect" | "workspace.patch",
              attempt,
              maxAttempts: node.maxAttempts,
              runtime: "coding",
              prompt: input.prompt,
              inputArtifacts: uniqueArtifacts(artifacts),
              authority: { workspaceOperations: [...authority] },
              budget,
              deadline: new Date(
                this.clock().getTime() + budget.maxDurationMs,
              ).toISOString(),
              cancellationId: `cancel:${idempotencyKey}`,
              correlationId: input.runId,
              causationEventId: null,
              idempotencyKey,
            };
            const runtimeResult = piRuntimeResultSchema.parse(
              await input.codingRuntime.execute(envelope, { signal: input.signal }),
            );
            result = runtimeResult;
          } else if (node.runtime === "browser") {
            const idempotencyKey = `${input.runId}:${revision.revision}:${node.nodeId}:${attempt}`;
            const envelope: BrowserRuntimeTaskEnvelope = {
              schemaVersion: BROWSER_RUNTIME_TASK_ENVELOPE_SCHEMA_VERSION,
              runId: input.runId,
              dagRevision: revision.revision,
              nodeId: node.nodeId,
              nodeType: node.nodeType as "browser.observe" | "browser.verify",
              attempt,
              maxAttempts: node.maxAttempts,
              runtime: "browser",
              prompt: input.prompt,
              inputArtifacts: uniqueArtifacts(artifacts),
              authority: {
                route: input.browserConfig.route,
                target: input.browserConfig.target,
                intent:
                  node.nodeType === "browser.verify"
                    ? input.prompt.slice(0, 500)
                    : null,
                maxActions: browserBudget.maxActions,
              },
              budget: browserBudget,
              deadline: new Date(
                this.clock().getTime() + browserBudget.maxDurationMs,
              ).toISOString(),
              cancellationId: `cancel:${idempotencyKey}`,
              correlationId: input.runId,
              causationEventId: null,
              idempotencyKey,
            };
            const runtimeResult = browserRuntimeResultSchema.parse(
              await input.browserRuntime.execute(envelope, { signal: input.signal }),
            );
            await Promise.all(
              runtimeResult.browserActions.map((record) =>
                input.journal.appendBrowserAction(record),
              ),
            );
            if (runtimeResult.verificationReport) {
              latestVerificationReport = runtimeResult.verificationReport;
              await input.journal.appendVerificationReport(
                runtimeResult.verificationReport,
              );
            }
            result = runtimeResult;
          } else {
            const codeOracle = artifacts.find(
              ({ mediaType }) => mediaType === CODE_ORACLE_REPORT_MEDIA_TYPE,
            );
            const completionEvidence =
              node.nodeType === "task.complete" &&
              codeOracle &&
              latestVerificationReport?.verdict === "passed"
                ? uniqueArtifacts([
                    codeOracle,
                    ...latestVerificationReport.evidenceRefs,
                  ])
                : null;
            result =
              node.nodeType !== "task.complete" || completionEvidence
                ? {
                    outcome: orchestratorOutcome(node, attempt),
                    artifacts: completionEvidence ?? [],
                  }
                : {
                    outcome: nodeOutcomeSchema.parse({
                      nodeId: node.nodeId,
                      attempt,
                      state: "blocked",
                      summary:
                        "Task completion requires passing code and browser Oracle evidence.",
                      request: { kind: "none" },
                      failure: {
                        code: "verification_failed",
                        retryable: false,
                      },
                    }),
                    artifacts: [],
                  };
          }
          artifacts.push(...result.artifacts);
          await input.journal.appendNodeProgress({
            revision: revision.revision,
            nodeId: node.nodeId,
            nodeType: node.nodeType,
            attempt,
            runtime: node.runtime,
            effectClass: node.effectClass,
            state: result.outcome.state,
            summary: result.outcome.summary,
            artifacts: result.artifacts,
            correlationId: input.runId,
          });
          if (
            node.nodeType === "task.complete" &&
            result.outcome.state === "succeeded"
          ) {
            const codeOracle = result.artifacts.find(
              ({ mediaType }) => mediaType === CODE_ORACLE_REPORT_MEDIA_TYPE,
            );
            if (!codeOracle || !latestVerificationReport) {
              throw new TypeError("Completion evidence disappeared before commit.");
            }
            await input.journal.appendRunCompletion({
              schemaVersion: "prism.run-completion/v1",
              terminalDagRevision: revision.revision,
              budgets: { code: budget, browser: browserBudget },
              approvals: [],
              codeOracle,
              browserVerificationReportId: latestVerificationReport.reportId,
              verificationRefs: result.artifacts,
              completedAt: this.clock().toISOString(),
            });
          }
          return result.outcome;
        },
        { onLease: input.journal.appendEffectLease },
      );

      // 汇总结果并逐个推进 DAG
      for (const [nodeId, outcome] of outcomes) {
        completedNodeIds.add(nodeId);
        const nextRevision = this.appendOutcomeRevision({
          revision,
          nodeId,
          attempt: outcome.attempt,
          outcome,
          completedNodeIds: [...completedNodeIds],
        });
        if (nextRevision) {
          revision = nextRevision;
          await input.journal.appendDagRevision(revision);
        }
      }
      if (
        input.stopAfterNodeType &&
        [...outcomes.keys()].some(
          (nodeId) =>
            revision.nodes.find((node) => node.nodeId === nodeId)?.nodeType ===
            input.stopAfterNodeType,
        )
      ) {
        return revision;
      }
    }
  }
}
