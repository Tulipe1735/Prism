/**
 * Prism UI-TARS Browser Runtime（runtime-ui-tars）包
 *
 * 用官方 @ui-tars/sdk 的 GUIAgent 嵌入同进程浏览器运行时，替换编排器里的
 * 占位 Browser Runtime。设计要点：
 *
 *  - 自定义 Operator（PrismBrowserOperator）实现 SDK 要求的 screenshot()
 *    与 execute() 两个原语；execute() 把每条 parsed prediction 转成一个
 *    Zod 校验过的 BrowserActionProposal 交给 ActionBroker，绝不直接执行
 *    任何模型输入，也不暴露源码/文件/终端能力；
 *  - 截图缩放、视口、设备像素比、坐标空间、标签页、页面状态与截图哈希都
 *    在观测引用与坐标目标里绑定，ActionBroker 的新鲜度检查据此拒绝陈旧
 *    提案；
 *  - 模型每次只能提议一条动作（MANUAL.ACTION_SPACES 只开放 click 与
 *    finished），高层多动作输出也逐条穿过同一代理，无法绕过逐动作策略；
 *  - UI-TARS 的定性视觉判断标记为 supplemental，单独无法产生通过的
 *    BrowserVerificationReport —— 必须配合意图链定的确定性谓词。
 *
 * 安全边界：BrowserPort 只有 observe/screenshot/click/dispose，没有仓库
 * 写、补丁、shell、任意脚本或文件系统能力；浏览器输入全部来自 ActionBroker。
 */
import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import process from "node:process";

import { ActionBroker } from "@prism/action-broker";
import {
  type ArtifactRef,
  BROWSER_ACTION_PROPOSAL_SCHEMA_VERSION,
  BROWSER_RUNTIME_RESULT_SCHEMA_VERSION,
  BROWSER_VERIFICATION_REPORT_SCHEMA_VERSION,
  type BrowserActionProposal,
  browserActionProposalSchema,
  type BrowserActionRecord,
  type BrowserObservationReference,
  type BrowserResourceUsage,
  browserResourceUsageSchema,
  type BrowserRuntimeResult,
  browserRuntimeResultSchema,
  type BrowserRuntimeTaskEnvelope,
  browserRuntimeTaskEnvelopeSchema,
  type BrowserTarget,
  type BrowserVerificationAssertion,
  type BrowserVerificationReport,
  browserVerificationReportSchema,
  type NodeOutcome,
  nodeOutcomeSchema,
  type Viewport,
} from "@prism/contracts";
import { GUIAgent, StatusEnum } from "@ui-tars/sdk";
import {
  type ExecuteOutput,
  type ExecuteParams,
  Operator,
  parseBoxToScreenCoords,
  type ScreenshotOutput,
  type UITarsModel,
} from "@ui-tars/sdk/core";
import {
  type Browser,
  type BrowserContext,
  type BrowserType,
  chromium,
  type Page,
} from "playwright-core";

const UI_TARS_TRAJECTORY_MEDIA_TYPE =
  "application/vnd.prism.ui-tars-trajectory+json";

/** 浏览器端口：运行时所需的浏览器原语集合（只读观测 + 坐标/语义点击）。 */
export interface UiTarsBrowserPort {
  /** 观测当前页面状态，返回观测引用（含截图/页面状态哈希与视口）。 */
  observe: () => Promise<BrowserObservationReference>;
  /** 采集当前页面截图，返回模型输入与绑定同一状态的观测引用。 */
  screenshot: () => Promise<{
    base64: string;
    scaleFactor: number;
    observation: BrowserObservationReference;
  }>;
  /** 在页面上点击给定目标（仅 ActionBroker 放行后调用）。 */
  click: (target: BrowserTarget) => Promise<void>;
  /** 关闭并释放浏览器会话。 */
  dispose: () => Promise<void>;
}

/** 浏览器端口工厂：按本地基址与路由创建一次受限会话。 */
export interface UiTarsBrowserPortFactory {
  create: (options: {
    baseUrl: string;
    route: string;
    viewport: Viewport;
  }) => Promise<UiTarsBrowserPort>;
}

