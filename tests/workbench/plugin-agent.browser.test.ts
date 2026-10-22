import type { CanvasDocument } from "../../plugins/excalidraw/src/scene.ts";
import type { Tool } from "../../src/kernel/tool.ts";
import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { type RunningUiServer, startUiServer } from "../../src/workbench/ui-server.ts";
import { KernelClient } from "../../src/workbench/ui/client.ts";
import {
  type FakeAnswer,
  type KernelHarness,
  startTestKernel,
} from "../kernel/harness.ts";

const enabled =
  process.env.PRISM_WORKBENCH_BROWSER === "1" &&
  existsSync("dist/plugins/excalidraw/bundle.json");

describe.runIf(enabled)("Excalidraw AI through the plugin host bridge", () => {
  let browser: Browser;
  let page: Page;
  let ui: RunningUiServer;
  let harness: KernelHarness;
  let client: KernelClient;
  let sessionId: string;
  const errors: string[] = [];

  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterEach(async (context) => {
    if (context.task.result?.state === "fail" && page !== undefined) {
      await mkdir(".scratch/plugin-agent", { recursive: true });
      await page
        .screenshot({ path: ".scratch/plugin-agent/failure.png" })
        .catch(() => {});
      const frame = page.frameLocator('iframe[data-plugin="excalidraw"]');
      console.log("AI failure state", {
        ui: await frame
          .locator("body")
          .ariaSnapshot()
          .catch(() => "no frame"),
        entries:
          sessionId === undefined ? [] : (await client.readSession(sessionId)).entries,
        requests: harness.model.requests.length,
        errors,
      });
    }
    await page?.close();
    await ui?.close();
    await harness?.cleanup();
  });
  afterAll(async () => browser?.close());

  async function boot(answers: FakeAnswer[], tools: Tool[] = []) {
    errors.length = 0;
    harness = await startTestKernel({
      answers,
      tools,
      bundledPlugins: resolve("dist/plugins"),
      configFile: { creator: { enabled: true } },
    });
    await harness.kernel.kernel.ctx.creator.manage({
      action: "enable",
      name: "excalidraw",
    });
    ui = await startUiServer({
      kernelUrl: harness.kernel.url,
      uiRoot: resolve("dist/workbench-ui"),
    });
    client = new KernelClient({ baseUrl: harness.kernel.url });
    page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(ui.url);
    await page.waitForSelector('[data-kernel-status="ready"]');
    await page.fill("#workspace-input", harness.workspace);
    await page.click('[data-action="use-workspace"]');
    await page.locator(".workspace-heading").hover();
    await page.click('[data-action="new-session"]');
    await page.waitForSelector("#chat-header strong");
    sessionId = (await client.listSessions())[0]!.id;
    await page.fill("#message", "保留主会话未发送的草稿");
    await page.locator('[data-view="plugins"]').click();
    await page
      .locator('[data-action="plugin-open"][data-plugin-panel="excalidraw/canvas"]')
      .click();
    const frame = page.frameLocator('iframe[data-plugin="excalidraw"]');
    await frame.locator(".excalidraw").waitFor();
    await frame.getByRole("button", { name: "画布 AI", exact: true }).click();
    await expect
      .poll(() => frame.locator(".canvas-ai-state").textContent())
      .toContain("已连接 Prism");
    return frame;
  }

  it("puts AI next to the library, sends image/text resources to the harness, updates the real canvas and recovers after disconnect", async () => {
    const frame = await boot([
      { toolCalls: [{ id: "canvas-read", name: "excalidraw_read", arguments: "{}" }] },
      {
        respond: (request) => {
          const last = request.messages.at(-1)!;
          const current = JSON.parse(
            typeof last.content === "string" ? last.content : "{}",
          );
          return {
            toolCalls: [
              {
                id: "canvas-write",
                name: "excalidraw_update",
                arguments: JSON.stringify({
                  revision: current.revision,
                  elements: [
                    {
                      id: "ai-box",
                      type: "rectangle",
                      x: 80,
                      y: 80,
                      width: 240,
                      height: 120,
                      backgroundColor: "#e5dbff",
                    },
                    {
                      id: "ai-label",
                      type: "text",
                      x: 100,
                      y: 115,
                      text: "Prism Harness",
                      fontSize: 24,
                    },
                  ],
                }),
              },
            ],
          };
        },
      },
      { text: ["已通过 Prism harness 更新画布。"] },
    ]);
    const toggle = await frame
      .getByRole("button", { name: "画布 AI", exact: true })
      .boundingBox();
    const library = await frame
      .getByRole("checkbox", { name: "素材库", exact: true })
      .boundingBox({ timeout: 5_000 });
    expect(toggle).not.toBeNull();
    expect(library).not.toBeNull();
    expect(toggle!.x + toggle!.width).toBeLessThanOrEqual(library!.x + 1);
    await frame.locator('input[aria-label="选择画布 AI 附件"]').setInputFiles([
      {
        name: "素材.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
          "base64",
        ),
      },
      {
        name: "要求.md",
        mimeType: "text/markdown",
        buffer: Buffer.from("画一个框。<script>保持为文本</script>"),
      },
    ]);
    await expect.poll(() => frame.locator(".canvas-ai-files li").count()).toBe(2);
    await expect
      .poll(() =>
        frame
          .locator(".canvas-ai-files img")
          .evaluate((node) => "naturalWidth" in node && Number(node.naturalWidth) > 0),
      )
      .toBe(true);
    await frame.locator(".canvas-ai-files summary").click();
    expect(await frame.locator(".canvas-ai-files pre").textContent()).toContain(
      "<script>保持为文本</script>",
    );
    await frame
      .getByRole("textbox", { name: "向画布 AI 提问" })
      .fill("按照附件画出 Prism Harness");
    await frame.getByRole("button", { name: "发送", exact: true }).click();
    await expect
      .poll(() => frame.locator(".canvas-ai-log").textContent())
      .toContain("已通过 Prism harness 更新画布。");
    await expect
      .poll(() => frame.locator("[data-canvas-status]").textContent())
      .toContain("2 个元素");
    const log = await client.readSession(sessionId);
    expect(log.entries[0]).toMatchObject({
      attachments: [{ name: "素材.png" }, { name: "要求.md" }],
    });
    expect(harness.model.requests[0]?.messages).toContainEqual(
      expect.objectContaining({
        role: "user",
        content: expect.arrayContaining([
          expect.objectContaining({ type: "image_url" }),
        ]),
      }),
    );
    expect(await page.inputValue("#message")).toBe("保留主会话未发送的草稿");

    await frame
      .getByRole("textbox", { name: "向画布 AI 提问" })
      .fill("重连时保留的画布草稿");
    await page.context().setOffline(true);
    const port = ui.port;
    await ui.close();
    try {
      await expect
        .poll(() => frame.locator(".canvas-ai-state").textContent(), { timeout: 5_000 })
        .toContain("连接已断开");
      const current = (await client.pluginRequest(
        "excalidraw",
        "canvas.read",
        sessionId,
        {},
      )) as CanvasDocument;
      await client.pluginRequest("excalidraw", "canvas.save", sessionId, {
        revision: current.revision,
        scene: {
          ...current.scene,
          elements: [
            ...current.scene.elements,
            {
              id: "offline",
              type: "text",
              x: 100,
              y: 240,
              text: "离线更新",
              fontSize: 24,
            },
          ],
        },
      });
      ui = await startUiServer({
        port,
        kernelUrl: harness.kernel.url,
        uiRoot: resolve("dist/workbench-ui"),
      });
    } finally {
      await page.context().setOffline(false);
    }
    await expect
      .poll(() => frame.locator(".canvas-ai-state").textContent(), { timeout: 10_000 })
      .toContain("已连接 Prism");
    await expect
      .poll(() => frame.locator("[data-canvas-status]").textContent())
      .toContain("3 个元素");
    expect(
      await frame.getByRole("textbox", { name: "向画布 AI 提问" }).inputValue(),
    ).toBe("重连时保留的画布草稿");
    expect(await page.inputValue("#message")).toBe("保留主会话未发送的草稿");
    await mkdir(".scratch/plugin-agent", { recursive: true });
    await page.screenshot({ path: ".scratch/plugin-agent/excalidraw-ai.png" });
    expect(errors).toEqual([]);
  }, 60_000);

  it("steers the current task, cancels through the harness and rejects an old session identity", async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tool: Tool = {
      name: "pause",
      description: "Controlled task",
      parameters: { type: "object", properties: {} },
      async execute() {
        await gate;
        return { content: "step done" };
      },
    };
    const frame = await boot(
      [
        { toolCalls: [{ id: "pause", name: "pause", arguments: "{}" }] },
        { text: ["补充要求已处理"] },
        { text: ["正在处理新任务"], hold: true },
      ],
      [tool],
    );
    try {
      await frame.getByRole("textbox", { name: "向画布 AI 提问" }).fill("开始画图");
      await frame.getByRole("button", { name: "发送", exact: true }).click();
      await frame
        .getByRole("button", { name: "补充指令", exact: true })
        .waitFor({ timeout: 5_000 });
      await frame.getByRole("textbox", { name: "向画布 AI 提问" }).fill("使用中文标注");
      await frame.getByRole("button", { name: "补充指令", exact: true }).click();
      await expect
        .poll(() => frame.locator(".canvas-ai-log").textContent())
        .toContain("补充指令已排队");
      release();
      await expect
        .poll(() => frame.locator(".canvas-ai-log").textContent())
        .toContain("补充要求已处理");
      expect(harness.model.requests[1]?.messages.at(-1)?.content).toContain(
        "使用中文标注",
      );
      await frame.getByRole("textbox", { name: "向画布 AI 提问" }).fill("此会话的草稿");
      const second = await client.createSession({ workspace: harness.workspace });
      await page
        .locator(`[data-action="open-session"][data-session="${second.id}"]`)
        .click();
      await frame.getByRole("button", { name: "画布 AI", exact: true }).click();
      await expect
        .poll(() => frame.locator(".canvas-ai-state").textContent())
        .toContain("已连接 Prism");
      expect(
        await frame.getByRole("textbox", { name: "向画布 AI 提问" }).inputValue(),
      ).toBe("");
      const refused = await frame.locator("body")
        .evaluate(`new Promise(resolveResult => {
            const receive = event => {
              if (
                event.source !== window.parent ||
                event.data?.prism !== "result" ||
                event.data.id !== 999999
              )
                return;
              window.removeEventListener("message", receive);
              resolveResult(event.data.error?.code ?? "accepted");
            };
            window.addEventListener("message", receive);
            window.parent.postMessage(
              {
                prism: "host.request",
                id: 999999,
                method: "agent.send",
                sessionId: ${JSON.stringify(sessionId)},
                input: { text: "不得发送到旧会话" },
              },
              "*",
            );
          })`);
      expect(refused).toBe("SESSION_CHANGED");
      harness.kernel.kernel.emit({
        type: "message.delta",
        sessionId,
        entryId: "foreign",
        delta: "其他会话的输出",
      });
      expect(await frame.locator(".canvas-ai-log").textContent()).not.toContain(
        "其他会话的输出",
      );
      await frame.getByRole("textbox", { name: "向画布 AI 提问" }).fill("一个新任务");
      await frame.getByRole("button", { name: "发送", exact: true }).click();
      await expect
        .poll(() => frame.locator(".canvas-ai-log").textContent())
        .toContain("正在处理新任务");
      await frame.getByRole("button", { name: "停止画布 AI" }).click();
      await expect
        .poll(() => frame.locator(".canvas-ai-state").textContent())
        .toContain("已连接 Prism");
      expect(harness.kernel.kernel.isRunning(second.id)).toBe(false);
      expect((await client.readSession(sessionId)).entries).not.toContainEqual(
        expect.objectContaining({ content: "不得发送到旧会话" }),
      );
      expect(errors).toEqual([]);
    } finally {
      release();
    }
  }, 60_000);
});
