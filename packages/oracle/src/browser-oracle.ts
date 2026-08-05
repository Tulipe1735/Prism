import type {
  FrontendRepairPredicate,
  FrontendRepairSpec,
  SemanticBrowserTarget,
  Viewport,
} from "@prism/contracts";

import { randomUUID } from "node:crypto";

import {
  type Browser,
  type BrowserContext,
  type BrowserType,
  chromium,
  type Page,
} from "playwright-core";

import { sha256 } from "./hash";

/**
 * Prism 浏览器 Oracle（browser-oracle）
 *
 * 权威渲染 Oracle：用 Playwright 观测语义目标（按钮）在某个本地路由上的
 * 计算样式、几何、文本、可点击性与局部目标区域截图，然后对归一化修复规范
 * 的关系/不变式谓词逐条判定，产出 passed/failed 结论。
 *
 * 设计：
 *  - observe() 只做观测，返回可校验的 RenderedTargetObservation；
 *  - evaluateSpec() 是纯函数，只用 before/after 观测与规范，不触浏览器，
 *    便于确定性单元测试；
 *  - verify() 组合两者：基于调用方传入的 before 基线观测当前 after 态。
 *
 * 网络约束与 BrowserExecutor 一致：只放行同 origin 的 GET/HEAD。
 */

/** 一次语义目标的渲染观测：可判定谓词所需的全部渲染事实。 */
export interface RenderedTargetObservation {
  observationId: string;
  url: string;
  viewport: Viewport;
  target: SemanticBrowserTarget;
  /** 计算样式解析出的圆角半径（px）。 */
  borderRadiusPx: number;
  /** 渲染包围盒（CSS px）。 */
  widthPx: number;
  heightPx: number;
  xPx: number;
  yPx: number;
  /** 目标元素的可访问名/文本。 */
  text: string;
  /** 元素是否可用（非 disabled）。 */
  enabled: boolean;
  /** 元素是否可见（visibility/opacity）。 */
  visible: boolean;
  /** 元素 pointer-events 计算值。 */
  pointerEvents: string;
  /** 局部目标区域截图的 SHA-256。 */
  regionClipHash: string;
  /** 页面截图 SHA-256。 */
  screenshotHash: string;
}

/** 单条谓词判定结果。 */
export interface OracleAssertion {
  assertion: string;
  predicate: FrontendRepairPredicate;
  status: "passed" | "failed";
}

/** 规范评估结果：全部谓词通过才 passed。 */
export interface OracleEvaluation {
  verdict: "passed" | "failed";
  assertions: OracleAssertion[];
}

/** 浏览器 Oracle 构造选项。 */
export interface BrowserOracleOptions {
  baseUrl: string;
  route: string;
  viewport: Viewport;
  target: SemanticBrowserTarget;
  /** 可执行文件路径（未提供时用 Playwright 默认 Chromium）。 */
  executablePath?: string;
  /** 浏览器类型（默认 chromium；测试可注入 mock）。 */
  browserType?: Pick<BrowserType<Browser>, "launch">;
  /**
   * 测量前钩子：在页面导航并定位到目标之后、抓取渲染事实之前运行。
   * 用于在测量前复现交互状态（例如打开菜单、注入修复样式）。
   */
  beforeMeasure?: (page: Page) => Promise<void>;
}

/** 校验并解析本地基础 URL（必须为显式本地 HTTP origin）。 */
function localBaseUrl(input: string): URL {
  const baseUrl = new URL(input);
  const isLocalHost = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(
    baseUrl.hostname,
  );
  if (baseUrl.protocol !== "http:" || !isLocalHost) {
    throw new TypeError(
      "Prism BrowserOracle only permits an explicit local HTTP base URL.",
    );
  }
  return baseUrl;
}

