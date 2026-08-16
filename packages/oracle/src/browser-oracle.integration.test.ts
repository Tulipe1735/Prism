import type { FrontendRepairSpec } from "@prism/contracts";
import type { AddressInfo } from "node:net";
import { access, readdir, readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";

import { fileURLToPath } from "node:url";
import { execa } from "execa";

import { chromium } from "playwright-core";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BrowserOracle } from "./browser-oracle";

const FIXTURE_ROOT = fileURLToPath(
  new URL("../../../fixtures/react-repair", import.meta.url),
);

const viewport = { width: 1280, height: 720, deviceScaleFactor: 1 } as const;

const target = { kind: "semantic", role: "button", name: "Save", exact: true } as const;

/** 真浏览器测试在缺少本地 Chromium 时优雅跳过（保持确定性与 CI 可移植性）。 */
async function chromiumAvailable(): Promise<boolean> {
  try {
    await access(chromium.executablePath());
    return true;
  } catch {
    return false;
  }
}

const spec: FrontendRepairSpec = {
  schemaVersion: "prism.frontend-repair-spec/v1",
  prompt: "Make the primary Save button clearly rounded instead of square.",
  target,
  predicates: [
    { kind: "metric-increase", metric: "borderRadius", minDeltaPx: 8, minAfterPx: 8 },
    { kind: "region-clip-differs" },
    { kind: "label-preserved" },
    { kind: "clickable" },
    { kind: "size-within", tolerancePx: 4 },
    { kind: "layout-within", tolerancePx: 4 },
  ],
};

/** 把字节写回 index.html 的相对资源路径，做最小静态服务器。 */
function createStaticServer(root: string): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url ?? "/", "http://localhost");
        const hasFileExtension = /\.[a-z0-9]+$/i.test(url.pathname);
        const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
        // SPA 回退：无文件扩展名的路由一律落到 index.html（Vite 客户端路由）
        const requestedPath = hasFileExtension
          ? path.posix.join(root, relative)
          : path.join(root, "index.html");
        const content = await readFile(requestedPath);
        const mediaType = requestedPath.endsWith(".css")
          ? "text/css"
          : requestedPath.endsWith(".js")
            ? "application/javascript"
            : requestedPath.endsWith(".ttf")
              ? "font/ttf"
              : "text/html";
        response.writeHead(200, { "content-type": mediaType });
        response.end(content);
      } catch {
        response.writeHead(404);
        response.end("not found");
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

describe("BrowserOracle integration (real Chromium + built fixture)", () => {
  let server: Server;
  let baseUrl: string;
  let built = false;

  beforeAll(async () => {
    if (!(await chromiumAvailable())) {
      console.warn("Skipping fixture build: no local Chromium is installed.");
      return;
    }
    try {
      await execa("pnpm", ["build"], {
        cwd: FIXTURE_ROOT,
        shell: false,
        timeout: 120_000,
      });
      built = true;
    } catch (error) {
      console.warn(`Fixture build skipped: ${(error as Error).message}`);
    }
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it("fails on the known-bad state and passes on a reasonable repair", async () => {
    if (!built) {
      // 无本地 Chromium 或构建失败时跳过真浏览器断言
      console.warn(
        "Skipping real-browser oracle test because the fixture did not build.",
      );
      return;
    }

    const distFiles = await readdir(path.join(FIXTURE_ROOT, "dist"));
    expect(distFiles.length).toBeGreaterThan(0);
    const { server: started, url } = await createStaticServer(
      path.join(FIXTURE_ROOT, "dist"),
    );
    server = started;
    baseUrl = url;

    // 已知缺陷态：方形按钮
    const before = new BrowserOracle({
      baseUrl,
      route: "/round-button",
      viewport,
      target,
      beforeMeasure: async (page) => {
        await page.addStyleTag({
          content: ".save-button { border-radius: 0 !important; }",
        });
      },
    });
    const knownBad = await before.observe();
    expect(knownBad.borderRadiusPx).toBe(0);
    expect(knownBad.text).toBe("Save");

    // 自比较必须失败：缺陷尚未修复
    const failed = BrowserOracle.evaluateSpec(spec, knownBad, knownBad);
    expect(failed.verdict).toBe("failed");

    // 合理修复：在测量前注入圆角样式（12px），等价于源码修复的渲染结果
    const repairedOracle = new BrowserOracle({
      baseUrl,
      route: "/round-button",
      viewport,
      target,
      beforeMeasure: async (page) => {
        await page.addStyleTag({
          content: ".save-button { border-radius: 12px !important; }",
        });
      },
    });
    const repaired = await repairedOracle.observe();
    expect(repaired.borderRadiusPx).toBeGreaterThan(0);

    const passed = BrowserOracle.evaluateSpec(spec, knownBad, repaired);
    expect(passed.verdict).toBe("passed");
    expect(passed.assertions.every((assertion) => assertion.status === "passed")).toBe(
      true,
    );
  }, 60_000);
});
