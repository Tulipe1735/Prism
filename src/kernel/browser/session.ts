import type { BrowserContext, Page } from "playwright";
import type { Snapshot, SnapshotAction } from "../../shared/types.ts";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const READ_STATE = readFileSync(
  new URL("../../browser/snapshot.js", import.meta.url),
  "utf8",
);

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

/**
 * One page under Playwright control. Observation, freshness and input semantics
 * live here; receipts and target references live in the tool layer.
 */
export interface Observation extends Snapshot {
  fingerprint: string;
}

export interface BrowserPage {
  observe: () => Promise<Observation>;
  /** Raw in-page evaluation for observation samples; navigation reads as stale. */
  evaluate: (expression: string) => Promise<unknown>;
  /** Apply the page's settling/retry policy around a caller's coherent sample. */
  readObservation: <T>(read: () => Promise<T>) => Promise<T>;
  fresh: (snapshot: Observation, action?: SnapshotAction) => Promise<boolean>;
  samePage: (snapshot: Observation) => Promise<boolean>;
  act: (action: SnapshotAction, snapshot: Observation, text?: string | null) => Promise<void>;
  close: () => Promise<void>;
}

export interface OpenSessionOptions {
  context: BrowserContext;
  url: string;
}

export class StalePageError extends Error {
  override name = "StalePageError";
}

export class ExecutionError extends Error {
  override name = "ExecutionError";
}

export async function openBrowserSession(
  options: OpenSessionOptions,
): Promise<BrowserSession> {
  return BrowserSession.open(options);
}

export class BrowserSession implements BrowserPage {
  private afterInput: SnapshotAction | null = null;
  private readonly page: Page;
  private closed = false;

  private constructor(page: Page) {
    this.page = page;
  }

  static async open(options: OpenSessionOptions): Promise<BrowserSession> {
    const session = new BrowserSession(await options.context.newPage());
    // The page's own error content is evidence for the caller; a slow or failed
    // top-level navigation must not throw away the usable browser session.
    await session.page
      .goto(options.url, { waitUntil: "load", timeout: 15_000 })
      .catch(() => undefined);
    return session;
  }

  async observe(): Promise<Observation> {
    return this.readObservation(async () => this.observeOnce());
  }

  /** Apply the same settling/retry policy to a caller's single coherent sample. */
  async readObservation<T>(read: () => Promise<T>): Promise<T> {
    if (this.afterInput !== null) {
      const action = this.afterInput;
      this.afterInput = null;
      // Read-only and after execution was logged, even if navigation interrupts it.
      // Autocomplete dropdowns need a moment; every other input settles in two frames.
      const autocomplete = action.kind === "fill" && action.role === "combobox";
      await sleep(autocomplete ? 200 : 50);
    }

    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        return await read();
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

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    // The tab may already be gone; nothing left to close.
    await this.page.close().catch(() => undefined);
  }

  private async observeOnce(): Promise<Observation> {
    const info = (await this.evaluate(READ_STATE)) as Snapshot | null | undefined;
    if (info === null || info === undefined)
      throw new StalePageError("Document is navigating");
    return { ...info, fingerprint: fingerprint(info) };
  }

  private async execute(action: SnapshotAction, text: string | null): Promise<void> {
    const kind = action.kind;
    if (kind === "scroll") {
      await this.page.mouse.move(550, 650);
      await this.page.mouse.wheel(0, action.delta ?? 0);
      return;
    }

    const node = action.node;
    if (typeof node !== "number") throw new ExecutionError("Invalid observed node");
    // Code-owned node ids refer to actual observed elements, never model-generated selectors.
    let target: { x: number; y: number } | null;
    try {
      target = (await this.page.evaluate(
        `${RESOLVE_TARGET}(${JSON.stringify(action)})`,
      )) as { x: number; y: number } | null;
    } catch {
      if (kind === "select")
        throw new ExecutionError(
          "Dropdown execution was interrupted; inspect before retrying.",
        );
      throw new StalePageError("Document changed during evaluation");
    }
    if (target === null || target === undefined) {
      if (kind === "select")
        throw new ExecutionError(
          "Dropdown execution was not confirmed; inspect before retrying.",
        );
      throw new StalePageError("Target changed or is covered. Observe again.");
    }
    if (kind === "select") return;

    const { x, y } = target;
    await this.page.mouse.click(x, y);
    if (kind === "fill") {
      await this.page.keyboard.press("ControlOrMeta+a");
      await this.page.keyboard.insertText(text ?? "");
    }
  }

  /** Page-side evaluation maps to a stale page; a closed browser stays a hard error. */
  async evaluate(expression: string): Promise<unknown> {
    try {
      return await this.page.evaluate(expression);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (/has been closed|Target closed|Browser has been closed|disconnected/i.test(detail))
        throw error;
      throw new StalePageError(detail);
    }
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
