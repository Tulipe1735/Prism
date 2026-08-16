/**
 * Prism Browser Runtime
 *
 * 用 Agent Plan 多模态模型的 Responses API 驱动同进程浏览器运行时。设计要点：
 *
 *  - PrismBrowserOperator 实现 screenshot() 与 execute()
 *    两个原语；execute() 把每条模型动作转成一个
 *    Zod 校验过的 BrowserActionProposal 交给 ActionBroker，绝不直接执行
 *    任何模型输入，也不暴露源码/文件/终端能力；
 *  - 截图缩放、视口、设备像素比、坐标空间、标签页、页面状态与截图哈希都
 *    在观测引用与坐标目标里绑定，ActionBroker 的新鲜度检查据此拒绝陈旧
 *    提案；
 *  - 模型每次只能调用 click 或 finished 其中一个工具，无法绕过逐动作策略；
 *  - 模型的定性视觉判断标记为 supplemental，单独无法产生通过的
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
  type BrowserKey,
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
import {
  type Browser,
  type BrowserContext,
  type BrowserType,
  chromium,
  type Page,
} from "playwright-core";

const BROWSER_TRAJECTORY_MEDIA_TYPE = "application/vnd.prism.browser-trajectory+json";
const AGENT_PLAN_RESPONSES_URL =
  "https://ark.cn-beijing.volces.com/api/plan/v3/responses";
const AGENT_PLAN_BROWSER_MODEL = {
  provider: "volcengine-agent-plan",
  id: "doubao-seed-2.0-pro",
} as const;

export type BrowserModelAction =
  | { action: "click"; x: number; y: number; judgment?: string }
  | { action: "finished"; judgment: string };

type BrowserOperatorStatus = "running" | "end" | "user_stopped";

/** 浏览器端口：运行时所需的浏览器原语集合（只读观测 + 坐标/语义点击）。 */
export interface BrowserPort {
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
  /** 发送允许的键盘按键（仅 ActionBroker 放行后调用）。 */
  press: (key: BrowserKey) => Promise<void>;
  /** 读取具名 Dialog、焦点与本次会话控制台错误。 */
  inspectDialog: (name: string) => Promise<DialogState>;
  /** 关闭并释放浏览器会话。 */
  dispose: () => Promise<void>;
}

export interface DialogState {
  visible: boolean;
  focusInside: boolean;
  activeElementName: string | null;
  consoleErrors: string[];
}

/** 浏览器端口工厂：按本地基址与路由创建一次受限会话。 */
export interface BrowserPortFactory {
  create: (options: {
    baseUrl: string;
    route: string;
    viewport: Viewport;
  }) => Promise<BrowserPort>;
}

/** 浏览器模型会话。 */
export interface BrowserSession {
  run: (instruction: string) => Promise<void>;
  abort: () => Promise<void>;
  dispose: () => void;
  getUsage: () => BrowserResourceUsage;
}

/** 浏览器模型会话工厂。 */
export interface BrowserSessionFactory {
  readonly model: BrowserResourceUsage["model"];
  create: (options: {
    systemPrompt: string;
    operator: PrismBrowserOperator;
    signal: AbortSignal;
    maxLoopCount: number;
  }) => Promise<BrowserSession>;
}

/** 意图链定的确定性谓词验证器：由调用方注入（fixture oracle 由后续 ticket 提供）。 */
export interface BrowserVerifier {
  verify: (options: {
    intent: string;
    observation: BrowserObservationReference;
    screenshotArtifact: ArtifactRef;
    inspectDialog: (name: string) => Promise<DialogState>;
    pressKey: (key: BrowserKey) => Promise<BrowserActionRecord>;
  }) => Promise<{
    assertion: string;
    status: "passed" | "failed" | "inconclusive";
    evidenceRefs?: ArtifactRef[];
  }>;
}

/** 浏览器模型配置缺失时抛出。 */
export class BrowserConfigurationError extends Error {}

/** 浏览器会话清理失败：dispose 抛错时抛出。 */
export class BrowserSessionCleanupError extends Error {
  constructor(cause: unknown) {
    super("The browser model session could not be cleaned up.", { cause });
    this.name = "BrowserSessionCleanupError";
  }
}

/**
 * 自定义 Prism Operator。
 *
 * screenshot() 从浏览器端口采集截图并记录观测；execute() 把已校验模型动作
 * 转成 Zod 校验过的提案交给 ActionBroker，绝不直接发送浏览器输入。
 */