/** UI-TARS 会话：GUIAgent 的进程内封装。 */
export interface UiTarsSession {
  run: (instruction: string) => Promise<void>;
  abort: () => Promise<void>;
  dispose: () => void;
  getUsage: () => BrowserResourceUsage;
}

/** UI-TARS 会话工厂：由运行时注入，生产用 UiTarsSdkSessionFactory。 */
export interface UiTarsSessionFactory {
  readonly model: BrowserResourceUsage["model"];
  create: (options: {
    systemPrompt: string;
    operator: PrismBrowserOperator;
    signal: AbortSignal;
    maxLoopCount: number;
  }) => Promise<UiTarsSession>;
}

/** 意图链定的确定性谓词验证器：由调用方注入（fixture oracle 由后续 ticket 提供）。 */
export interface UiTarsVerifier {
  verify: (options: {
    intent: string;
    observation: BrowserObservationReference;
    screenshotArtifact: ArtifactRef;
  }) => Promise<{
    assertion: string;
    status: "passed" | "failed" | "inconclusive";
  }>;
}

/** UI-TARS 配置错误：模型或浏览器配置缺失/不完整时抛出。 */
export class UiTarsConfigurationError extends Error {}

/** 浏览器会话清理失败：dispose 抛错时抛出。 */
export class UiTarsSessionCleanupError extends Error {
  constructor(cause: unknown) {
    super("The UI-TARS browser session could not be cleaned up.", { cause });
    this.name = "UiTarsSessionCleanupError";
  }
}

/**
 * 自定义 Prism Operator。
 *
 * screenshot() 从浏览器端口采集截图并记录观测；execute() 把 parsed
 * prediction 转成 Zod 校验过的提案交给 ActionBroker，绝不直接发送浏览器
 * 输入。MANUAL.ACTION_SPACES 只开放 click 与 finished，从系统提示层
 * 约束模型一次只提议一条受控动作。
 */
export class PrismBrowserOperator extends Operator {
  static MANUAL = {
    ACTION_SPACES: [
      'click(start_box="[x1, y1, x2, y2]") # click the element inside the given box',
      'finished() # the repair is verified; finish the browser task',
    ],
  };

  readonly records: BrowserActionRecord[] = [];
  private currentObservation: BrowserObservationReference | null = null;
  private finished = false;
  private refusal: string | null = null;
  private finalJudgment: string | null = null;

  constructor(
    private readonly options: {
      port: UiTarsBrowserPort;
      broker: ActionBroker;
      runId: string;
      signal: AbortSignal;
    },
  ) {
    super();
  }

  /** 采集当前页面截图并记录观测，返回 SDK 期望的 ScreenshotOutput。 */
  async screenshot(): Promise<ScreenshotOutput> {
    const capture = await this.options.port.screenshot();
    this.currentObservation = capture.observation;
    return { base64: capture.base64, scaleFactor: capture.scaleFactor };
  }

  /** 把一条 parsed prediction 转成提案并交给 ActionBroker。 */
  async execute(params: ExecuteParams): Promise<ExecuteOutput> {
    if (this.options.signal.aborted) return { status: StatusEnum.USER_STOPPED };

    const actionType = params.parsedPrediction.action_type;

    if (actionType === "finished") {
      this.finished = true;
      this.finalJudgment =
        params.parsedPrediction.reflection ??
        params.parsedPrediction.thought ??
        "The browser task completed.";
      return { status: StatusEnum.END };
    }

    if (actionType === "click") {
      const target = this.coordinateTarget(params);
      if (!target) {
        this.refusal = "click-without-box";
        return { status: StatusEnum.END };
      }
      const proposal = browserActionProposalSchema.parse({
        schemaVersion: BROWSER_ACTION_PROPOSAL_SCHEMA_VERSION,
        proposalId: randomUUID(),
        runId: this.options.runId,
        origin: "ui-tars",
        action: { kind: "click" },
        target,
      } satisfies BrowserActionProposal);
      const record = await this.options.broker.execute(proposal);
      this.records.push(record);
      return { status: StatusEnum.RUNNING };
    }

    // 其它任何动作类型（type/scroll/hotkey/未知动作）都不允许：绝不执行输入
    this.refusal = actionType;
    return { status: StatusEnum.END };
  }

  /** 是否被模型显式标记完成（finished）。 */
  isFinished(): boolean {
    return this.finished;
  }

