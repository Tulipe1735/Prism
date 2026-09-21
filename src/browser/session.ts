import type { Snapshot, SnapshotAction } from "../types.ts";
import type { CdpClient } from "./connect.ts";
import { createHash } from "node:crypto";

import { readFileSync } from "node:fs";
import process from "node:process";

const READ_STATE = readFileSync(new URL("./snapshot.js", import.meta.url), "utf8");

const RESOLVE_TARGET = `(action => {
  const e=window.__jevFast?.nodes.get(action.node);
  if (!e?.isConnected || e.matches(':disabled') || e.closest('[aria-disabled="true"],[inert]') ||
      !e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})) return null;
  if (action.kind==='fill' && (e.readOnly || e.getAttribute('aria-readonly')==='true')) return null;
  const r=e.getBoundingClientRect(), x=r.x+r.width/2, y=r.y+r.height/2;
  if (!r.width || !r.height || x<0 || y<0 || x>=innerWidth || y>=innerHeight) return null;
  if (!e.contains(document.elementFromPoint(x,y))) return null;
  if (action.kind==='select') {
    if (e.tagName!=='SELECT' || ![...e.options].some(o=>o.value===action.value &&
        !o.disabled && !o.closest('optgroup[disabled]'))) return null;
    e.value=action.value;
    e.dispatchEvent(new Event('input',{bubbles:true}));
    e.dispatchEvent(new Event('change',{bubbles:true}));
  }
  return {x,y};
})`;

export class StalePageError extends Error {
  override name = "StalePageError";
}

export class ExecutionError extends Error {
  override name = "ExecutionError";
}

export interface Observation extends Snapshot {
  fingerprint: string;
  screenshot?: string;
}

export interface OpenSessionOptions {
  url: string;
  client: CdpClient;
}

export async function openBrowserSession(
  options: OpenSessionOptions,
): Promise<BrowserSession> {
  return BrowserSession.open(options);
}

export class BrowserSession {
  private afterInput: SnapshotAction | null = null;
  private targetId: string | null;
  private readonly client: CdpClient;
  private readonly sessionId: string;

  constructor(client: CdpClient, targetId: string, sessionId: string) {
    this.client = client;
    this.targetId = targetId;
    this.sessionId = sessionId;
  }