export class PrismBrowserOperator {
  readonly records: BrowserActionRecord[] = [];
  private currentCapture: Awaited<ReturnType<BrowserPort["screenshot"]>> | null = null;
  private finished = false;
  private refusal: string | null = null;
  private finalJudgment: string | null = null;

  constructor(
    private readonly options: {
      port: BrowserPort;
      broker: ActionBroker;
      runId: string;
      signal: AbortSignal;
    },
  ) {}

  /** 采集当前页面截图并绑定后续坐标动作。 */
  async screenshot(): Promise<Awaited<ReturnType<BrowserPort["screenshot"]>>> {
    this.currentCapture = await this.options.port.screenshot();
    return this.currentCapture;
  }

  /** 把一条已校验模型动作转成提案并交给 ActionBroker。 */
  async execute(
    action: BrowserModelAction,
  ): Promise<{ status: BrowserOperatorStatus }> {
    if (this.options.signal.aborted) return { status: "user_stopped" };

    if (action.action === "finished") {
      this.finished = true;
      this.finalJudgment = action.judgment;
      return { status: "end" };
    }

    const target = this.coordinateTarget(action);
    if (!target) {
      this.refusal = "click-outside-current-observation";
      return { status: "end" };
    }
    const proposal = browserActionProposalSchema.parse({
      schemaVersion: BROWSER_ACTION_PROPOSAL_SCHEMA_VERSION,
      proposalId: randomUUID(),
      runId: this.options.runId,
      origin: "browser-model",
      action: { kind: "click" },
      target,
    } satisfies BrowserActionProposal);
    const record = await this.options.broker.execute(proposal);
    this.records.push(record);
    return { status: "running" };
  }

  /** 仅供确定性验证器使用；键盘输入仍通过 ActionBroker 留痕。 */
  async press(key: BrowserKey): Promise<BrowserActionRecord> {
    const record = await this.options.broker.execute({
      schemaVersion: BROWSER_ACTION_PROPOSAL_SCHEMA_VERSION,
      proposalId: randomUUID(),
      runId: this.options.runId,
      origin: "automation",
      action: { kind: "press", key },
    });
    this.records.push(record);
    return record;
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
   * 把截图物理像素坐标转成绑定当前观测的 CSS 像素目标。
   */
  private coordinateTarget(
    action: Extract<BrowserModelAction, { action: "click" }>,
  ): BrowserTarget | null {
    if (!this.currentCapture) return null;
    const { observation, scaleFactor } = this.currentCapture;
    const physicalWidth = observation.viewport.width * scaleFactor;
    const physicalHeight = observation.viewport.height * scaleFactor;
    if (
      action.x < 0 ||
      action.y < 0 ||
      action.x >= physicalWidth ||
      action.y >= physicalHeight
    ) {
      return null;
    }
    return {
      kind: "coordinate",
      x: action.x / scaleFactor,
      y: action.y / scaleFactor,
      observationId: observation.observationId,
      screenshotHash: observation.screenshotHash,
      pageStateHash: observation.pageStateHash,
      viewport: observation.viewport,
    };
  }
}

export interface AgentPlanBrowserSessionFactoryOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
}

/** 用 Agent Plan Responses API 驱动截图动作循环。 */
export class AgentPlanBrowserSessionFactory implements BrowserSessionFactory {
  readonly model = AGENT_PLAN_BROWSER_MODEL;

  constructor(private readonly options: AgentPlanBrowserSessionFactoryOptions) {}