  /** 被拒绝的动作类型（无则 null）。 */
  getRefusal(): string | null {
    return this.refusal;
  }

  /** 模型完成时的定性视觉判断（补充性证据，非确定性谓词）。 */
  getFinalJudgment(): string | null {
    return this.finalJudgment;
  }

  /**
   * 把模型坐标盒子转成绑定当前观测的坐标目标。
   *
   * 模型输出的是模型空间归一化盒子 [x1,y1,x2,y2]；parseBoxToScreenCoords
   * 用截图物理分辨率与模型 factors 换算成物理像素中心，再除以 scaleFactor
   * （设备像素比）得到视口 CSS 像素坐标。目标绑定观测 ID、截图哈希、
   * 页面状态哈希与视口，保证动作只能作用于其被观测时对应的页面。
   */
  private coordinateTarget(params: ExecuteParams): BrowserTarget | null {
    const boxStr = params.parsedPrediction.action_inputs?.start_box;
    if (!boxStr || !this.currentObservation) return null;
    const physical = parseBoxToScreenCoords({
      boxStr,
      screenWidth: params.screenWidth,
      screenHeight: params.screenHeight,
      factors: params.factors,
    });
    if (physical.x === null || physical.y === null) return null;
    const observation = this.currentObservation;
    const cssX = physical.x / params.scaleFactor;
    const cssY = physical.y / params.scaleFactor;
    return {
      kind: "coordinate",
      x: cssX,
      y: cssY,
      observationId: observation.observationId,
      screenshotHash: observation.screenshotHash,
      pageStateHash: observation.pageStateHash,
      viewport: observation.viewport,
    };
  }
}

/** 生产 UI-TARS 会话工厂：用 OpenAI 兼容配置创建 GUIAgent。 */
export interface UiTarsSdkSessionFactoryOptions {
  baseURL: string;
  apiKey: string;
  model: string;
  maxLoopCount?: number;
  /** 注入自定义 UITarsModel 实例（测试用确定性模型；默认用配置建真实模型）。 */
  modelInstance?: UITarsModel;
}

/** 生产 UI-TARS 会话工厂：把运行时注入的 operator 包进官方 GUIAgent。 */
export class UiTarsSdkSessionFactory implements UiTarsSessionFactory {
  readonly model: BrowserResourceUsage["model"];

  constructor(private readonly options: UiTarsSdkSessionFactoryOptions) {
    this.model = { provider: "ui-tars", id: options.model };
  }

  async create(options: {
    systemPrompt: string;
    operator: PrismBrowserOperator;
    signal: AbortSignal;
    maxLoopCount: number;
  }): Promise<UiTarsSession> {
    let gptTurns = 0;
    const usage: BrowserResourceUsage = {
      model: this.model,
      modelCalls: 0,
      loopCount: 0,
      actionsProposed: 0,
      actionsExecuted: 0,
      costUsd: 0,
      durationMs: 0,
    };
    const agent = new GUIAgent({
      model: this.options.modelInstance ?? {
        baseURL: this.options.baseURL,
        apiKey: this.options.apiKey,
        model: this.options.model,
      },
      operator: options.operator,
      systemPrompt: options.systemPrompt,
      signal: options.signal,
      maxLoopCount: options.maxLoopCount,
      onData: ({ data }) => {
        for (const conversation of data.conversations) {
          if (conversation.from === "gpt") gptTurns += 1;
        }
      },
    });
    return {
      run: async (instruction) => {
        await agent.run(instruction);
        usage.modelCalls = gptTurns;
        usage.loopCount = gptTurns;
        usage.actionsProposed = options.operator.records.length;
        usage.actionsExecuted = options.operator.records.filter(
          (record) => record.execution.status === "executed",
        ).length;
      },
      abort: async () => agent.stop(),
      dispose: () => undefined,
      getUsage: () => usage,
    };
  }
}

