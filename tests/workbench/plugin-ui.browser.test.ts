import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UI_SLOTS, type UiSlot } from "../../packages/plugin-sdk/src/index.ts";
import { emptyCanvasScene } from "../../plugins/excalidraw/src/scene.ts";
import { type RunningUiServer, startUiServer } from "../../src/workbench/ui-server.ts";
import { KernelClient } from "../../src/workbench/ui/client.ts";
import { pluginBundle } from "../fixtures/plugin.ts";
import { type KernelHarness, startTestKernel } from "../kernel/harness.ts";

const enabled =
  process.env.PRISM_WORKBENCH_BROWSER === "1" &&
  existsSync("dist/plugins/excalidraw/bundle.json");

describe.runIf(enabled)("standard plugin UI in the unmodified host", () => {
  let browser: Browser;
  let page: Page;
  let harness: KernelHarness;
  let ui: RunningUiServer;
  let client: KernelClient;
  let sessionId: string;
  const errors: string[] = [];
  const missing: string[] = [];
  const assets: string[] = [];

  beforeAll(async () => {
    browser = await chromium.launch();
    harness = await startTestKernel({
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
    page.on("response", (response) => {
      if (response.url().includes("/plugins/") && response.url().includes("/assets/")) {
        assets.push(response.url());
        if (response.status() >= 400) missing.push(response.url());
      }
    });
    await mkdir(".scratch/plugin-bundles", { recursive: true });
    await page.goto(ui.url);
    await page.waitForSelector('[data-kernel-status="ready"]');
    await page.fill("#workspace-input", harness.workspace);
    await page.click('[data-action="use-workspace"]');
    await page.locator(".workspace-heading").hover();
    await page.click('[data-action="new-session"]');
    await page.waitForSelector("#chat-header strong");
    sessionId = (await client.listSessions())[0]!.id;
  });

  afterAll(async () => {
    await page?.close();
    await ui?.close();
    await harness?.cleanup();
    await browser?.close();
  });

  it("loads Excalidraw on demand, saves imported and manually drawn elements, exports all formats and survives reopening", async () => {
    expect(assets).toEqual([]);
    await page.getByRole("button", { name: "Excalidraw", exact: true }).click();
    await page.getByRole("button", { name: "放大", exact: true }).click();
    const frame = page.frameLocator('iframe[data-plugin="excalidraw"]');
    await frame.locator(".excalidraw").waitFor();
    await expect
      .poll(() => frame.locator("[data-canvas-status]").textContent())
      .toContain("个元素");
    expect(assets.some((url) => url.endsWith("excalidraw.css"))).toBe(true);
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
    await frame.locator('input[aria-label="导入画布文件"]').setInputFiles({
      name: "演示.excalidraw",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(scene)),
    });
    const read = () =>
      client.pluginRequest("excalidraw", "canvas.read", sessionId, {}) as Promise<{
        revision: number;
        scene: typeof scene;
      }>;
    await expect.poll(async () => (await read()).scene.elements.length).toBe(2);
    await frame.locator(".excalidraw").click({ position: { x: 350, y: 260 } });
    await page.keyboard.press("t");
    await frame.locator(".excalidraw").click({ position: { x: 550, y: 500 } });
    await frame.locator("textarea.excalidraw-wysiwyg").waitFor();
    await page.keyboard.type("手动备注");
    await page.keyboard.press("Escape");
    await expect
      .poll(async () =>
        (await read()).scene.elements.some((element) => element.text === "手动备注"),
      )
      .toBe(true);
    const current = await read();
    await client.pluginRequest("excalidraw", "canvas.save", sessionId, {
      revision: current.revision,
      scene: {
        ...current.scene,
        elements: [
          ...current.scene.elements,
          {
            id: "agent",
            type: "text",
            x: 100,
            y: 240,
            text: "插件 RPC 更新",
            fontSize: 24,
          },
        ],
      },
    });
    await expect
      .poll(() => frame.locator("[data-canvas-status]").textContent())
      .toContain("4 个元素");
    const second = await client.createSession({
      workspace: harness.workspace,
      title: "Second canvas",
    });
    await page.getByRole("button", { name: "还原", exact: true }).click();
    await page.click(`[data-action="open-session"][data-session="${second.id}"]`);
    await expect
      .poll(() => frame.locator("[data-canvas-status]").textContent())
      .toContain("0 个元素");
    const refused = await frame.locator("body").evaluate(`new Promise(resolve => {
      const id = 999999;
      const receive = event => {
        if (event.source === window.parent && event.data?.prism === 'result' && event.data.id === id) {
          window.removeEventListener('message', receive);
          resolve(String(event.data.error?.code));
        }
      };
      window.addEventListener('message', receive);
      window.parent.postMessage({prism:'request', id, method:'canvas.save', sessionId:${JSON.stringify(sessionId)}, input:{revision:0}}, '*');
    })`);
    expect(refused).toBe("SESSION_CHANGED");
    expect(
      await client.pluginRequest("excalidraw", "canvas.read", second.id, {}),
    ).toMatchObject({ revision: 0, scene: { elements: [] } });
    await page.click(`[data-action="open-session"][data-session="${sessionId}"]`);
    await expect
      .poll(() => frame.locator("[data-canvas-status]").textContent())
      .toContain("4 个元素");
    await page.getByRole("button", { name: "放大", exact: true }).click();
    for (const format of [".excalidraw", "SVG", "PNG"]) {
      const download = page.waitForEvent("download", { timeout: 20_000 });
      await frame.getByRole("button", { name: format, exact: true }).click();
      const file = await download;
      const content = await readFile((await file.path())!);
      if (format === ".excalidraw")
        expect(JSON.parse(content.toString()).elements).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ text: "手动备注" }),
            expect.objectContaining({ id: "agent" }),
          ]),
        );
      else if (format === "SVG") expect(content.toString()).toContain("<svg");
      else
        expect(content.subarray(0, 8)).toEqual(
          Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        );
    }
    await page.screenshot({ path: ".scratch/plugin-bundles/excalidraw.png" });
    await page.getByRole("button", { name: "关闭插件面板" }).click();
    await page.getByRole("button", { name: "Excalidraw", exact: true }).click();
    await expect
      .poll(() => frame.locator("[data-canvas-status]").textContent())
      .toContain("4 个元素");
    expect(errors).toEqual([]);
    expect(missing).toEqual([]);
  }, 90_000);

  it("keeps a conflicting draft and exports it before reading the newer scene", async () => {
    const frame = page.frameLocator('iframe[data-plugin="excalidraw"]');
    await expect
      .poll(() => frame.locator("[data-canvas-status]").getAttribute("data-save-state"))
      .toBe("saved");
    let release = (): void => {};
    let arrived = (): void => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const received = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    let intercept = true;
    await page.route("**/kernel/plugins/excalidraw/rpc/canvas.save", async (route) => {
      if (intercept) {
        intercept = false;
        arrived();
        await hold;
      }
      await route.continue();
    });
    try {
      const current = (await client.pluginRequest(
        "excalidraw",
        "canvas.read",
        sessionId,
        {},
      )) as { revision: number; scene: ReturnType<typeof emptyCanvasScene> };
      const draft = {
        ...current.scene,
        elements: current.scene.elements.map((element) =>
          element.id === "label"
            ? { ...element, text: "本地草稿", originalText: "本地草稿" }
            : element,
        ),
      };
      await frame.locator('input[aria-label="导入画布文件"]').setInputFiles({
        name: "草稿.excalidraw",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(draft)),
      });
      await received;
      await client.pluginRequest("excalidraw", "canvas.save", sessionId, {
        revision: current.revision,
        scene: { ...current.scene, appState: { viewBackgroundColor: "#eeeeee" } },
      });
      release();
      await expect
        .poll(() =>
          frame.locator("[data-canvas-status]").getAttribute("data-save-state"),
        )
        .toBe("conflict");
      const downloaded = page.waitForEvent("download");
      await frame.getByRole("button", { name: "导出当前草稿并读取最新画布" }).click();
      const file = await downloaded;
      expect(JSON.parse(await readFile((await file.path())!, "utf8")).elements).toEqual(
        expect.arrayContaining([expect.objectContaining({ text: "本地草稿" })]),
      );
      await expect
        .poll(() =>
          frame.locator("[data-canvas-status]").getAttribute("data-save-state"),
        )
        .toBe("saved");
    } finally {
      release();
      await page.unrouteAll({ behavior: "wait" });
    }
  });

  it("adds and hot-reloads another UI bundle while the host frontend stays byte-identical", async () => {
    await page.getByRole("button", { name: "关闭插件面板" }).click();
    const host = await readFile("dist/workbench-ui/app.js");
    const directory = join(harness.workspace, "new-ui-plugin");
    await mkdir(directory);
    const bundle = pluginBundle("export function apply() {}", "independent-ui");
    bundle.manifest.ui = [
      { id: "view", title: "Independent UI", slot: "workbench.panel", entry: "ui.ts" },
    ];
    await writeFile(
      join(directory, "prism.plugin.json"),
      JSON.stringify(bundle.manifest),
    );
    await writeFile(join(directory, "index.ts"), bundle.files["index.ts"]!);
    await writeFile(
      join(directory, "ui.ts"),
      "import { message } from './message.ts'; document.body.textContent=message;",
    );
    await writeFile(
      join(directory, "message.ts"),
      "export const message='UI version one';",
    );
    const manager = harness.kernel.kernel.ctx.creator;
    await manager.manage({ action: "develop", directory });
    await manager.manage({ action: "enable", name: "independent-ui" });
    await page.getByRole("button", { name: "Independent UI", exact: true }).click();
    const frame = page.frameLocator('iframe[data-plugin="independent-ui"]');
    await expect
      .poll(() => frame.locator("body").textContent())
      .toContain("UI version one");
    await writeFile(
      join(directory, "message.ts"),
      "export const message='UI version two';",
    );
    await expect
      .poll(() => frame.locator("body").textContent())
      .toContain("UI version two");
    await writeFile(join(directory, "message.ts"), "export const message = ;");
    await expect
      .poll(
        () => manager.list().find((plugin) => plugin.name === "independent-ui")?.error,
      )
      .toBeDefined();
    expect(await frame.locator("body").textContent()).toContain("UI version two");
    await writeFile(
      join(directory, "message.ts"),
      "export const message='UI recovered';",
    );
    await expect
      .poll(() => frame.locator("body").textContent())
      .toContain("UI recovered");
    await writeFile(
      join(directory, "ui.ts"),
      "throw new Error('UI initialization failed');",
    );
    await page
      .getByRole("alert")
      .filter({ hasText: "UI initialization failed" })
      .waitFor();
    await writeFile(
      join(directory, "ui.ts"),
      "import { message } from './message.ts'; document.body.textContent=message;",
    );
    await expect
      .poll(() => frame.locator("body").textContent())
      .toContain("UI recovered");
    expect(await readFile("dist/workbench-ui/app.js")).toEqual(host);
    await manager.manage({ action: "disable", name: "independent-ui" });
    await page
      .locator('iframe[data-plugin="independent-ui"]')
      .waitFor({ state: "detached" });
    expect(errors).toEqual([]);
    expect(missing).toEqual([]);
  });

  it("mounts all ten slots, binds their RPC to the selected session and hot-reloads without losing the draft", async () => {
    const placements = {
      "workbench.header": "#topbar",
      "workbench.sidebar": "#sidebar",
      "workbench.panel": "#chat",
      "workbench.status": "[data-kernel-status]",
      "session.header": "#chat-header",
      "session.toolbar": "#chat",
      "session.footer": "#chat",
      "composer.toolbar": "#composer",
      "inspector.panel": "#artifacts",
      "settings.panel": "#settings",
    } satisfies Record<UiSlot, string>;
    expect(UI_SLOTS).toHaveLength(10);
    const host = await readFile("dist/workbench-ui/app.js");
    const manager = harness.kernel.kernel.ctx.creator;
    const directory = join(harness.workspace, "ten-slots");
    await mkdir(directory);
    const bundle = pluginBundle(
      "export function apply(ctx, api) { api.rpc.register('session', async (_, context) => context.sessionId); }",
      "slot-tour",
    );
    bundle.manifest.ui = UI_SLOTS.map((slot) => ({
      id: slot.replaceAll(".", "-"),
      title: `Slot ${slot}`,
      slot,
      entry: "ui.ts",
    }));
    bundle.files["version.ts"] = "export const version = 'one';";
    bundle.files["ui.ts"] = `
      import { PluginClient } from '@prism/plugin-sdk/client';
      import { version } from './version.ts';
      const client = new PluginClient();
      const output = document.createElement('output');
      const button = document.createElement('button');
      button.textContent = '检查会话';
      document.body.style.cssText = 'margin:0; font:12px sans-serif; overflow-wrap:anywhere';
      document.body.append(button, output);
      client.onContext(({sessionId}) => {
        output.dataset.session = sessionId ?? '';
        output.textContent = version + ':' + sessionId;
      });
      button.onclick = async () => {
        output.textContent = version + ':rpc:' + await client.request('session');
      };
      window.addEventListener('pagehide', () => client.close(), {once:true});
    `;
    await writeFile(
      join(directory, "prism.plugin.json"),
      JSON.stringify(bundle.manifest),
    );
    for (const [path, source] of Object.entries(bundle.files))
      await writeFile(join(directory, path), source);
    await manager.manage({ action: "develop", directory });
    expect(manager.ui().filter((entry) => entry.plugin === "slot-tour")).toEqual([]);
    await manager.manage({ action: "enable", name: "slot-tour" });
    const installed = manager.ui().filter((entry) => entry.plugin === "slot-tour");
    expect(installed.map((entry) => entry.slot)).toEqual(UI_SLOTS);

    await expect(
      manager.manage({
        action: "install",
        bundle: {
          ...bundle,
          manifest: {
            ...bundle.manifest,
            ui: [{ ...bundle.manifest.ui[0], slot: "unknown.slot" }],
          },
        },
      }),
    ).rejects.toThrow();
    expect(manager.ui().filter((entry) => entry.plugin === "slot-tour")).toEqual(
      installed,
    );

    async function inspect(slot: UiSlot, expectedSession: string, version: string) {
      if (slot === "settings.panel" || slot === "inspector.panel")
        await page
          .locator(
            `[data-action="view"][data-view="${slot === "settings.panel" ? "settings" : "artifacts"}"]`,
          )
          .click();
      if (slot === "workbench.panel") {
        await page.getByRole("button", { name: `Slot ${slot}`, exact: true }).click();
        await page.getByRole("button", { name: "放大", exact: true }).click();
      }
      const selector = `${placements[slot]} [data-plugin-slot="${slot}"] iframe[data-plugin="slot-tour"]`;
      await page.locator(selector).waitFor({ state: "visible" });
      const frame = page.frameLocator(selector);
      await expect
        .poll(() => frame.locator("output").getAttribute("data-session"))
        .toBe(expectedSession);
      await frame.getByRole("button", { name: "检查会话" }).click();
      await expect
        .poll(() => frame.locator("output").textContent())
        .toBe(`${version}:rpc:${expectedSession}`);
      if (slot === "workbench.panel")
        await page.getByRole("button", { name: "关闭插件面板" }).click();
    }

    await page.fill("#message", "热重载时保留的未发送草稿");
    for (const slot of UI_SLOTS) await inspect(slot, sessionId, "one");
    await writeFile(join(directory, "version.ts"), "export const version = 'two';");
    await expect
      .poll(() => manager.ui().find((entry) => entry.plugin === "slot-tour")?.revision)
      .not.toBe(installed[0]!.revision);
    for (const slot of UI_SLOTS) await inspect(slot, sessionId, "two");
    expect(await page.inputValue("#message")).toBe("热重载时保留的未发送草稿");
    expect(await readFile("dist/workbench-ui/app.js")).toEqual(host);

    const second = await client.createSession({ workspace: harness.workspace });
    await page
      .locator(`[data-action="open-session"][data-session="${second.id}"]`)
      .click();
    await inspect("composer.toolbar", second.id, "two");
    await inspect("settings.panel", second.id, "two");
    await page.screenshot({ path: ".scratch/plugin-bundles/ten-slots.png" });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "关闭详情", exact: true }).click();
    const navigation = page.getByRole("button", { name: "切换会话导航" });
    if ((await navigation.getAttribute("aria-expanded")) === "true")
      await navigation.click();
    await page
      .locator('[data-plugin-slot="workbench.sidebar"] iframe')
      .waitFor({ state: "detached" });
    expect(
      await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"),
    ).toBe(true);
    const input = await page.locator("#message").boundingBox();
    expect(input).not.toBeNull();
    expect(input!.y).toBeGreaterThanOrEqual(0);
    expect(input!.y + input!.height).toBeLessThanOrEqual(844);
    await inspect("composer.toolbar", second.id, "two");
    await manager.manage({ action: "disable", name: "slot-tour" });
    await expect
      .poll(() => page.locator('iframe[data-plugin="slot-tour"]').count())
      .toBe(0);
    expect(errors).toEqual([]);
    expect(missing).toEqual([]);
  }, 90_000);
});