  async create(options: {
    systemPrompt: string;
    operator: PrismBrowserOperator;
    signal: AbortSignal;
    maxLoopCount: number;
  }): Promise<BrowserSession> {
    let stopped = false;
    const usage: BrowserResourceUsage = {
      model: this.model,
      modelCalls: 0,
      loopCount: 0,
      actionsProposed: 0,
      actionsExecuted: 0,
      costUsd: 0,
      durationMs: 0,
    };
    return {
      run: async (instruction) => {
        const history: string[] = [];
        for (let index = 0; index < options.maxLoopCount; index += 1) {
          if (stopped || options.signal.aborted) return;
          const screenshot = await options.operator.screenshot();
          const action = await requestAgentPlanBrowserAction({
            apiKey: this.options.apiKey,
            fetchImpl: this.options.fetchImpl ?? fetch,
            signal: options.signal,
            systemPrompt: options.systemPrompt,
            instruction,
            history,
            screenshot: screenshot.base64,
          });
          usage.modelCalls += 1;
          usage.loopCount += 1;
          const result = await options.operator.execute(action);
          usage.actionsProposed = options.operator.records.length;
          usage.actionsExecuted = options.operator.records.filter(
            (record) => record.execution.status === "executed",
          ).length;
          history.push(
            action.action === "click"
              ? `clicked screenshot pixel (${action.x}, ${action.y})`
              : `finished: ${action.judgment}`,
          );
          if (result.status !== "running") return;
        }
      },
      abort: async () => {
        stopped = true;
      },
      dispose: () => undefined,
      getUsage: () => usage,
    };
  }
}

/** 从 Agent Plan 专属 API Key 创建浏览器模型会话工厂。 */
export async function createConfiguredAgentPlanBrowserSessionFactory(
  options: {
    apiKey?: string;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<AgentPlanBrowserSessionFactory> {
  const apiKey = options.apiKey?.trim() || process.env.ARK_AGENT_PLAN_API_KEY?.trim();
  if (!apiKey) {
    throw new BrowserConfigurationError(
      "Configure ARK_AGENT_PLAN_API_KEY before starting a live browser Run.",
    );
  }
  return new AgentPlanBrowserSessionFactory({ apiKey, fetchImpl: options.fetchImpl });
}

async function requestAgentPlanBrowserAction(options: {
  apiKey: string;
  fetchImpl: typeof fetch;
  signal: AbortSignal;
  systemPrompt: string;
  instruction: string;
  history: string[];
  screenshot: string;
}): Promise<BrowserModelAction> {
  const response = await options.fetchImpl(AGENT_PLAN_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    signal: options.signal,
    body: JSON.stringify({
      model: AGENT_PLAN_BROWSER_MODEL.id,
      store: false,
      reasoning: { effort: "low" },
      input: [
        { role: "developer", content: options.systemPrompt },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                options.instruction,
                "Choose exactly one tool. Click coordinates are physical screenshot pixels measured from the top-left.",
                options.history.length > 0
                  ? `Previous actions:\n${options.history.join("\n")}`
                  : "No previous actions.",
              ].join("\n\n"),
            },
            {
              type: "input_image",
              detail: "auto",
              image_url: `data:image/png;base64,${options.screenshot}`,
            },
          ],
        },
      ],
      tools: [
        {
          type: "function",
          name: "click",
          description: "Click one point in the current screenshot.",
          parameters: {
            type: "object",
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              judgment: { type: "string" },
            },
            required: ["x", "y"],
            additionalProperties: false,
          },
        },
        {
          type: "function",
          name: "finished",
          description: "Finish when the browser task needs no more clicks.",
          parameters: {
            type: "object",
            properties: { judgment: { type: "string" } },
            required: ["judgment"],
            additionalProperties: false,
          },
        },
      ],
      tool_choice: "required",
      parallel_tool_calls: false,
      max_output_tokens: 2_048,
    }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(
      `Agent Plan browser request failed (${response.status})${detail ? `: ${detail}` : "."}`,
    );
  }
  return parseBrowserModelAction(await response.json());
}