/** 从环境变量创建生产 UI-TARS 会话工厂（模型配置）。 */
export async function createConfiguredUiTarsSdkSessionFactory(options: {
  baseURL?: string;
  apiKey?: string;
  model?: string;
  maxLoopCount?: number;
}): Promise<UiTarsSdkSessionFactory> {
  const baseURL =
    options.baseURL?.trim() || process.env.PRISM_UI_TARS_BASE_URL?.trim();
  const apiKey =
    options.apiKey?.trim() || process.env.PRISM_UI_TARS_API_KEY?.trim();
  const model = options.model?.trim() || process.env.PRISM_UI_TARS_MODEL?.trim();
  if (!baseURL || !apiKey || !model) {
    throw new UiTarsConfigurationError(
      "Configure PRISM_UI_TARS_BASE_URL, PRISM_UI_TARS_API_KEY, and PRISM_UI_TARS_MODEL before starting a live browser Run.",
    );
  }
  return new UiTarsSdkSessionFactory({
    baseURL,
    apiKey,
    model,
    maxLoopCount: options.maxLoopCount,
  });
}

/**
 * Playwright 浏览器端口工厂：启动受限的无头 Chromium，导航到本地路由，
 * 在受限上下文里观测、截图与点击。
 *
 * 网络约束与 BrowserExecutor 一致：只放行同 origin 的 GET/HEAD，其余中止。
 * 观测引用按（URL + 页面状态哈希 + 截图哈希）缓存：页面未变时复用同一
 * 观测引用（同一 observationId），页面变化后生成新观测 —— 这正是
 * ActionBroker 新鲜度判定所需的语义。
 */
export class PlaywrightBrowserPortFactory implements UiTarsBrowserPortFactory {
  private readonly browserType: Pick<BrowserType<Browser>, "launch">;

  constructor(
    private readonly options: { executablePath?: string; browserType?: Pick<BrowserType<Browser>, "launch"> } = {},
  ) {
    this.browserType = options.browserType ?? chromium;
  }

  async create(options: {
    baseUrl: string;
    route: string;
    viewport: Viewport;
  }): Promise<UiTarsBrowserPort> {
    const baseUrl = localBaseUrl(options.baseUrl);
    const targetUrl = localPageUrl(baseUrl, options.route);
    const browser = await this.browserType.launch({
      headless: true,
      executablePath: this.options.executablePath,
    });
    const context = await browser.newContext({
      viewport: {
        width: options.viewport.width,
        height: options.viewport.height,
      },
      deviceScaleFactor: options.viewport.deviceScaleFactor,
      acceptDownloads: false,
    });
    await confineNetwork(context, baseUrl);
    const page = await context.newPage();
    await page.goto(targetUrl.toString(), { waitUntil: "networkidle" });

    let cached: BrowserObservationReference | null = null;
    const matchesCached = (candidate: BrowserObservationReference): boolean =>
      cached !== null &&
      cached.url === candidate.url &&
      cached.pageStateHash === candidate.pageStateHash &&
      cached.screenshotHash === candidate.screenshotHash;

    const capture = async (): Promise<{
      observation: BrowserObservationReference;
      screenshot: Buffer;
    }> => {
      const screenshot = await page.screenshot({ type: "png" });
      const observation = await observePage(page, options.viewport, screenshot);
      if (matchesCached(observation)) {
        return { observation: cached!, screenshot };
      }
      cached = observation;
      return { observation, screenshot };
    };

    return {
      observe: async () => (await capture()).observation,
      screenshot: async () => {
        const { observation, screenshot } = await capture();
        return {
          base64: screenshot.toString("base64"),
          scaleFactor: options.viewport.deviceScaleFactor,
          observation,
        };
      },
      click: async (target) => {
        if (target.kind === "coordinate") {
          await page.mouse.click(target.x, target.y);
          return;
        }
        const locator = page.getByRole(target.role as never, {
          name: target.name,
          exact: target.exact,
        });
        await locator.click();
      },
      dispose: async () => {
        await context.close();
        await browser.close();
      },
    };
  }
}

/** 校验并解析本地基础 URL（必须是显式本地 HTTP origin）。 */
function localBaseUrl(input: string): URL {
  const baseUrl = new URL(input);
  const isLocalHost = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(
    baseUrl.hostname,
  );
  if (baseUrl.protocol !== "http:" || !isLocalHost) {
    throw new TypeError(
      "Prism UI-TARS browser sessions only permit an explicit local HTTP base URL.",
    );
  }
  return baseUrl;
}