/** 把路由解析为同 origin 页面 URL，拒绝跨 origin 目标。 */
function localPageUrl(baseUrl: URL, route: string): URL {
  const target = new URL(route, baseUrl);
  if (target.origin !== baseUrl.origin) {
    throw new TypeError(
      "Prism BrowserOracle refused a route outside the configured local origin.",
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

/** 解析计算样式字符串为 px 数值（"8px" → 8）。 */
function parsePixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** 从计算样式与包围盒提取渲染事实（在页面上下文内执行）。 */
function renderFacts(element: HTMLElement): {
  borderRadius: string;
  rectangle: { x: number; y: number; width: number; height: number };
  text: string;
  disabled: boolean;
  visible: boolean;
  pointerEvents: string;
} {
  const style = getComputedStyle(element);
  const rectangle = element.getBoundingClientRect();
  const opacity = Number.parseFloat(style.opacity);
  return {
    borderRadius: style.borderRadius,
    rectangle: {
      x: rectangle.x,
      y: rectangle.y,
      width: rectangle.width,
      height: rectangle.height,
    },
    text: (element.textContent ?? "").trim(),
    disabled: "disabled" in element && (element as HTMLButtonElement).disabled,
    visible:
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      (Number.isFinite(opacity) ? opacity > 0 : true),
    pointerEvents: style.pointerEvents,
  };
}

/**
 * 浏览器 Oracle：观测语义目标的渲染事实并对归一化规范做出判定。
 */
export class BrowserOracle {
  private readonly browserType: Pick<BrowserType<Browser>, "launch">;
  private readonly baseUrl: URL;

  constructor(private readonly options: BrowserOracleOptions) {
    this.browserType = options.browserType ?? chromium;
    this.baseUrl = localBaseUrl(options.baseUrl);
  }

  /**
   * 观测目标元素当前渲染事实：导航 → 语义定位 → 抓取计算样式/几何/
   * 文本/可点击性 + 局部目标区域截图。
   */
  async observe(): Promise<RenderedTargetObservation> {
    const targetUrl = localPageUrl(this.baseUrl, this.options.route);
    const browser = await this.browserType.launch({
      headless: true,
      executablePath: this.options.executablePath,
    });
    try {
      const context = await browser.newContext({
        viewport: {
          width: this.options.viewport.width,
          height: this.options.viewport.height,
        },
        deviceScaleFactor: this.options.viewport.deviceScaleFactor,
        acceptDownloads: false,
      });
      await confineNetwork(context, this.baseUrl);
      const page = await context.newPage();
      await page.goto(targetUrl.toString(), { waitUntil: "networkidle" });

      const locator = page.getByRole(this.options.target.role as never, {
        name: this.options.target.name,
        exact: this.options.target.exact,
      });
      await locator.waitFor({ state: "visible" });

      await this.options.beforeMeasure?.(page);

      const [regionClip, pageScreenshot, facts] = await Promise.all([
        locator.screenshot(),
        page.screenshot({ type: "png" }),
        locator.evaluate(renderFacts),
      ]);

      await context.close();
      const observation: RenderedTargetObservation = {
        observationId: randomUUID(),
        url: page.url(),
        viewport: this.options.viewport,
        target: this.options.target,
        borderRadiusPx: parsePixels(facts.borderRadius),
        widthPx: facts.rectangle.width,
        heightPx: facts.rectangle.height,
        xPx: facts.rectangle.x,
        yPx: facts.rectangle.y,
        text: facts.text,
        enabled: !facts.disabled,
        visible: facts.visible,
        pointerEvents: facts.pointerEvents,
        regionClipHash: sha256(regionClip),
        screenshotHash: sha256(pageScreenshot),
      };
      return observation;
    } finally {
      await browser.close();
    }
  }

  /**
   * 用 before/after 观测评估归一化规范（纯函数，不触浏览器）。
   */
  static evaluateSpec(
    spec: FrontendRepairSpec,
    before: RenderedTargetObservation,
    after: RenderedTargetObservation,
  ): OracleEvaluation {
    const assertions = spec.predicates.map((predicate) =>
      BrowserOracle.evaluatePredicate(predicate, before, after),
    );
    const verdict = assertions.every((assertion) => assertion.status === "passed")
      ? "passed"
      : "failed";
    return { verdict, assertions };
  }

  /** 对单条谓词做确定性判定。 */
  static evaluatePredicate(
    predicate: FrontendRepairPredicate,
    before: RenderedTargetObservation,
    after: RenderedTargetObservation,
  ): OracleAssertion {
    switch (predicate.kind) {
      case "metric-increase": {
        const delta = after.borderRadiusPx - before.borderRadiusPx;
        const passed =
          delta >= predicate.minDeltaPx && after.borderRadiusPx >= predicate.minAfterPx;
        return {
          assertion: `Rendered border-radius increased materially from ${before.borderRadiusPx}px to ${after.borderRadiusPx}px (delta ${delta}px >= ${predicate.minDeltaPx}px, after >= ${predicate.minAfterPx}px).`,
          predicate,
          status: passed ? "passed" : "failed",
        };
      }
      case "label-preserved": {
        const passed = after.text === before.text;
        return {
          assertion: `Label preserved: "${before.text}" unchanged as "${after.text}".`,
          predicate,
          status: passed ? "passed" : "failed",
        };
      }
      case "region-clip-differs": {
        const passed = after.regionClipHash !== before.regionClipHash;
        return {
          assertion: passed
            ? "The localized before/after target region changed (rendered evidence differs)."
            : "The localized before/after target region is unchanged; the repair did not affect the target.",
          predicate,
          status: passed ? "passed" : "failed",
        };
      }
      case "clickable": {
        const passed = after.enabled && after.visible && after.pointerEvents !== "none";
        return {
          assertion: `Target remains clickable (enabled=${after.enabled}, visible=${after.visible}, pointerEvents=${after.pointerEvents}).`,
          predicate,
          status: passed ? "passed" : "failed",
        };
      }
      case "size-within": {
        const widthDelta = Math.abs(after.widthPx - before.widthPx);
        const heightDelta = Math.abs(after.heightPx - before.heightPx);
        const passed =
          widthDelta <= predicate.tolerancePx && heightDelta <= predicate.tolerancePx;
        return {
          assertion: `Control size preserved within ${predicate.tolerancePx}px (width delta ${widthDelta.toFixed(1)}px, height delta ${heightDelta.toFixed(1)}px).`,
          predicate,
          status: passed ? "passed" : "failed",
        };
      }
      case "layout-within": {
        const xDelta = Math.abs(after.xPx - before.xPx);
        const yDelta = Math.abs(after.yPx - before.yPx);
        const passed =
          xDelta <= predicate.tolerancePx && yDelta <= predicate.tolerancePx;
        return {
          assertion: `Declared layout invariant preserved within ${predicate.tolerancePx}px (x delta ${xDelta.toFixed(1)}px, y delta ${yDelta.toFixed(1)}px).`,
          predicate,
          status: passed ? "passed" : "failed",
        };
      }
    }
  }
}