function parseBrowserModelAction(payload: unknown): BrowserModelAction {
  if (!isRecord(payload) || !Array.isArray(payload.output)) {
    throw new TypeError("The browser model returned an invalid Responses payload.");
  }
  const calls = payload.output.filter(
    (item): item is Record<string, unknown> =>
      isRecord(item) && item.type === "function_call",
  );
  if (calls.length !== 1 || typeof calls[0]!.arguments !== "string") {
    throw new TypeError("The browser model must return exactly one function call.");
  }
  let args: unknown;
  try {
    args = JSON.parse(calls[0]!.arguments);
  } catch {
    throw new TypeError("The browser model returned invalid function arguments.");
  }
  if (!isRecord(args)) {
    throw new TypeError("The browser model returned invalid function arguments.");
  }
  if (calls[0]!.name === "click") {
    if (
      typeof args.x !== "number" ||
      !Number.isFinite(args.x) ||
      typeof args.y !== "number" ||
      !Number.isFinite(args.y) ||
      (args.judgment !== undefined && typeof args.judgment !== "string")
    ) {
      throw new TypeError("The browser model returned invalid click coordinates.");
    }
    return {
      action: "click",
      x: args.x,
      y: args.y,
      ...(typeof args.judgment === "string" ? { judgment: args.judgment } : {}),
    };
  }
  if (
    calls[0]!.name === "finished" &&
    typeof args.judgment === "string" &&
    args.judgment.trim().length > 0
  ) {
    return { action: "finished", judgment: args.judgment.trim() };
  }
  throw new TypeError("The browser model returned an unsupported function call.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
export class PlaywrightBrowserPortFactory implements BrowserPortFactory {
  private readonly browserType: Pick<BrowserType<Browser>, "launch">;

  constructor(
    private readonly options: {
      executablePath?: string;
      browserType?: Pick<BrowserType<Browser>, "launch">;
    } = {},
  ) {
    this.browserType = options.browserType ?? chromium;
  }

  async create(options: {
    baseUrl: string;
    route: string;
    viewport: Viewport;
  }): Promise<BrowserPort> {
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
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
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
      press: async (key) => {
        await page.keyboard.press(key);
        await page.evaluate(
          () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
        );
      },
      inspectDialog: async (name) => {
        const state = await page.evaluate((dialogName) => {
          const accessibleName = (element: Element): string => {
            const labelledBy = element.getAttribute("aria-labelledby");
            return (
              element.getAttribute("aria-label") ??
              (labelledBy
                ? labelledBy
                    .split(/\s+/u)
                    .map((id) => document.getElementById(id)?.textContent ?? "")
                    .join(" ")
                : "")
            ).trim();
          };
          const element = Array.from(
            document.querySelectorAll("dialog,[role='dialog']"),
          ).find((candidate) => accessibleName(candidate) === dialogName);
          const active = document.activeElement;
          const activeName = active
            ? (
                active.getAttribute("aria-label") ??
                active.getAttribute("name") ??
                active.textContent ??
                ""
              ).trim()
            : "";
          return {
            visible:
              element instanceof HTMLDialogElement
                ? element.open
                : element !== undefined && element.getClientRects().length > 0,
            focusInside:
              element !== undefined && active !== null && element.contains(active),
            activeElementName: activeName || null,
          };
        }, name);
        return { ...state, consoleErrors: [...consoleErrors] };
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
      "Prism browser sessions only permit an explicit local HTTP base URL.",
    );
  }
  return baseUrl;
}

/** 解析路由为同 origin 页面 URL，拒绝跨 origin 目标。 */
function localPageUrl(baseUrl: URL, route: string): URL {
  const target = new URL(route, baseUrl);
  if (target.origin !== baseUrl.origin) {
    throw new TypeError(
      "Prism refused a browser route outside the configured local origin.",
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
    activeElement: document.activeElement
      ? {
          tagName: document.activeElement.tagName,
          name:
            document.activeElement.getAttribute("aria-label") ??
            document.activeElement.textContent ??
            document.activeElement.getAttribute("name") ??
            "",
        }
      : null,
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
export interface BrowserRuntimeOptions {
  baseUrl: string;
  viewport: Viewport;
  browserPortFactory: BrowserPortFactory;
  sessionFactory: BrowserSessionFactory;
  artifacts: {
    commit: (content: Uint8Array | string, mediaType: string) => Promise<ArtifactRef>;
  };
  verifier?: BrowserVerifier;
  clock?: () => Date;
}

/** 运行时失败码（与 NodeOutcome.failure.code 对齐）。 */
type BrowserFailureCode = NonNullable<NodeOutcome["failure"]>["code"];

/**
 * 嵌入式 Browser Runtime。
 *
 * execute() 解析 BrowserRuntimeTaskEnvelope，启动受限浏览器端口、创建
 * PrismBrowserOperator + ActionBroker，运行 Agent Plan 会话，收集浏览器动作记录
 * 与轨迹；browser.verify 节点额外用意图链定的确定性谓词 + 模型定性
 * 判断构建 BrowserVerificationReport。
 */
export class BrowserRuntime {
  private readonly clock: () => Date;

  constructor(private readonly options: BrowserRuntimeOptions) {
    this.clock = options.clock ?? (() => new Date());
  }

  async execute(
    envelopeInput: unknown,
    executionOptions: { signal?: AbortSignal } = {},
  ): Promise<BrowserRuntimeResult> {
    const envelope = browserRuntimeTaskEnvelopeSchema.parse(envelopeInput);
    const startedAt = this.clock();
    const trajectory: Array<Record<string, unknown>> = [];
    let port: BrowserPort | null = null;
    let session: BrowserSession | null = null;
    let operator: PrismBrowserOperator | null = null;
    let abortReason: BrowserFailureCode | undefined;
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
    const stopExecution = (reason: BrowserFailureCode): void => {
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
            press: (key) => port!.press(key),
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
      if (error instanceof BrowserSessionCleanupError) {
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
    );
    const usage = session?.getUsage() ?? {
      model: this.options.sessionFactory.model,
      modelCalls: 0,
      loopCount: 0,
      actionsProposed: 0,
      actionsExecuted: 0,
      costUsd: 0,
      durationMs: 0,
    };
    const measuredUsage = browserResourceUsageSchema.parse({
      ...usage,
      durationMs: Math.max(0, this.clock().getTime() - startedAt.getTime()),
    });
    trajectory.push({
      type: "model.usage",
      model: measuredUsage.model,
      modelCalls: measuredUsage.modelCalls,
      loopCount: measuredUsage.loopCount,
      actionsProposed: measuredUsage.actionsProposed,
      actionsExecuted: measuredUsage.actionsExecuted,
      costUsd: measuredUsage.costUsd,
      durationMs: measuredUsage.durationMs,
    });
    const trajectoryArtifact = await this.options.artifacts.commit(
      `${JSON.stringify({
        schemaVersion: "prism.browser-trajectory/v1",
        runId: envelope.runId,
        dagRevision: envelope.dagRevision,
        nodeId: envelope.nodeId,
        attempt: envelope.attempt,
        correlationId: envelope.correlationId,
        causationEventId: envelope.causationEventId,
        events: trajectory,
      })}\n`,
      BROWSER_TRAJECTORY_MEDIA_TYPE,
    );
    const artifacts = [trajectoryArtifact];

    return browserRuntimeResultSchema.parse({
      schemaVersion: BROWSER_RUNTIME_RESULT_SCHEMA_VERSION,
      outcome,
      artifacts,
      browserActions,
      verificationReport,
      usage: measuredUsage,
    });
  }

  /** 用意图链定的确定性谓词 + 模型定性判断构建验证报告。 */
  private async verify(
    envelope: BrowserRuntimeTaskEnvelope,
    port: BrowserPort,
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
        inspectDialog: (name) => port.inspectDialog(name),
        pressKey: (key) => operator.press(key),
      });
      deterministic = {
        assertion: result.assertion,
        intentLinked: true,
        kind: "deterministic",
        status: result.status,
        evidenceRefs: [screenshotArtifact, ...(result.evidenceRefs ?? [])],
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
        "The browser model produced no explicit qualitative judgment.",
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
      evidenceRefs: deterministic.evidenceRefs,
      limitations: [],
      redactions: [],
      recordedAt: this.clock().toISOString(),
    });
  }

  /** 依据运行结果构造 NodeOutcome。 */
  private buildOutcome(
    envelope: BrowserRuntimeTaskEnvelope,
    verificationReport: BrowserVerificationReport | null,
    abortReason: BrowserFailureCode | undefined,
    cleanupFailed: boolean,
    _operator: PrismBrowserOperator | null,
  ): NodeOutcome {
    const failureCode: BrowserFailureCode | undefined = cleanupFailed
      ? "process_cleanup_failed"
      : (abortReason ??
        (envelope.nodeType === "browser.verify" &&
        verificationReport?.verdict !== "passed"
          ? "verification_failed"
          : undefined));

    if (failureCode) {
      const retryable =
        (failureCode === "timed_out" || failureCode === "verification_failed") &&
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
        summary: `Browser Runtime ended with ${failureCode.replaceAll("_", " ")}.`,
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
          ? "The browser verification report passed its intent-linked predicate."
          : "The browser observation completed.",
      request,
      failure: null,
    });
  }

  /** 构造浏览器模型系统提示：约束动作空间并声明代理边界。 */
  private systemPrompt(envelope: BrowserRuntimeTaskEnvelope): string {
    return [
      "You are the embedded Agent Plan Browser Runtime inside Prism.",
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