/** 解析路由为同 origin 页面 URL，拒绝跨 origin 目标。 */
function localPageUrl(baseUrl: URL, route: string): URL {
  const target = new URL(route, baseUrl);
  if (target.origin !== baseUrl.origin) {
    throw new TypeError(
      "Prism UI-TARS refused a browser route outside the configured local origin.",
    );
  }
  return target;
}

/** 网络白名单：只放行同 origin 的 GET/HEAD，其余一律中止。 */
async function confineNetwork(context: BrowserContext, baseUrl: URL): Promise<void> {
  await context.route("**/*", async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    if (
      requestUrl.origin !== baseUrl.origin ||
      !["GET", "HEAD"].includes(request.method())
    ) {
      await route.abort();
      return;
    }
    await route.continue();
  });
}

/** 观测页面当前状态，返回观测引用。 */
async function observePage(
  page: Page,
  viewport: Viewport,
  screenshot: Buffer,
): Promise<BrowserObservationReference> {
  const state = await page.evaluate(() => ({
    documentTitle: document.title,
    readyState: document.readyState,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    bodyText: document.body.textContent ?? "",
  }));
  return {
    observationId: randomUUID(),
    url: page.url(),
    viewport,
    pageStateHash: sha256(Buffer.from(`${JSON.stringify(state)}\n`, "utf8")),
    screenshotHash: sha256(screenshot),
  };
}

/** 计算 SHA-256 十六进制摘要。 */
function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

/** 运行时选项：端口工厂、会话工厂、产物提交器、可选验证器与时钟。 */
export interface UiTarsBrowserRuntimeOptions {
  baseUrl: string;
  viewport: Viewport;
  browserPortFactory: UiTarsBrowserPortFactory;
  sessionFactory: UiTarsSessionFactory;
  artifacts: {
    commit: (content: Uint8Array | string, mediaType: string) => Promise<ArtifactRef>;
  };
  verifier?: UiTarsVerifier;
  clock?: () => Date;
}

/** 运行时失败码（与 NodeOutcome.failure.code 对齐）。 */
type UiTarsFailureCode = NonNullable<NodeOutcome["failure"]>["code"];

/**
 * 嵌入式 UI-TARS Browser Runtime。
 *
 * execute() 解析 BrowserRuntimeTaskEnvelope，启动受限浏览器端口、创建
 * PrismBrowserOperator + ActionBroker，运行 GUIAgent，收集浏览器动作记录
 * 与轨迹；browser.verify 节点额外用意图链定的确定性谓词 + UI-TARS 定性
 * 判断构建 BrowserVerificationReport。
 */
export class UiTarsBrowserRuntime {
  private readonly clock: () => Date;

  constructor(private readonly options: UiTarsBrowserRuntimeOptions) {
    this.clock = options.clock ?? (() => new Date());
  }

