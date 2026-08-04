/**
 * Prism 浏览器执行器（browser-executor）
 *
 * 用 Playwright 的无头 Chromium 在受限的本地 origin 内采集浏览器基线：
 * 定位目标元素后一次性并行抓取截图 / DOM / 无障碍快照 / 计算样式 /
 * 控制台 / 网络事件 / 页面 trace，并封装为 BrowserBaselineCapture。
 *
 * 安全约束：
 *  - baseUrl 只允许显式的本地 HTTP origin（127.0.0.1 / localhost / ::1），
 *    路由必须保持在同一 origin 内，任何跨 origin 请求都会被 abort；
 *  - 通过 context.route 拦截网络：只放行同 origin 的 GET/HEAD，其余中止，
 *    防止基线采集期间访问外部网络；
 *  - 关闭下载（acceptDownloads: false）。
 */
import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type BrowserBaselineRecord,
  browserBaselineRequestSchema,
  type BrowserCaptureTarget,
  type BrowserObservationReference,
  type Viewport,
} from "@prism/contracts";
import { type Browser, type BrowserType, chromium, type Page } from "playwright-core";

/** 浏览器执行器构造选项。 */
export interface BrowserExecutorOptions {
  /** 本地应用的基础 URL（必须是显式本地 HTTP origin）。 */
  baseUrl: string;
  /** 构建身份标识，写入基线的 buildIdentity 字段。 */
  buildIdentity: string;
  /** 浏览器视口配置（宽/高/设备像素比）。 */
  viewport: Viewport;
  /** 可执行文件路径（未提供时用 Playwright 默认 Chromium）。 */
  executablePath?: string;
  /** 浏览器类型（默认 chromium；测试可注入 mock）。 */
  browserType?: Pick<BrowserType<Browser>, "launch">;
  /** 时钟注入，便于测试固定时间。 */
  clock?: () => Date;
}

/**
 * 一次浏览器基线的采集结果。
 *
 * baseline 是除 7 个产物引用外的全部记录字段（产物引用在落盘时才生成），
 * artifacts 携带各产物的原始字节，由调用方写入内容寻址存储。
 */
export interface BrowserBaselineCapture {
  baseline: Omit<
    BrowserBaselineRecord,
    | "screenshot"
    | "dom"
    | "accessibility"
    | "computed"
    | "console"
    | "network"
    | "trace"
  >;
  artifacts: {
    screenshot: Buffer;
    dom: Buffer;
    accessibility: Buffer;
    computed: Buffer;
    console: Buffer;
    network: Buffer;
    trace: Buffer;
  };
}

/** 计算内容的 SHA-256 十六进制摘要。 */
function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** 把值序列化为一行 JSON 的 Buffer（UTF-8，末尾换行）。 */
function jsonLine(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
}

/**
 * 校验并解析本地基础 URL。
 *
 * @throws TypeError 协议不是 http 或主机不在本地回环名单内时
 */
function localBaseUrl(input: string): URL {
  const baseUrl = new URL(input);
  const isLocalHost = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(
    baseUrl.hostname,
  );
  if (baseUrl.protocol !== "http:" || !isLocalHost) {
    throw new TypeError(
      "Prism BrowserExecutor only permits an explicit local HTTP base URL.",
    );
  }

  return baseUrl;
}

/**
 * 把路由解析为可访问的页面 URL，并强制保持在同一本地 origin 内。
 *
 * @throws TypeError 解析结果 origin 与基础 URL 不一致时
 */
function localPageUrl(baseUrl: URL, route: string): URL {
  const target = new URL(route, baseUrl);
  if (target.origin !== baseUrl.origin) {
    throw new TypeError(
      "Prism BrowserExecutor refused a route outside the configured local origin.",
    );
  }

  return target;
}

/** 生成目标元素的身份指纹字符串（用于基线的 targetIdentity）。 */
function targetIdentity(target: BrowserCaptureTarget): string {
  const semantic = `role=${target.role}[name=${target.name}]`;
  if (target.kind === "semantic") return semantic;

  // 混合目标额外带上屏幕坐标边框
  const { x, y, width, height } = target.grounding;
  return `${semantic}@${x},${y},${width}x${height}`;
}

/**
 * 观测页面当前状态：采集标题/就绪状态/滚动位置/正文文本，返回观测引用。
 *
 * 页面状态以 JSON 行的 SHA-256 摘要标识（pageStateHash），与截图哈希
 * 一起作为后续坐标动作新鲜度校验的依据。
 */
async function observePage(
  page: Page,
  viewport: Viewport,
  screenshotHash: string,
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
    pageStateHash: sha256(jsonLine(state)),
    screenshotHash,
  };
}

/**
 * 浏览器执行器：采集目标元素的完整浏览器基线。
 */
export class BrowserExecutor {
  private readonly browserType: Pick<BrowserType<Browser>, "launch">;
  private readonly clock: () => Date;
  private readonly baseUrl: URL;

