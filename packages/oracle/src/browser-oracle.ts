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
  /** 目标元素的计算阴影；缺失时为 "none"。 */
  boxShadow: string;
  /** 渲染包围盒（CSS px）。 */
  widthPx: number;
  heightPx: number;
  xPx: number;
  yPx: number;
  /** 父级与相邻元素几何，用于证明修复未移动周边布局。 */
  surroundings: {
    parent: RenderedRectangle | null;
    siblings: RenderedRectangle[];
  };
  /** 当前视口的页面与操作控件几何。 */
  layout?: ResponsiveLayoutFacts;
  /** 响应式场景的固定桌面参照。 */
  desktop?: {
    viewport: Viewport;
    target: RenderedRectangle;
    layout: ResponsiveLayoutFacts;
  };
  /** 可选交互状态；Dialog 场景由同一受控会话补齐关闭与焦点归还结果。 */
  dialog?: {
    name: string;
    visible: boolean;
    focusInside: boolean;
    escapeCloses: boolean;
    focusReturnsToTrigger: boolean;
    activeElementName?: string | null;
    consoleErrors: string[];
  };
  /** 可选表单状态转换；由真实键盘输入驱动并记录原生/无障碍禁用状态。 */
  form?: {
    inputName: string;
    empty: FormControlState;
    invalid: FormControlState;
    valid: FormControlState;
    keyboardFocusReachedTarget: boolean;
    consoleErrors: string[];
  };
  /** 可选菜单交互：记录 trigger/menu/item 几何、中心命中与真实指针点击结果。 */
  menu?: {
    triggerName: string;
    trigger: RenderedRectangle;
    menu: RenderedRectangle;
    item: RenderedRectangle;
    hitPoint: { x: number; y: number };
    clipped: boolean;
    unoccluded: boolean;
    menuZIndex: string;
    hitTargetName: string;
    clickReceived: boolean;
    successText: string;
    consoleErrors: string[];
  };
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

export interface RenderedRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ResponsiveLayoutFacts {
  documentWidthPx: number;
  horizontalOverflowPx: number;
  targetInsideViewport: boolean;
  targetClipped: boolean;
  actionRectangles: RenderedRectangle[];
  actionsInsideViewport: boolean;
  actionsOverlap: boolean;
}