  static async open(options: OpenSessionOptions): Promise<BrowserSession> {
    const { client } = options;
    const created = await client.send("Target.createTarget", {
      url: "about:blank",
      background: true,
    });
    const targetId = created.targetId as string;
    const attached = await client.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    const session = new BrowserSession(client, targetId, attached.sessionId as string);

    await session.call("Emulation.setDeviceMetricsOverride", {
      width: 1120,
      height: 780,
      deviceScaleFactor: 1,
      mobile: false,
    });
    // Keep rAF/menus rendering in an owned background tab without activating the user's tab.
    await session.call("Emulation.setFocusEmulationEnabled", { enabled: true });
    await session.call("Page.navigate", { url: options.url });

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if ((await session.evaluate("document.readyState")) === "complete") break;
      await sleep(20);
    }
    return session;
  }

  call(method: string, params?: object): Promise<any> {
    return this.client.send(method, params, this.sessionId);
  }

  async observe(options: { screenshot?: boolean } = {}): Promise<Observation> {
    if (this.afterInput !== null) {
      const action = this.afterInput;
      this.afterInput = null;
      // Read-only and after execution was logged, even if navigation interrupts it.
      // Background tabs throttle page timers and rAF, so wait from Node instead of the page:
      // autocomplete dropdowns need a moment; every other input settles within two frames.
      const autocomplete = action.kind === "fill" && action.role === "combobox";
      await sleep(autocomplete ? 200 : 50);
    }

    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        return await this.observeOnce(options.screenshot ?? false);
      } catch (error) {
        if (!(error instanceof StalePageError) || attempt === 9) throw error;
        await sleep(20);
      }
    }
    throw new StalePageError("Page did not settle");
  }

  async fresh(snapshot: Observation, action?: SnapshotAction): Promise<boolean> {
    if (action !== undefined) {
      if (action.kind === "wait" || action.kind === "scroll") return true;
      const node = action.node;
      if (typeof node !== "number") return false;
      // Target-scoped freshness: identity, label, and state must match, but live
      // pages may keep updating text around the element. execute() re-checks
      // connectivity, geometry, and occlusion immediately before input.
      const current = await this.evaluate(
        `(() => { const c=window.__jevFast; return c ? c.guard(c.nodes.get(${node})) : null; })()`,
      );
      return (
        JSON.stringify(comparableGuard(current)) ===
        JSON.stringify(comparableGuard(snapshot.guards[String(node)]))
      );
    }
    return this.samePage(snapshot);
  }

  /** Decision-level freshness: same document and URL, even if content keeps changing. */
  async samePage(snapshot: Observation): Promise<boolean> {
    const marker = Array.isArray(snapshot.marker) ? snapshot.marker : null;
    const current = (await this.evaluate(
      "(() => [performance.timeOrigin, location.href])()",
    )) as [number, string] | null;
    if (current === null || !Array.isArray(current)) return false;
    if (current[1] !== snapshot.url) return false;
    return marker === null || current[0] === marker[0];
  }

  async act(
    action: SnapshotAction,
    snapshot: Observation,
    text?: string | null,
  ): Promise<void> {
    if (!(await this.fresh(snapshot, action))) {
      throw new StalePageError("Page changed since this decision. Observe again.");
    }
    if (action.kind === "wait") {
      await sleep(100);
    } else {
      await this.execute(action, text ?? null);
    }
    this.afterInput = action.kind === "wait" ? null : action;
  }

  /**
   * Best-effort frame capture. Background tabs can throttle rendering so the
   * browser sometimes never answers Page.captureScreenshot; bound the wait and
   * let callers continue without the image.
   */
  async captureScreenshot(): Promise<string | undefined> {
    const capture = this.call("Page.captureScreenshot", {
      format: "jpeg",
      quality: 72,
    }).then((result) => result.data as string);
    capture.catch(() => {});
    return withTimeout(capture, 2_000);
  }

  async close(): Promise<void> {
    if (this.targetId !== null) {
      const targetId = this.targetId;
      this.targetId = null;
      try {
        await this.client.send("Target.closeTarget", { targetId });
      } catch {
        // The tab is already gone; nothing left to close.
      }
    }
  }

  private async observeOnce(screenshot: boolean): Promise<Observation> {
    const info = (await this.evaluate(READ_STATE)) as Snapshot | null | undefined;
    if (info === null || info === undefined)
      throw new StalePageError("Document is navigating");
    const observation: Observation = { ...info, fingerprint: fingerprint(info) };
    if (screenshot) {
      const image = await this.captureScreenshot();
      if (image !== undefined) observation.screenshot = image;
    }
    return observation;
  }

  private async execute(action: SnapshotAction, text: string | null): Promise<void> {
    const kind = action.kind;
    if (kind === "scroll") {
      await this.call("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: 550,
        y: 650,
        deltaX: 0,
        deltaY: action.delta ?? 0,
      });
      return;
    }

    const node = action.node;
    if (typeof node !== "number") throw new ExecutionError("Invalid observed node");
    // Code-owned node ids refer to actual observed elements, never model-generated selectors.
    const response = await this.call("Runtime.evaluate", {
      expression: `${RESOLVE_TARGET}(${JSON.stringify(action)})`,
      returnByValue: true,
    });
    if (response?.exceptionDetails) {
      if (kind === "select") {
        throw new ExecutionError(
          "Dropdown execution was interrupted; inspect before retrying.",
        );
      }
      throw new StalePageError("Document changed during evaluation");
    }

    const target = response?.result?.value as
      { x: number; y: number } | null | undefined;
    if (target === null || target === undefined) {
      if (kind === "select") {
        throw new ExecutionError(
          "Dropdown execution was not confirmed; inspect before retrying.",
        );
      }
      throw new StalePageError("Target changed or is covered. Observe again.");
    }
    if (kind === "select") return;

    const { x, y } = target;
    for (const type of ["mousePressed", "mouseReleased"]) {
      await this.call("Input.dispatchMouseEvent", {
        type,
        x,
        y,
        button: "left",
        clickCount: 1,
      });
    }
    if (kind === "fill") {
      const modifiers = process.platform === "darwin" ? 4 : 2;
      await this.call("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "a",
        code: "KeyA",
        modifiers,
        commands: ["selectAll"],
      });
      await this.call("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "a",
        code: "KeyA",
        modifiers,
      });
      await this.call("Input.insertText", { text: text ?? "" });
    }
  }

  private async runtimeEvaluate(
    expression: string,
    awaitPromise: boolean,
  ): Promise<{ exceptionDetails: unknown; value: unknown }> {
    const response = await this.call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      ...(awaitPromise ? { awaitPromise: true } : {}),
    });
    return {
      exceptionDetails: response?.exceptionDetails,
      value: response?.result?.value,
    };
  }

  private async evaluate(expression: string): Promise<unknown> {
    const { exceptionDetails, value } = await this.runtimeEvaluate(expression, false);
    if (exceptionDetails)
      throw new StalePageError("Document changed during evaluation");
    return value;
  }
}

/** Drop the surrounding-context text; live dashboards rewrite it constantly. */
function comparableGuard(guard: unknown): unknown {
  return Array.isArray(guard) ? guard.slice(0, -1) : guard;
}

function fingerprint(state: Snapshot): string {
  const content = {
    url: state.url,
    text: state.text,
    actions: state.actions,
    scroll: state.scroll,
  };
  return createHash("sha256").update(stableStringify(content)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