  constructor(private readonly options: BrowserExecutorOptions) {
    this.browserType = options.browserType ?? chromium;
    this.clock = options.clock ?? (() => new Date());
    this.baseUrl = localBaseUrl(options.baseUrl);
  }

  /**
   * 采集一次浏览器基线。
   *
   * 流程：解析请求与目标 URL → 启动无头浏览器 → 建立受限上下文
   * （仅放行同 origin 的 GET/HEAD，收集控制台与网络事件）→ 导航到目标 →
   * 等待目标元素可见 → 并行抓取截图/DOM/无障碍/计算样式 → 记录 trace →
   * 观测页面状态，封装为基线捕获结果。
   *
   * @param input 必须通过 browserBaselineRequestSchema 校验的基线请求
   * @returns 基线记录（缺产物引用）+ 各产物原始字节
   */
  async captureBaseline(input: unknown): Promise<BrowserBaselineCapture> {
    const request = browserBaselineRequestSchema.parse(input);
    const targetUrl = localPageUrl(this.baseUrl, request.route);
    const browser = await this.browserType.launch({
      headless: true,
      executablePath: this.options.executablePath,
    });
    // trace 写入临时目录，结束后整体清理
    const traceDirectory = await mkdtemp(path.join(tmpdir(), "prism-browser-trace-"));
    const tracePath = path.join(traceDirectory, "trace.zip");
    const consoleMessages: Array<{ type: string; text: string }> = [];
    const networkEvents: Array<{
      kind: "request" | "response";
      url: string;
      status?: number;
    }> = [];

    try {
      const context = await browser.newContext({
        viewport: {
          width: this.options.viewport.width,
          height: this.options.viewport.height,
        },
        deviceScaleFactor: this.options.viewport.deviceScaleFactor,
        acceptDownloads: false,
      });
      // 网络白名单：只放行同 origin 的 GET/HEAD，其余一律中止
      await context.route("**/*", async (route) => {
        const request = route.request();
        const requestUrl = new URL(request.url());
        if (
          requestUrl.origin !== this.baseUrl.origin ||
          !["GET", "HEAD"].includes(request.method())
        ) {
          await route.abort();
          return;
        }

        await route.continue();
      });
      const page = await context.newPage();
      page.on("console", (message) => {
        consoleMessages.push({ type: message.type(), text: message.text() });
      });
      page.on("request", (resource) => {
        networkEvents.push({ kind: "request", url: resource.url() });
      });
      page.on("response", (resource) => {
        networkEvents.push({
          kind: "response",
          url: resource.url(),
          status: resource.status(),
        });
      });

      await context.tracing.start({
        screenshots: true,
        snapshots: true,
        sources: false,
      });
      await page.goto(targetUrl.toString(), { waitUntil: "networkidle" });
      // 按语义角色 + 可访问名定位目标元素，等待其可见
      const locator = page.getByRole(request.target.role as never, {
        name: request.target.name,
        exact: request.target.exact,
      });
      await locator.waitFor({ state: "visible" });
      // 并行抓取截图 / DOM / 无障碍快照 / 目标元素计算样式与包围盒
      const [screenshot, dom, accessibility, computed] = await Promise.all([
        page.screenshot({ type: "png" }),
        page.content(),
        locator.ariaSnapshot(),
        locator.evaluate((element) => {
          const style = getComputedStyle(element);
          const rectangle = element.getBoundingClientRect();
          return {
            rectangle: {
              x: rectangle.x,
              y: rectangle.y,
              width: rectangle.width,
              height: rectangle.height,
            },
            styles: {
              display: style.display,
              visibility: style.visibility,
              opacity: style.opacity,
              pointerEvents: style.pointerEvents,
            },
          };
        }),
      ]);
      const browserVersion = `Chromium ${browser.version()}`;
      const viewport = this.options.viewport;
      const observation = await observePage(page, viewport, sha256(screenshot));
      await context.tracing.stop({ path: tracePath });
      await context.close();

      return {
        baseline: {
          schemaVersion: "prism.browser-baseline/v1",
          baselineId: randomUUID(),
          runId: request.runId,
          buildIdentity: this.options.buildIdentity,
          route: request.route,
          browserVersion,
          viewport,
          devicePixelRatio: viewport.deviceScaleFactor,
          target: request.target,
          targetIdentity: targetIdentity(request.target),
          observation,
          capturedAt: this.clock().toISOString(),
          supplementalVisualJudgment: null,
        },
        artifacts: {
          screenshot,
          dom: Buffer.from(dom, "utf8"),
          accessibility: Buffer.from(accessibility, "utf8"),
          computed: jsonLine(computed),
          console: jsonLine(consoleMessages),
          network: jsonLine(networkEvents),
          trace: await readFile(tracePath),
        },
      };
    } finally {
      await browser.close();
      await rm(traceDirectory, { recursive: true, force: true });
    }
  }
}
