import type {
  Browser,
  BrowserContext,
  BrowserType,
  Page,
  Route,
} from "playwright-core";

import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

import { BrowserExecutor } from "./browser-executor";

const viewport = { width: 1280, height: 720, deviceScaleFactor: 1 } as const;

describe("BrowserExecutor", () => {
  it("captures a local baseline while blocking off-origin browser requests", async () => {
    let interceptedRequest: ((route: Route) => Promise<void>) | undefined;
    const locator = {
      ariaSnapshot: async () => '- button "Save"',
      evaluate: async () => ({
        rectangle: { x: 40, y: 20, width: 120, height: 44 },
        parentRectangle: { x: 0, y: 0, width: 1280, height: 720 },
        siblingRectangles: [{ x: 40, y: 80, width: 120, height: 20 }],
        styles: {
          display: "block",
          visibility: "visible",
          opacity: "1",
          pointerEvents: "auto",
          boxShadow: "none",
        },
      }),
      waitFor: async () => undefined,
    };
    const page = {
      content: async () => "<button>Save</button>",
      evaluate: async () => ({
        documentTitle: "Fixture",
        readyState: "complete",
        scrollX: 0,
        scrollY: 0,
        bodyText: "Save",
      }),
      getByRole: () => locator,
      goto: async () => null,
      on: () => page,
      screenshot: async () => Buffer.from("screenshot", "utf8"),
      url: () => "http://127.0.0.1:4173/settings/profile",
    } as unknown as Page;
    const context = {
      close: async () => undefined,
      newPage: async () => page,
      route: async (_url: string, handler: (route: Route) => Promise<void>) => {
        interceptedRequest = handler;
      },
      tracing: {
        start: async () => undefined,
        stop: async ({ path }: { path?: string }) => {
          if (!path) throw new Error("Trace output path is required.");
          await writeFile(path, "trace", "utf8");
        },
      },
    } as unknown as BrowserContext;
    const browser = {
      close: async () => undefined,
      newContext: async () => context,
      version: () => "142.0.0.0",
    } as unknown as Browser;
    const browserType = {
      launch: async () => browser,
    } as Pick<BrowserType<Browser>, "launch">;
    const executor = new BrowserExecutor({
      baseUrl: "http://127.0.0.1:4173",
      browserType,
      buildIdentity: "fixture@5a6c2ab",
      clock: () => new Date("2026-08-04T04:00:00.000Z"),
      viewport,
    });

    const capture = await executor.captureBaseline({
      schemaVersion: "prism.browser-baseline-request/v1",
      requestId: "42ee0dfc-a713-49b9-bc60-8c72cced2a24",
      runId: "run_6dbf6f33-69c4-4e5f-9898-3f693735f5f0",
      route: "/settings/profile",
      target: { kind: "semantic", role: "button", name: "Save", exact: true },
    });

    expect(capture.baseline).toMatchObject({
      buildIdentity: "fixture@5a6c2ab",
      route: "/settings/profile",
      targetIdentity: "role=button[name=Save]",
    });
    expect(capture.artifacts.trace.toString("utf8")).toBe("trace");
    expect(JSON.parse(capture.artifacts.computed.toString("utf8"))).toMatchObject({
      parentRectangle: { width: 1280, height: 720 },
      siblingRectangles: [{ width: 120, height: 20 }],
      styles: { boxShadow: "none" },
    });
    expect(interceptedRequest).toEqual(expect.any(Function));

    const abort = vi.fn(async () => undefined);
    const continueRequest = vi.fn(async () => undefined);
    await interceptedRequest?.({
      abort,
      continue: continueRequest,
      request: () => ({ url: () => "https://untrusted.example/exfiltrate" }),
    } as unknown as Route);

    expect(abort).toHaveBeenCalledTimes(1);
    expect(continueRequest).not.toHaveBeenCalled();

    const localWriteAbort = vi.fn(async () => undefined);
    const localWriteContinue = vi.fn(async () => undefined);
    await interceptedRequest?.({
      abort: localWriteAbort,
      continue: localWriteContinue,
      request: () => ({
        method: () => "POST",
        url: () => "http://127.0.0.1:4173/settings/profile",
      }),
    } as unknown as Route);

    expect(localWriteAbort).toHaveBeenCalledTimes(1);

    const localReadAbort = vi.fn(async () => undefined);
    const localReadContinue = vi.fn(async () => undefined);
    await interceptedRequest?.({
      abort: localReadAbort,
      continue: localReadContinue,
      request: () => ({
        method: () => "GET",
        url: () => "http://127.0.0.1:4173/settings/profile",
      }),
    } as unknown as Route);

    expect(localReadAbort).not.toHaveBeenCalled();
  });
});
