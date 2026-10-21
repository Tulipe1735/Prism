import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyCanvasScene } from "../../src/shared/canvas.ts";
import { type RunningUiServer, startUiServer } from "../../src/workbench/ui-server.ts";
import { KernelClient } from "../../src/workbench/ui/client.ts";
import { type KernelHarness, startTestKernel } from "../kernel/harness.ts";

const UI_ROOT = resolve("dist/workbench-ui");
/** The CJK serif is by far the largest asset; wait for it before attributing bytes. */
const SLOW_ASSET = "source-han-serif-sc-variable.woff2";
const enabled =
  process.env.PRISM_WORKBENCH_BROWSER === "1" && existsSync(`${UI_ROOT}/app.js`);

interface Transfer {
  name: string;
  bytes: number;
}

describe.runIf(enabled)("lazy canvas", () => {
  let browser: Browser;
  let ui: RunningUiServer;
  let harness: KernelHarness;
  let page: Page;
  let transfers: Transfer[] = [];
  let sessionId: string;
  let client: KernelClient;
  const errors: string[] = [];
  let markSlowAssetDone = (): void => {};

  /** The kernel holds an endless SSE stream open, so `networkidle` never fires. */
  async function settle(): Promise<void> {
    const arrived = new Promise<void>((resolve) => {
      markSlowAssetDone = resolve;
    });
    await Promise.race([arrived, page.waitForTimeout(30_000)]);
    await page.waitForTimeout(500);
  }

  function report(label: string): number {
    const total = transfers.reduce((sum, item) => sum + item.bytes, 0);
    console.log(`${label}: ${(total / 1048576).toFixed(2)} MB`);
    for (const item of [...transfers].sort((a, b) => b.bytes - a.bytes))
      console.log(`  ${(item.bytes / 1024).toFixed(0)} KB ${item.name}`);
    return total;
  }

  const named = (needle: string): Transfer[] =>
    transfers.filter((item) => item.name.includes(needle));

  beforeAll(async () => {
    browser = await chromium.launch();
    harness = await startTestKernel({
      answers: [
        {
          toolCalls: [{ id: "canvas-read", name: "excalidraw_read", arguments: "{}" }],
        },
        {
          respond: (request) => {
            const canvas = JSON.parse(
              [...request.messages]
                .reverse()
                .find((message) => message.role === "tool")!.content!,
            );
            expect(
              canvas.elements.some(
                (element: { text?: string }) => element.text === "手动备注",
              ),
            ).toBe(true);
            return {
              toolCalls: [
                {
                  id: "canvas-edit",
                  name: "excalidraw_update",
                  arguments: JSON.stringify({
                    revision: canvas.revision,
                    elements: [
                      {
                        id: "agent-note",
                        type: "text",
                        text: "Agent 已修改",
                        x: 100,
                        y: 240,
                        fontSize: 24,
                      },
                    ],
                  }),
                },
              ],
            };
          },
        },
        { text: ["已经读取你的手动修改，并补充了画布。"] },
      ],
    });
    ui = await startUiServer({ kernelUrl: harness.kernel.url, uiRoot: UI_ROOT });
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on("pageerror", (error) => errors.push(error.message));
    client = new KernelClient({ baseUrl: harness.kernel.url });
    page.on("response", (response) => {
      const bytes = Number(response.headers()["content-length"] ?? "0");
      const name = response.url().split("/").pop() ?? response.url();
      if (name === SLOW_ASSET) markSlowAssetDone();
      if (bytes > 0) transfers.push({ name, bytes });
    });
  });

  afterAll(async () => {
    await page?.close();
    await ui?.close();
    await harness?.cleanup();
    await browser?.close();
  });

  it("downloads Excalidraw only after the canvas opens", async () => {
    await page.goto(ui.url);
    await page.waitForSelector("#composer");
    await settle();

    report("first load");
    expect(named("canvas-")).toHaveLength(0);
    expect(named("excalidraw.css")).toHaveLength(0);

    await page.fill("#workspace-input", harness.workspace);
    await page.click('[data-action="use-workspace"]');
    await page.locator(".workspace-heading").hover();
    await page.click('[data-action="new-session"]');
    await page.waitForSelector("#chat-header strong");
    sessionId = (await client.listSessions())[0]!.id;

    transfers = [];
    await page.click('[data-action="canvas"]');
    await page.waitForSelector(".excalidraw", { timeout: 30_000 });
    await page.waitForTimeout(1_000);

    report("canvas open");
    expect(named("canvas-").length).toBeGreaterThan(0);
    expect(named("excalidraw.css")).toHaveLength(1);

    // The stylesheet must really be in effect, not merely fetched.
    const width = await page
      .locator(".excalidraw")
      .evaluate((node) => node.getBoundingClientRect().width);
    expect(width).toBeGreaterThan(600);
    // The status line only shows a count once Excalidraw reported its API.
    expect(await page.locator("[data-canvas-status]").textContent()).toContain(
      "个元素",
    );

    await page.screenshot({ path: ".scratch/canvas-open.png" });
  }, 90_000);

  it("autosaves manual drawing, shares it with the agent and exports editable and image files", async () => {
    const scene = {
      ...emptyCanvasScene(),
      elements: [
        {
          id: "box",
          type: "rectangle",
          x: 70,
          y: 70,
          width: 260,
          height: 120,
          backgroundColor: "#d0ebff",
        },
        { id: "label", type: "text", x: 100, y: 110, text: "会话画布", fontSize: 28 },
      ],
    };
    await page.locator('input[aria-label="导入画布文件"]').setInputFiles({
      name: "演示.excalidraw",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(scene)),
    });
    await expect
      .poll(async () => (await client.readCanvas(sessionId)).scene.elements.length)
      .toBe(2);
    // Draw text through Excalidraw's real keyboard and pointer interactions.
    await page.locator(".excalidraw").click({ position: { x: 350, y: 260 } });
    await page.keyboard.press("t");
    await page.locator(".excalidraw").click({ position: { x: 300, y: 300 } });
    await page.waitForSelector("textarea.excalidraw-wysiwyg");
    await page.keyboard.type("手动备注");
    await page.keyboard.press("Escape");
    await expect
      .poll(async () =>
        (await client.readCanvas(sessionId)).scene.elements.some(
          (element) => element.text === "手动备注",
        ),
      )
      .toBe(true);
    await expect
      .poll(() => page.locator("[data-canvas-status]").getAttribute("data-save-state"))
      .toBe("saved");
    await page.getByRole("button", { name: "关闭画板", exact: true }).click();
    expect(await page.locator("#canvas").isVisible()).toBe(false);
    await page.click('[data-action="canvas"]');
    expect(await page.locator("[data-canvas-status]").textContent()).toContain(
      "3 个元素",
    );

    await page.fill("#message", "读取画布，然后补充一条 Agent 备注。");
    await page.click("#send");
    await expect
      .poll(async () =>
        (await client.readCanvas(sessionId)).scene.elements.some(
          (element) => element.id === "agent-note",
        ),
      )
      .toBe(true);
    await expect
      .poll(() => page.locator("[data-canvas-status]").textContent())
      .toContain("4 个元素");

    for (const format of [".excalidraw", "SVG", "PNG"]) {
      const downloaded = page.waitForEvent("download");
      await page.getByRole("button", { name: format, exact: true }).click();
      const file = await downloaded;
      const content = await readFile((await file.path())!);
      if (format === ".excalidraw")
        expect(JSON.parse(content.toString()).elements).toEqual(
          expect.arrayContaining([expect.objectContaining({ text: "手动备注" })]),
        );
      else if (format === "SVG") expect(content.toString()).toContain("<svg");
      else
        expect(content.subarray(0, 8)).toEqual(
          Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        );
    }
    await page.reload();
    await page.click(`[data-action="open-session"][data-session="${sessionId}"]`);
    await page.click('[data-action="canvas"]');
    await expect
      .poll(() => page.locator("[data-canvas-status]").textContent())
      .toContain("4 个元素");
    await page.screenshot({ path: ".scratch/canvas-agent.png" });
    expect(errors).toEqual([]);
  }, 60_000);
});