export interface FormControlState {
  value: string;
  inputValid: boolean;
  enabled: boolean;
  accessibilityDisabled: boolean;
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
  /** 需要读取的具名 Dialog；不发送任何输入。 */
  dialogName?: string;
  /** 需要验证的邮箱输入转换；使用页面键盘完成输入与 Tab 导航。 */
  form?: {
    inputName: string;
    invalidValue: string;
    validValue: string;
  };
  /** 需要验证的已打开菜单；以菜单项中心的真实指针点击为准。 */
  menu?: { triggerName: string; successText: string };
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
  boxShadow: string;
  rectangle: RenderedRectangle;
  surroundings: {
    parent: RenderedRectangle | null;
    siblings: RenderedRectangle[];
  };
  layout: ResponsiveLayoutFacts;
  text: string;
  disabled: boolean;
  visible: boolean;
  pointerEvents: string;
} {
  const rectangleOf = (candidate: Element): RenderedRectangle => {
    const rectangle = candidate.getBoundingClientRect();
    return {
      x: rectangle.x,
      y: rectangle.y,
      width: rectangle.width,
      height: rectangle.height,
    };
  };
  const style = getComputedStyle(element);
  const parent = element.parentElement;
  const opacity = Number.parseFloat(style.opacity);
  const rectangle = rectangleOf(element);
  const actionRectangles = Array.from(
    element.querySelectorAll("button,a,input,select,textarea"),
  ).map(rectangleOf);
  const insideViewport = (candidate: RenderedRectangle): boolean =>
    candidate.x >= 0 &&
    candidate.y >= 0 &&
    candidate.x + candidate.width <= window.innerWidth &&
    candidate.y + candidate.height <= window.innerHeight;
  const actionsOverlap = actionRectangles.some((left, index) =>
    actionRectangles
      .slice(index + 1)
      .some(
        (right) =>
          left.x < right.x + right.width &&
          left.x + left.width > right.x &&
          left.y < right.y + right.height &&
          left.y + left.height > right.y,
      ),
  );
  const documentWidthPx = Math.max(
    document.documentElement.scrollWidth,
    document.body.scrollWidth,
  );
  const targetInsideViewport = insideViewport(rectangle);
  return {
    borderRadius: style.borderRadius,
    boxShadow: style.boxShadow,
    rectangle,
    surroundings: {
      parent: parent ? rectangleOf(parent) : null,
      siblings: parent
        ? Array.from(parent.children)
            .filter((candidate) => candidate !== element)
            .map(rectangleOf)
        : [],
    },
    layout: {
      documentWidthPx,
      horizontalOverflowPx: Math.max(0, documentWidthPx - window.innerWidth),
      targetInsideViewport,
      targetClipped: !targetInsideViewport,
      actionRectangles,
      actionsInsideViewport: actionRectangles.every(insideViewport),
      actionsOverlap,
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
      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      await page.goto(targetUrl.toString(), { waitUntil: "networkidle" });

      const locator = page.getByRole(this.options.target.role as never, {
        name: this.options.target.name,
        exact: this.options.target.exact,
      });
      await locator.waitFor({ state: "visible" });

      await this.options.beforeMeasure?.(page);

      let form: RenderedTargetObservation["form"];
      if (this.options.form) {
        const input = page.getByRole("textbox", {
          name: this.options.form.inputName,
          exact: true,
        });
        await input.waitFor({ state: "visible" });
        const readState = async (): Promise<FormControlState> => {
          const inputState = await input.evaluate((element) => ({
            value: (element as HTMLInputElement).value,
            inputValid: (element as HTMLInputElement).validity.valid,
          }));
          const buttonState = await locator.evaluate((element) => {
            const disabled =
              "disabled" in element && (element as HTMLButtonElement).disabled;
            return {
              enabled: !disabled,
              accessibilityDisabled:
                element.getAttribute("aria-disabled") === "true" || disabled,
            };
          });
          return { ...inputState, ...buttonState };
        };
        const replaceValue = async (value: string): Promise<void> => {
          await input.focus();
          await page.keyboard.press("Control+A");
          await page.keyboard.type(value);
        };

        const empty = await readState();
        await replaceValue(this.options.form.invalidValue);
        const invalid = await readState();
        await replaceValue(this.options.form.validValue);
        const valid = await readState();
        await page.keyboard.press("Tab");
        const keyboardFocusReachedTarget = await locator.evaluate(
          (element) => document.activeElement === element,
        );
        form = {
          inputName: this.options.form.inputName,
          empty,
          invalid,
          valid,
          keyboardFocusReachedTarget,
          consoleErrors,
        };
      }

      let dialog: RenderedTargetObservation["dialog"];
      if (this.options.dialogName) {
        const dialogLocator = page.getByRole("dialog", {
          name: this.options.dialogName,
          exact: true,
        });
        const exists = (await dialogLocator.count()) > 0;
        dialog = {
          name: this.options.dialogName,
          visible: exists && (await dialogLocator.isVisible()),
          focusInside:
            exists &&
            (await dialogLocator.evaluate((element) =>
              element.contains(document.activeElement),
            )),
          escapeCloses: false,
          focusReturnsToTrigger: false,
          activeElementName: null,
          consoleErrors,
        };
      }

      let menu: RenderedTargetObservation["menu"];
      if (this.options.menu) {
        const trigger = page.getByRole("button", {
          name: this.options.menu.triggerName,
          exact: true,
        });
        const triggerRectangle = await trigger.evaluate((element) => {
          const rectangle = element.getBoundingClientRect();
          return {
            x: rectangle.x,
            y: rectangle.y,
            width: rectangle.width,
            height: rectangle.height,
          };
        });
        const menuFacts = await locator.evaluate((element) => {
          const menuElement = element.closest("[role='menu']");
          if (!menuElement) throw new TypeError("The menu item has no menu ancestor.");
          const rectangleOf = (candidate: Element): RenderedRectangle => {
            const rectangle = candidate.getBoundingClientRect();
            return {
              x: rectangle.x,
              y: rectangle.y,
              width: rectangle.width,
              height: rectangle.height,
            };
          };
          const item = rectangleOf(element);
          const menuRectangle = rectangleOf(menuElement);
          const hitPoint = {
            x: item.x + item.width / 2,
            y: item.y + item.height / 2,
          };
          const hitTarget = document.elementFromPoint(hitPoint.x, hitPoint.y);
          let clippedByAncestor = false;
          for (
            let ancestor = menuElement.parentElement;
            ancestor;
            ancestor = ancestor.parentElement
          ) {
            const style = getComputedStyle(ancestor);
            const clips = ["auto", "clip", "hidden", "scroll"].some(
              (value) => style.overflowX === value || style.overflowY === value,
            );
            if (!clips) continue;
            const rectangle = rectangleOf(ancestor);
            clippedByAncestor =
              menuRectangle.x < rectangle.x ||
              menuRectangle.y < rectangle.y ||
              menuRectangle.x + menuRectangle.width > rectangle.x + rectangle.width ||
              menuRectangle.y + menuRectangle.height > rectangle.y + rectangle.height;
            if (clippedByAncestor) break;
          }
          return {
            menu: menuRectangle,
            item,
            hitPoint,
            clipped:
              menuRectangle.x < 0 ||
              menuRectangle.y < 0 ||
              menuRectangle.x + menuRectangle.width > window.innerWidth ||
              menuRectangle.y + menuRectangle.height > window.innerHeight ||
              clippedByAncestor,
            unoccluded:
              hitTarget !== null &&
              (hitTarget === element || element.contains(hitTarget)),
            menuZIndex: getComputedStyle(menuElement).zIndex,
            hitTargetName: (
              hitTarget?.getAttribute("aria-label") ??
              hitTarget?.textContent ??
              hitTarget?.tagName ??
              ""
            ).trim(),
          };
        });
        await page.mouse.click(menuFacts.hitPoint.x, menuFacts.hitPoint.y);
        const clickReceived =
          (await locator.getAttribute("data-activated")) === "true" &&
          (await page
            .getByText(this.options.menu.successText, { exact: true })
            .count()) > 0;
        menu = {
          triggerName: this.options.menu.triggerName,
          trigger: triggerRectangle,
          ...menuFacts,
          clickReceived,
          successText: this.options.menu.successText,
          consoleErrors,
        };
      }

      const facts = await locator.evaluate(renderFacts);
      // 阴影绘制在元素边界外；局部证据需保留一圈固定上下文。
      const padding = 32;
      const clip = {
        x: Math.max(0, facts.rectangle.x - padding),
        y: Math.max(0, facts.rectangle.y - padding),
        width:
          Math.min(
            this.options.viewport.width,
            facts.rectangle.x + facts.rectangle.width + padding,
          ) - Math.max(0, facts.rectangle.x - padding),
        height:
          Math.min(
            this.options.viewport.height,
            facts.rectangle.y + facts.rectangle.height + padding,
          ) - Math.max(0, facts.rectangle.y - padding),
      };
      const [regionClip, pageScreenshot] = await Promise.all([
        page.screenshot({ type: "png", clip }),
        page.screenshot({ type: "png" }),
      ]);

      await context.close();
      const observation: RenderedTargetObservation = {
        observationId: randomUUID(),
        url: page.url(),
        viewport: this.options.viewport,
        target: this.options.target,
        borderRadiusPx: parsePixels(facts.borderRadius),
        boxShadow: facts.boxShadow,
        widthPx: facts.rectangle.width,
        heightPx: facts.rectangle.height,
        xPx: facts.rectangle.x,
        yPx: facts.rectangle.y,
        surroundings: facts.surroundings,
        layout: facts.layout,
        ...(dialog ? { dialog } : {}),
        ...(form ? { form } : {}),
        ...(menu ? { menu } : {}),
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
      case "shadow-present": {
        const passed = before.boxShadow === "none" && after.boxShadow !== "none";
        return {
          assertion: `Rendered box-shadow changed from ${before.boxShadow} to ${after.boxShadow}.`,
          predicate,
          status: passed ? "passed" : "failed",
        };
      }
      case "dialog-behavior": {
        const beforeDialog = before.dialog;
        const afterDialog = after.dialog;
        const passed =
          beforeDialog?.name === predicate.dialogName &&
          beforeDialog.visible === false &&
          afterDialog?.name === predicate.dialogName &&
          afterDialog.visible &&
          afterDialog.focusInside &&
          afterDialog.escapeCloses &&
          afterDialog.focusReturnsToTrigger &&
          afterDialog.consoleErrors.length === 0;
        return {
          assertion: passed
            ? `Dialog "${predicate.dialogName}" opened, received focus, closed with Escape, returned focus to its trigger, and added no console error.`
            : `Dialog "${predicate.dialogName}" failed its interaction invariants: ${JSON.stringify(afterDialog ?? null)}.`,
          predicate,
          status: passed ? "passed" : "failed",
        };
      }
      case "form-enablement": {
        const beforeForm = before.form;
        const afterForm = after.form;
        const passed =
          beforeForm?.inputName === predicate.inputName &&
          beforeForm.empty.enabled === false &&
          beforeForm.invalid.enabled === false &&
          beforeForm.valid.enabled === false &&
          afterForm?.inputName === predicate.inputName &&
          afterForm.empty.value === "" &&
          afterForm.empty.inputValid === false &&
          afterForm.empty.enabled === false &&
          afterForm.empty.accessibilityDisabled &&
          afterForm.invalid.value === predicate.invalidValue &&
          afterForm.invalid.inputValid === false &&
          afterForm.invalid.enabled === false &&
          afterForm.invalid.accessibilityDisabled &&
          afterForm.valid.value === predicate.validValue &&
          afterForm.valid.inputValid &&
          afterForm.valid.enabled &&
          afterForm.valid.accessibilityDisabled === false &&
          afterForm.keyboardFocusReachedTarget &&
          afterForm.consoleErrors.length === 0;
        return {
          assertion: passed
            ? `Empty and invalid ${predicate.inputName} values kept Submit disabled; keyboard entry of ${predicate.validValue} enabled and focused Submit with no console error.`
            : `Form enablement failed its input, accessibility, or keyboard invariants: ${JSON.stringify(afterForm ?? null)}.`,
          predicate,
          status: passed ? "passed" : "failed",
        };
      }
      case "responsive-layout": {
        const beforeLayout = before.layout;
        const afterLayout = after.layout;
        const beforeDesktop = before.desktop;
        const afterDesktop = after.desktop;
        const desktopDeltas =
          beforeDesktop && afterDesktop
            ? [
                Math.abs(afterDesktop.target.x - beforeDesktop.target.x),
                Math.abs(afterDesktop.target.y - beforeDesktop.target.y),
                Math.abs(afterDesktop.target.width - beforeDesktop.target.width),
                Math.abs(afterDesktop.target.height - beforeDesktop.target.height),
              ]
            : [Number.POSITIVE_INFINITY];
        const maxDesktopDelta = Math.max(...desktopDeltas);
        const passed =
          beforeLayout !== undefined &&
          beforeLayout.horizontalOverflowPx > 0 &&
          beforeLayout.targetInsideViewport === false &&
          afterLayout !== undefined &&
          afterLayout.horizontalOverflowPx === 0 &&
          afterLayout.targetInsideViewport &&
          afterLayout.targetClipped === false &&
          afterLayout.actionsInsideViewport &&
          afterLayout.actionsOverlap === false &&
          beforeDesktop?.viewport.width === predicate.desktopViewport.width &&
          beforeDesktop.viewport.height === predicate.desktopViewport.height &&
          beforeDesktop.layout.horizontalOverflowPx === 0 &&
          beforeDesktop.layout.actionsInsideViewport &&
          beforeDesktop.layout.actionsOverlap === false &&
          afterDesktop?.viewport.width === predicate.desktopViewport.width &&
          afterDesktop.viewport.height === predicate.desktopViewport.height &&
          afterDesktop.layout.horizontalOverflowPx === 0 &&
          afterDesktop.layout.actionsInsideViewport &&
          afterDesktop.layout.actionsOverlap === false &&
          maxDesktopDelta <= predicate.tolerancePx;
        return {
          assertion: passed
            ? `Mobile horizontal overflow was removed, every checkout action is visible and non-overlapping, and desktop target geometry stayed within ${predicate.tolerancePx}px.`
            : `Responsive layout failed its mobile or desktop invariants: mobile=${JSON.stringify(afterLayout ?? null)}, desktop=${JSON.stringify(afterDesktop ?? null)}.`,
          predicate,
          status: passed ? "passed" : "failed",
        };
      }
      case "menu-behavior": {
        const beforeMenu = before.menu;
        const afterMenu = after.menu;
        const passed =
          beforeMenu?.triggerName === predicate.triggerName &&
          beforeMenu.clipped === false &&
          beforeMenu.unoccluded === false &&
          beforeMenu.clickReceived === false &&
          afterMenu?.triggerName === predicate.triggerName &&
          afterMenu.successText === predicate.successText &&
          afterMenu.clipped === false &&
          afterMenu.unoccluded &&
          afterMenu.clickReceived &&
          afterMenu.hitTargetName === after.text &&
          afterMenu.consoleErrors.length === 0;
        return {
          assertion: passed
            ? `Menu item "${after.text}" is visible, unclipped, topmost at its center, and received the pointer click with no console error.`
            : `Menu interaction failed its clipping, hit-test, or click invariants: ${JSON.stringify(afterMenu ?? null)}.`,
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
      case "surroundings-within": {
        const beforeRectangles = [
          ...(before.surroundings.parent ? [before.surroundings.parent] : []),
          ...before.surroundings.siblings,
        ];
        const afterRectangles = [
          ...(after.surroundings.parent ? [after.surroundings.parent] : []),
          ...after.surroundings.siblings,
        ];
        const deltas = beforeRectangles.flatMap((rectangle, index) => {
          const afterRectangle = afterRectangles[index];
          return afterRectangle
            ? [
                Math.abs(afterRectangle.x - rectangle.x),
                Math.abs(afterRectangle.y - rectangle.y),
                Math.abs(afterRectangle.width - rectangle.width),
                Math.abs(afterRectangle.height - rectangle.height),
              ]
            : [Number.POSITIVE_INFINITY];
        });
        const maxDelta = Math.max(0, ...deltas);
        const passed =
          beforeRectangles.length === afterRectangles.length &&
          maxDelta <= predicate.tolerancePx;
        return {
          assertion: `Surrounding layout preserved within ${predicate.tolerancePx}px (maximum geometry delta ${maxDelta.toFixed(1)}px).`,
          predicate,
          status: passed ? "passed" : "failed",
        };
      }
    }
  }
}
