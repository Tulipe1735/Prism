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

export interface BrowserExecutorOptions {
  baseUrl: string;
  buildIdentity: string;
  viewport: Viewport;
  executablePath?: string;
  browserType?: Pick<BrowserType<Browser>, "launch">;
  clock?: () => Date;
}

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

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function jsonLine(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
}

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

function localPageUrl(baseUrl: URL, route: string): URL {
  const target = new URL(route, baseUrl);
  if (target.origin !== baseUrl.origin) {
    throw new TypeError(
      "Prism BrowserExecutor refused a route outside the configured local origin.",
    );
  }

  return target;
}

function targetIdentity(target: BrowserCaptureTarget): string {
  const semantic = `role=${target.role}[name=${target.name}]`;
  if (target.kind === "semantic") return semantic;

  const { x, y, width, height } = target.grounding;
  return `${semantic}@${x},${y},${width}x${height}`;
}

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

export class BrowserExecutor {
  private readonly browserType: Pick<BrowserType<Browser>, "launch">;
  private readonly clock: () => Date;
  private readonly baseUrl: URL;

  constructor(private readonly options: BrowserExecutorOptions) {
    this.browserType = options.browserType ?? chromium;
    this.clock = options.clock ?? (() => new Date());
    this.baseUrl = localBaseUrl(options.baseUrl);
  }

  async captureBaseline(input: unknown): Promise<BrowserBaselineCapture> {
    const request = browserBaselineRequestSchema.parse(input);
    const targetUrl = localPageUrl(this.baseUrl, request.route);
    const browser = await this.browserType.launch({
      headless: true,
      executablePath: this.options.executablePath,
    });
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
      const locator = page.getByRole(request.target.role as never, {
        name: request.target.name,
        exact: request.target.exact,
      });
      await locator.waitFor({ state: "visible" });
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