  async execute(
    envelopeInput: unknown,
    executionOptions: { signal?: AbortSignal } = {},
  ): Promise<BrowserRuntimeResult> {
    const envelope = browserRuntimeTaskEnvelopeSchema.parse(envelopeInput);
    const startedAt = this.clock();
    const trajectory: Array<Record<string, unknown>> = [];
    let port: UiTarsBrowserPort | null = null;
    let session: UiTarsSession | null = null;
    let operator: PrismBrowserOperator | null = null;
    let abortReason: UiTarsFailureCode | undefined;
    let cleanupFailed = false;
    let verificationReport: BrowserVerificationReport | null = null;
    let browserActions: BrowserActionRecord[] = [];

    const executionController = new AbortController();
    const timeoutMs = Math.min(
      envelope.budget.maxDurationMs,
      new Date(envelope.deadline).getTime() - startedAt.getTime(),
    );
    const onExternalAbort = (): void => {
      executionController.abort("cancelled");
    };
    const stopExecution = (reason: UiTarsFailureCode): void => {
      if (!executionController.signal.aborted) {
        executionController.abort(reason);
      }
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (executionOptions.signal?.aborted) {
      abortReason = "cancelled";
    } else {
      executionOptions.signal?.addEventListener("abort", onExternalAbort, {
        once: true,
      });
      timer = setTimeout(() => stopExecution("timed_out"), timeoutMs);
    }

    try {
      if (!abortReason) {
        port = await this.options.browserPortFactory.create({
          baseUrl: this.options.baseUrl,
          route: envelope.authority.route,
          viewport: this.options.viewport,
        });
        const broker = new ActionBroker({
          port: {
            observe: () => port!.observe(),
            click: (target) => port!.click(target),
          },
          clock: this.clock,
        });
        operator = new PrismBrowserOperator({
          port,
          broker,
          runId: envelope.runId,
          signal: executionController.signal,
        });
        session = await this.options.sessionFactory.create({
          systemPrompt: this.systemPrompt(envelope),
          operator,
          signal: executionController.signal,
          maxLoopCount: envelope.budget.maxActions,
        });

        await session.run(envelope.prompt);

        if (executionController.signal.aborted) {
          abortReason = "cancelled";
        }

        browserActions = operator.records;

        if (
          envelope.nodeType === "browser.verify" &&
          operator.isFinished() &&
          !abortReason
        ) {
          verificationReport = await this.verify(envelope, port, operator);
        }

        trajectory.push({
          type: "browser.session",
          finished: operator.isFinished(),
          refusal: operator.getRefusal(),
          actions: operator.records.length,
        });
        if (operator.getRefusal() && !abortReason) {
          abortReason = "browser_execution_failed";
        }
      }
    } catch (error) {
      if (error instanceof UiTarsSessionCleanupError) {
        cleanupFailed = true;
      } else if (!abortReason) {
        abortReason =
          error instanceof Error && error.name === "AbortError"
            ? "cancelled"
            : "browser_execution_failed";
      }
    } finally {
      if (timer) clearTimeout(timer);
      executionOptions.signal?.removeEventListener("abort", onExternalAbort);
      if (session) {
        try {
          session.dispose();
        } catch {
          cleanupFailed = true;
        }
      }
      if (port) {
        try {
          await port.dispose();
        } catch {
          cleanupFailed = true;
        }
      }
    }

    if (abortReason === "cancelled" && !executionController.signal.aborted) {
      // external signal aborted: confirm the controller reflects cancellation
      executionController.abort("cancelled");
    }

    const outcome = this.buildOutcome(
      envelope,
      verificationReport,
      abortReason,
      cleanupFailed,
      operator,
    );    const usage = session?.getUsage() ?? {
      model: this.options.sessionFactory.model,
      modelCalls: 0,
      loopCount: 0,
      actionsProposed: 0,
      actionsExecuted: 0,
      costUsd: 0,
      durationMs: 0,
    };
    const trajectoryArtifact = await this.options.artifacts.commit(
      `${JSON.stringify({
        schemaVersion: "prism.ui-tars-trajectory/v1",
        runId: envelope.runId,
        dagRevision: envelope.dagRevision,
        nodeId: envelope.nodeId,
        attempt: envelope.attempt,
        correlationId: envelope.correlationId,
        causationEventId: envelope.causationEventId,
        events: trajectory,
      })}\n`,
      UI_TARS_TRAJECTORY_MEDIA_TYPE,
    );
    const artifacts = [trajectoryArtifact];

    return browserRuntimeResultSchema.parse({
      schemaVersion: BROWSER_RUNTIME_RESULT_SCHEMA_VERSION,
      outcome,
      artifacts,
      browserActions,
      verificationReport,
      usage: browserResourceUsageSchema.parse({
        ...usage,
        durationMs: Math.max(0, this.clock().getTime() - startedAt.getTime()),
      }),
    });
  }

  /** 用意图链定的确定性谓词 + UI-TARS 定性判断构建验证报告。 */
  private async verify(
    envelope: BrowserRuntimeTaskEnvelope,
    port: UiTarsBrowserPort,
    operator: PrismBrowserOperator,
  ): Promise<BrowserVerificationReport> {
    const intent = envelope.authority.intent ?? "The repair intent.";
    const screenshot = await port.screenshot();
    const screenshotArtifact = await this.options.artifacts.commit(
      Buffer.from(screenshot.base64, "base64"),
      "image/png",
    );

    let deterministic: BrowserVerificationAssertion;
    if (this.options.verifier) {
      const result = await this.options.verifier.verify({
        intent,
        observation: screenshot.observation,
        screenshotArtifact,
      });
      deterministic = {
        assertion: result.assertion,
        intentLinked: true,
        kind: "deterministic",
        status: result.status,
        evidenceRefs: [screenshotArtifact],
      };
    } else {
      deterministic = {
        assertion: "No intent-linked deterministic predicate was provided.",
        intentLinked: false,
        kind: "deterministic",
        status: "inconclusive",
        evidenceRefs: [],
      };
    }

    const supplemental: BrowserVerificationAssertion = {
      assertion:
        operator.getFinalJudgment() ??
        "UI-TARS produced no explicit qualitative judgment.",
      intentLinked: false,
      kind: "supplemental",
      status: "inconclusive",
      evidenceRefs: [],
    };

    const verdict =
      deterministic.status === "passed"
        ? "passed"
        : deterministic.status === "failed"
          ? "failed"
          : "inconclusive";

    return browserVerificationReportSchema.parse({
      schemaVersion: BROWSER_VERIFICATION_REPORT_SCHEMA_VERSION,
      reportId: randomUUID(),
      runId: envelope.runId,
      nodeId: envelope.nodeId,
      attempt: envelope.attempt,
      intent,
      verdict,
      assertions: [deterministic, supplemental],
      evidenceRefs: [screenshotArtifact],
      limitations: [],
      redactions: [],
      recordedAt: this.clock().toISOString(),
    });
  }

  /** 依据运行结果构造 NodeOutcome。 */
  private buildOutcome(
    envelope: BrowserRuntimeTaskEnvelope,
    verificationReport: BrowserVerificationReport | null,
    abortReason: UiTarsFailureCode | undefined,
    cleanupFailed: boolean,
    _operator: PrismBrowserOperator | null,
  ): NodeOutcome {
    const failureCode: UiTarsFailureCode | undefined = cleanupFailed
      ? "process_cleanup_failed"
      : abortReason ??
        (envelope.nodeType === "browser.verify" &&
        verificationReport?.verdict !== "passed"
          ? "verification_failed"
          : undefined);

    if (failureCode) {
      const retryable =
        (failureCode === "timed_out" ||
          failureCode === "verification_failed") &&
        envelope.attempt < envelope.maxAttempts;
      return nodeOutcomeSchema.parse({
        nodeId: envelope.nodeId,
        attempt: envelope.attempt,
        state:
          failureCode === "cancelled" ||
          failureCode === "process_cleanup_failed" ||
          failureCode === "browser_execution_failed"
            ? "blocked"
            : "failed",
        summary: `UI-TARS Browser Runtime ended with ${failureCode.replaceAll("_", " ")}.`,
        request: retryable
          ? { kind: "retry", reason: `Retry after ${failureCode}.` }
          : { kind: "none" },
        failure: { code: failureCode, retryable },
      });
    }

    // 成功：observe 请求后续 patch；verify 通过则完成任务
    const request: NodeOutcome["request"] =
      envelope.nodeType === "browser.verify"
        ? { kind: "successor", nodeType: "task.complete" }
        : { kind: "successor", nodeType: "workspace.patch" };

    return nodeOutcomeSchema.parse({
      nodeId: envelope.nodeId,
      attempt: envelope.attempt,
      state: "succeeded",
      summary:
        envelope.nodeType === "browser.verify"
          ? "The UI-TARS verification report passed its intent-linked predicate."
          : "The UI-TARS browser observation completed.",
      request,
      failure: null,
    });
  }

  /** 构造 GUIAgent 系统提示：约束动作空间并声明代理边界。 */
  private systemPrompt(envelope: BrowserRuntimeTaskEnvelope): string {
    return [
      "You are the embedded UI-TARS Browser Runtime inside Prism.",
      "All browser input must pass through the Prism ActionBroker. You never have source, shell, file, or arbitrary-script capability.",
      "Propose exactly one typed browser action at a time using only the action space below.",
      `Run: ${envelope.runId}`,
      `DAG revision: ${envelope.dagRevision}`,
      `Node: ${envelope.nodeId} (${envelope.nodeType}), attempt ${envelope.attempt}/${envelope.maxAttempts}`,
      `Task: ${envelope.prompt}`,
      ...(envelope.authority.intent
        ? [`Verification intent: ${envelope.authority.intent}`]
        : []),
    ].join("\n");
  }
}
