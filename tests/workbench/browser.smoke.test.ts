import type { Tool } from "../../src/kernel/tool.ts";
import { existsSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { type RunningUiServer, startUiServer } from "../../src/workbench/ui-server.ts";
import { type KernelHarness, startTestKernel } from "../kernel/harness.ts";

const UI_ROOT = resolve("dist/workbench-ui");
const DIFF =
  "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,2 +1,3 @@\n export function main() {\n-  return 1;\n+  return 2;\n }\n";

/** A write tool whose result carries a diff, like the file tools of 03. */
const editTool: Tool = {
  name: "edit_file",
  description: "edits a workspace file",
  parameters: { type: "object", properties: { path: { type: "string" } } },
  async execute(args) {
    const path = (args as { path?: string } | null)?.path ?? "file";
    return { content: `Edited ${path}\n${DIFF}` };
  },
};

/** Stands in for 04: asks the user once before acting outside the scope. */
const outsideTool: Tool = {
  name: "write_outside",
  description: "writes outside the workspace after one approval",
  parameters: { type: "object", properties: {} },
  async execute(_args, context) {
    const approved = await context.requestApproval({
      reason: "目标在工作区之外",
      target: "/etc/hosts",
      impact: "会向系统文件追加一行",
    });
    return approved
      ? { content: "wrote /etc/hosts" }
      : { content: "The user refused; nothing was written.", isError: true };
  },
};

/**
 * Drives the built UI in a real Chromium against a real kernel. Skipped unless
 * `PRISM_WORKBENCH_BROWSER=1` and the workbench is built, like the other
 * browser suites in this repository.
 */
const enabled =
  process.env.PRISM_WORKBENCH_BROWSER === "1" && existsSync(`${UI_ROOT}/app.js`);

describe.runIf(enabled)("workbench in a real browser", () => {
  let browser: Browser;
  let ui: RunningUiServer;
  let harness: KernelHarness;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch();
  });

  afterEach(async () => {
    await page?.close().catch(() => undefined);
    await ui?.close();
    await harness?.cleanup();
  });

  afterAll(async () => {
    await browser?.close();
  });

  it(
    "runs the acceptance path: workspace, session, streaming, diff, approval",
    { timeout: 120_000 },
    async () => {
      harness = await startTestKernel({
        answers: [
          {
            text: ["我先改文件。"],
            toolCalls: [
              {
                id: "call-edit",
                name: "edit_file",
                arguments: '{"path":"src/app.ts"}',
              },
            ],
          },
          {
            text: ["现在要越界写。"],
            toolCalls: [{ id: "call-outside", name: "write_outside", arguments: "{}" }],
          },
          { text: ["全部完成。"] },
        ],
        tools: [editTool, outsideTool],
      });
      ui = await startUiServer({ kernelUrl: harness.kernel.url, uiRoot: UI_ROOT });
      page = await browser.newPage({ viewport: { width: 1440, height: 920 } });

      // The browser runs the built bundle; a stale bundle would test old code.
      const built = statSync(join(UI_ROOT, "app.js")).mtimeMs;
      const sources = [
        "app.tsx",
        "main.tsx",
        "client.ts",
        "derive.ts",
        "sidebar.tsx",
        "timeline.tsx",
        "inspector.tsx",
        "settings.tsx",
        "creator.tsx",
        "components.tsx",
        "account.tsx",
        "account-menu.tsx",
        "use-workbench.ts",
        "state.ts",
        "app.css",
      ].map((file) => statSync(resolve("src/workbench/ui", file)).mtimeMs);
      expect(built, "run pnpm build before the browser smoke").toBeGreaterThan(
        Math.max(...sources),
      );

      // A plain browser talking to the UI origin only, exactly like Electron does.
      await page.goto(ui.url);
      await page.waitForSelector('#kernel-status [data-status="ready"]');

      await page.fill("#workspace-input", harness.workspace);
      await page.click('[data-action="use-workspace"]');
      await page.locator(".workspace-heading").hover();
      await page.click('[data-action="new-session"]');
      await page.waitForSelector("#chat-header strong");

      await page.fill("#message", "改一下 src/app.ts，然后越界写一次");
      await page.click("#send");

      // Streaming assistant text and the tool process appear as they happen.
      await page.waitForSelector(".entry.assistant");
      await page.waitForSelector(
        '.tool[data-call="call-edit"] .state[data-state="ok"]',
      );
      await page.click('.tool[data-call="call-edit"] summary');
      expect(
        await page
          .locator('.tool[data-call="call-edit"] .diff .add')
          .first()
          .textContent(),
      ).toContain("+  return 2;");

      // The approval card carries the four facts and answers once.
      await page.waitForSelector(".approval");
      const card = page.locator(".approval");
      expect(await card.textContent()).toContain("write_outside");
      expect(await card.textContent()).toContain("目标在工作区之外");
      expect(await card.textContent()).toContain("/etc/hosts");
      expect(await card.textContent()).toContain("会向系统文件追加一行");
      expect(await card.locator("button").count()).toBe(2);

      // React keeps local form and disclosure state across SSE updates.
      await page.click('[data-view="settings"]');
      const modelInput = page.locator('#settings input[name="model"]');
      await modelInput.fill("unsaved-model-draft");
      const editDetails = page.locator('.tool[data-call="call-edit"]');
      if ((await editDetails.getAttribute("open")) !== null)
        await editDetails.locator("summary").click();
      await card.locator('[data-action="approve"]').click();

      await page.waitForSelector(
        '.tool[data-call="call-outside"] .state[data-state="ok"]',
        {
          timeout: 10_000,
        },
      );
      await page.waitForSelector("#cancel", { state: "detached", timeout: 10_000 });
      expect(await page.locator("#task-state").getAttribute("title")).toBe(
        harness.workspace,
      );
      expect(await page.locator("#timeline").textContent()).toContain("全部完成。");
      expect(await modelInput.inputValue()).toBe("unsaved-model-draft");
      expect(await editDetails.getAttribute("open")).toBeNull();
      await modelInput.fill("scripted-model");

      // Artifacts: the touched file with its diff.
      await page.click('[data-view="artifacts"]');
      expect(
        await page.locator('#artifacts [data-path="src/app.ts"]').textContent(),
      ).toContain("+1 −1");
      await page.click('#artifacts [data-path="src/app.ts"] summary');
      expect(
        await page.locator("#artifacts .diff .remove").first().textContent(),
      ).toContain("-  return 1;");

      // Settings are the effective kernel settings; the fields write through.
      await page.click('[data-view="settings"]');
      const settings = await page.locator("#settings").textContent();
      expect(settings).toContain(harness.dataDir);
      expect(
        await page
          .locator('#settings form[data-section="model"] input[name="model"]')
          .inputValue(),
      ).toBe("scripted-model");
      expect(
        await page
          .locator('#settings form[data-section="model"] input[name="baseUrl"]')
          .inputValue(),
      ).toBe(harness.model.baseUrl);
      await page.click('button[data-action="set-scope"][data-scope="read-only"]');
      await page.waitForSelector(
        'button[data-action="set-scope"][data-scope="read-only"][aria-pressed="true"]',
      );
      expect(harness.kernel.kernel.settings().permissions.scope).toBe("read-only");
      await page.click('button[data-action="set-scope"][data-scope="workspace-write"]');
      await page.waitForSelector(
        'button[data-action="set-scope"][data-scope="workspace-write"][aria-pressed="true"]',
      );
      expect(harness.kernel.kernel.settings().permissions.scope).toBe(
        "workspace-write",
      );
      // The engine switch reaches the kernel without a restart.
      await page.click('button[data-action="set-engine"][data-engine="firefox"]');
      await page.waitForSelector(
        'button[data-action="set-engine"][data-engine="firefox"][aria-pressed="true"]',
      );
      expect(harness.kernel.kernel.settings().browser.engine).toBe("firefox");
      await page.click('button[data-action="set-engine"][data-engine="chromium"]');
      await page.waitForSelector(
        'button[data-action="set-engine"][data-engine="chromium"][aria-pressed="true"]',
      );

      // Manual compaction is offered on the open session; a short log has
      // nothing to compact, and the kernel says so without touching the log.
      await page.click('button[data-action="compact"]');
      await page.waitForSelector("#notice >> text=没有可压缩的内容");

      // Rename, search and delete act on the session list.
      await page.click('[data-action="rename-session"]');
      await page.fill(
        'form[data-action="rename-form"] input[name="title"]',
        "验收会话",
      );
      await page.click('form[data-action="rename-form"] button[type="submit"]');
      await page.waitForSelector(".session .title >> text=验收会话");
      await page.fill("#search", "不存在");
      await page.waitForSelector("#session-list .empty");
      await page.fill("#search", "验收");
      await page.waitForSelector(".session .title >> text=验收会话");
      await page.click('[data-action="delete-session"]');
      await page.click('[data-action="delete-confirm"]');
      await page.waitForSelector("#session-list .empty");
      expect(await harness.kernel.kernel.listSessions()).toEqual([]);
    },
  );

  it("keeps the workbench usable in a narrow window", async () => {
    harness = await startTestKernel();
    ui = await startUiServer({ kernelUrl: harness.kernel.url, uiRoot: UI_ROOT });
    page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(ui.url);
    await page.waitForSelector('#kernel-status [data-status="ready"]');
    expect(await page.locator("#message").isDisabled()).toBe(true);

    await page.getByRole("button", { name: "切换会话导航" }).click();
    await page.click('[data-action="use-workspace"]');
    await page.waitForSelector(
      "#notice >> text=先选择一个当前运行环境中的工作区目录。",
    );
    await page.fill("#workspace-input", harness.workspace);
    await page.press("#workspace-input", "Enter");
    await page.locator(".workspace-heading").hover();
    await page.click('[data-action="new-session"]');
    await page.waitForSelector("#chat-header strong");
    // The overlay folds 120ms after the session opens; wait for the rail.
    await page.waitForTimeout(250);
    expect(await page.locator("#workspace-input").isVisible()).toBe(false);
    expect(await page.locator('[data-action="new-session-compact"]').isVisible()).toBe(
      true,
    );
    await page.fill("#message", "尚未发送的任务草稿");

    await page.getByRole("button", { name: "切换产物与设置" }).click();
    await page.click('[data-view="settings"]');
    await page.waitForSelector('#settings input[name="model"]');
    const model = page.locator('#settings input[name="model"]');
    await model.fill("local-draft");
    await page.click('[data-view="artifacts"]');
    await page.click('[data-view="settings"]');
    expect(await model.inputValue()).toBe("local-draft");
    await page.keyboard.press("Escape");
    expect(await page.locator("#inspector").isVisible()).toBe(false);
    expect(await page.locator("#message").inputValue()).toBe("尚未发送的任务草稿");

    for (const width of [390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      expect(
        await page.evaluate(
          "document.documentElement.scrollWidth <= window.innerWidth",
        ),
      ).toBe(true);
      const composer = await page.locator("#composer").boundingBox();
      expect(composer).not.toBeNull();
      expect(composer!.width).toBeGreaterThan(250);
      expect(composer!.y + composer!.height).toBeLessThan(844);
    }
    expect(errors).toEqual([]);
  });

  it("collapses either desktop sidebar and creates a session from the compact rail", async () => {
    harness = await startTestKernel();
    ui = await startUiServer({ kernelUrl: harness.kernel.url, uiRoot: UI_ROOT });
    page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(ui.url);
    await page.waitForSelector('#kernel-status [data-status="ready"]');

    const navigation = page.getByRole("button", { name: "切换会话导航" });
    const inspector = page.getByRole("button", { name: "切换产物与设置" });
    const compactCreate = page.getByRole("button", { name: "新建会话", exact: true });
    const chatWidth = async (): Promise<number> =>
      (await page.locator("#chat").boundingBox())!.width;
    const initialWidth = await chatWidth();
    expect(await navigation.getAttribute("aria-expanded")).toBe("true");
    expect(await inspector.getAttribute("aria-expanded")).toBe("true");
    expect(
      await page
        .locator("#wordmark")
        .evaluate(
          (element) =>
            element.ownerDocument.defaultView!.getComputedStyle(element).fontFamily,
        ),
    ).toBe(
      await page
        .locator("body")
        .evaluate(
          (element) =>
            element.ownerDocument.defaultView!.getComputedStyle(element).fontFamily,
        ),
    );

    await navigation.click();
    expect(await navigation.getAttribute("aria-expanded")).toBe("false");
    // The rail keeps its content for 120ms, then folds; wait for both transitions.
    await page.waitForTimeout(350);
    expect(await page.locator("#workspace-input").isVisible()).toBe(false);
    expect(await page.locator("#sidebar button:visible").count()).toBe(2);
    expect(await chatWidth()).toBeGreaterThan(initialWidth);
    const circle = await compactCreate.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
      radius: element.ownerDocument.defaultView!.getComputedStyle(element).borderRadius,
    }));
    expect(circle.width).toBe(circle.height);
    expect(Number.parseFloat(circle.radius)).toBeGreaterThanOrEqual(circle.width / 2);

    // A new install has no workspace yet: the compact action opens its picker.
    await compactCreate.click();
    await page.waitForFunction('document.activeElement?.id === "workspace-input"');
    await page.fill("#workspace-input", harness.workspace);
    await page.press("#workspace-input", "Enter");
    await page.locator(".workspace-heading").hover();
    await page.click('[data-action="new-session"]');
    await page.waitForSelector("#chat-header strong");
    const firstId = await page
      .locator('[data-action="open-session"][aria-current="page"]')
      .getAttribute("data-session");
    await page.fill("#message", "折叠时保留的任务草稿");
    await page.fill("#workspace-input", `${harness.workspace}/unsaved-path`);

    await page.click('[data-view="settings"]');
    const model = page.locator('#settings input[name="model"]');
    await model.fill("collapsed-settings-draft");
    await page.getByRole("button", { name: "关闭详情" }).click();
    expect(await inspector.getAttribute("aria-expanded")).toBe("false");
    await page.waitForTimeout(350);
    expect(await page.locator("#inspector").isVisible()).toBe(false);
    await navigation.click();
    await page.waitForTimeout(350);
    expect(await chatWidth()).toBeGreaterThan(initialWidth + 400);
    expect(await page.locator("#message").inputValue()).toBe("折叠时保留的任务草稿");
    await inspector.click();
    expect(await model.inputValue()).toBe("collapsed-settings-draft");
    expect(await navigation.getAttribute("aria-expanded")).toBe("false");
    await navigation.click();
    expect(await page.locator("#workspace-input").inputValue()).toBe(
      `${harness.workspace}/unsaved-path`,
    );

    // A configured workspace can create a real session without expanding the rail.
    await navigation.click();
    await page.waitForTimeout(350);
    await compactCreate.click();
    await page.waitForSelector(
      `[data-action="open-session"][aria-current="page"]:not([data-session="${firstId}"])`,
      { state: "attached" },
    );
    expect(await navigation.getAttribute("aria-expanded")).toBe("false");
    expect(await page.locator("#message").isDisabled()).toBe(false);
    const sessions = await harness.kernel.kernel.listSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions.every((session) => session.workspace === harness.workspace)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });

  it("creates a session in the hovered workspace and renders Markdown without widening the chat", async () => {
    const markdown = [
      "## 修改结果",
      "",
      "**完成**，查看 `src/app.ts`。",
      "",
      "1. 修改代码",
      "   - 检查结果",
      "",
      "> 验证通过",
      "",
      "| 检查 | 结果 |",
      "| --- | --- |",
      "| 测试 | 通过 |",
      "",
      "```ts",
      `const value = '${"long-value-".repeat(20)}';`,
      "```",
    ].join("\n");
    harness = await startTestKernel({ answers: [{ text: [markdown] }] });
    const other = join(harness.workspace, "another-project");
    await harness.kernel.kernel.createSession({
      workspace: harness.workspace,
      title: "已有会话",
    });
    await harness.kernel.kernel.createSession({
      workspace: other,
      title: "另一个项目",
    });
    ui = await startUiServer({ kernelUrl: harness.kernel.url, uiRoot: UI_ROOT });
    page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
    await page.goto(ui.url);
    await page.waitForSelector('#kernel-status [data-status="ready"]');
    await page.waitForSelector('[data-action="new-session"]');
    await page.fill("#workspace-input", harness.workspace);
    await page.click('[data-action="use-workspace"]');
    const create = page.locator(
      `[data-action="new-session"][data-workspace="${other}"]`,
    );
    const heading = page.locator(".workspace-heading").filter({ has: create });
    const opacity = (): Promise<string> =>
      create.evaluate(
        (element) =>
          element.ownerDocument.defaultView!.getComputedStyle(element).opacity,
      );
    expect(await opacity()).toBe("0");
    await heading.hover();
    await page.waitForFunction(
      `getComputedStyle(document.querySelector('[data-workspace="${other}"]')).opacity === '1'`,
    );
    await page.mouse.move(700, 500);
    await page.waitForFunction(
      `getComputedStyle(document.querySelector('[data-workspace="${other}"]')).opacity === '0'`,
    );
    await heading.getByRole("button", { name: "another-project", exact: true }).focus();
    await page.waitForFunction(
      `getComputedStyle(document.querySelector('[data-workspace="${other}"]')).opacity === '1'`,
    );
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.waitForSelector("#chat-header strong");
    expect(await page.locator("#task-state").textContent()).toContain(
      "another-project",
    );
    expect(
      (await harness.kernel.kernel.listSessions()).filter((s) => s.workspace === other),
    ).toHaveLength(2);

    await page.fill("#message", "显示修改结果");
    await page.click("#send");
    await page.waitForSelector(".markdown h2");
    expect(await page.locator(".markdown strong").textContent()).toBe("完成");
    expect(await page.locator(".markdown ol ul li").textContent()).toBe("检查结果");
    expect(await page.locator(".markdown table td").first().textContent()).toBe("测试");
    expect(await page.locator(".markdown pre code").getAttribute("class")).toBe(
      "language-ts",
    );
    expect(
      await page
        .locator(".markdown pre")
        .evaluate((element) => element.scrollWidth > element.clientWidth),
    ).toBe(true);
    await page.screenshot({ path: "/tmp/prism-workbench-fixes.png" });
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 920 });
      expect(
        await page.evaluate("document.documentElement.scrollWidth <= innerWidth"),
      ).toBe(true);
    }
  });

  it("uses the native folder selection, preserves cancellation and reports picker errors", async () => {
    harness = await startTestKernel();
    ui = await startUiServer({ kernelUrl: harness.kernel.url, uiRoot: UI_ROOT });
    page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
    await page.addInitScript(`
      let selections = [${JSON.stringify(harness.workspace)}, null, new Error('无法选择文件夹')];
      window.prismDesktop = {
        version: '0.2.3', clerkPublishableKey: '',
        selectWorkspace: async (path) => {
          window.__lastPickerPath = path;
          const selected = selections.shift();
          if (selected instanceof Error) throw selected;
          return selected;
        },
        updates: {
          read: async () => ({ phase: 'idle', version: '0.2.3' }),
          subscribe: () => () => {},
        },
      };
    `);
    await page.goto(ui.url);
    await page.waitForSelector('#kernel-status [data-status="ready"]');
    const browse = page.getByRole("button", { name: "选择文件夹…", exact: true });
    await browse.click();
    expect(await page.locator("#workspace-input").inputValue()).toBe(harness.workspace);
    expect(await page.locator("#task-state").textContent()).toContain(
      basename(harness.workspace),
    );
    expect(await page.locator('[data-action="new-session"]').count()).toBe(1);
    expect(await page.evaluate("window.__lastPickerPath")).toBe("");
    await browse.click();
    expect(await page.evaluate("window.__lastPickerPath")).toBe(harness.workspace);
    expect(await page.locator("#workspace-input").inputValue()).toBe(harness.workspace);
    await browse.click();
    await page.waitForSelector("#notice >> text=无法选择文件夹");
    expect(await page.locator("#workspace-input").inputValue()).toBe(harness.workspace);
  });

  it("creates a plugin from a wish and manages its lifecycle from settings", async () => {
    const source = `export const inject = ['tools'];
export function apply(ctx) {
  ctx.effect(() => ctx.tools.register({
    name: 'wish_length', description: 'Count text code points.',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    async execute(args) { return { content: String(Array.from(args.text).length) }; }
  }));
}`;
    harness = await startTestKernel({
      answers: [
        {
          toolCalls: [
            { id: "creator-inspect", name: "creator_inspect", arguments: "{}" },
          ],
        },
        {
          toolCalls: [
            {
              id: "creator-install",
              name: "plugin_manager",
              arguments: JSON.stringify({
                action: "install",
                name: "text-length",
                description: "统计文本长度",
                source,
              }),
            },
          ],
        },
        {
          toolCalls: [
            {
              id: "creator-verify",
              name: "wish_length",
              arguments: JSON.stringify({ text: "你好 Agent" }),
            },
          ],
        },
        { text: ["插件已安装并验证，结果为 8。"] },
      ],
    });
    ui = await startUiServer({ kernelUrl: harness.kernel.url, uiRoot: UI_ROOT });
    page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(ui.url);
    await page.waitForSelector('#kernel-status [data-status="ready"]');
    await page.click('[data-view="settings"]');
    const toggle = page.locator('[data-action="toggle-creator"]');
    expect(await toggle.getAttribute("aria-pressed")).toBe("false");
    await toggle.click();
    await expect.poll(() => toggle.getAttribute("aria-pressed")).toBe("true");
    await page.fill("#workspace-input", harness.workspace);
    await page.click('[data-action="use-workspace"]');
    await page.locator(".workspace-heading").hover();
    await page.click('[data-action="new-session"]');
    await page.waitForSelector("#chat-header strong");
    await page.fill("#message", "做一个文本长度插件，并用你好 Agent验证。");
    await page.click("#send");
    await page.waitForSelector(
      '.tool[data-call="creator-verify"] .state[data-state="ok"]',
    );
    await page.waitForSelector("#cancel", { state: "detached" });
    await page.click('[data-view="settings"]');
    const section = page.locator('[data-section="creator"]');
    await section.getByRole("button", { name: "刷新", exact: true }).click();
    const plugin = page.locator('[data-plugin="text-length"]');
    await plugin.waitFor();
    expect(await plugin.textContent()).toContain("wish_length");
    await plugin.locator('[data-action="plugin-toggle"]').click();
    await plugin.getByText("已停用", { exact: true }).waitFor();
    await plugin.locator('[data-action="plugin-toggle"]').click();
    await plugin.getByText("已启用", { exact: true }).waitFor();
    await plugin.locator('[data-action="plugin-reload"]').click();
    await expect
      .poll(() => plugin.locator('[data-action="plugin-reload"]').isEnabled())
      .toBe(true);
    await page.screenshot({ path: "/tmp/prism-creator-mode.png" });
    await toggle.click();
    await expect.poll(() => toggle.getAttribute("aria-pressed")).toBe("false");
    expect(harness.kernel.kernel.ctx.tools.get("wish_length")).toBeDefined();
    await plugin.locator('[data-action="plugin-remove"]').click();
    await plugin.waitFor({ state: "detached" });
    expect(harness.kernel.kernel.ctx.tools.get("wish_length")).toBeUndefined();
    expect(errors).toEqual([]);
  });

  it("keeps account and update actions in the bottom-left menu when collapsed", async () => {
    harness = await startTestKernel();
    ui = await startUiServer({ kernelUrl: harness.kernel.url, uiRoot: UI_ROOT });
    page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
    await page.addInitScript(`
      let state = { phase: 'idle', version: '0.2.2' };
      let listener;
      window.__prismInstallCalls = 0;
      function publish(patch) { state = { version: '0.2.2', ...patch }; listener?.(state); return state; }
      window.prismDesktop = {
        version: '0.2.2', clerkPublishableKey: '',
        updates: {
          read: async () => state,
          subscribe: (receive) => { listener = receive; return () => { listener = undefined; }; },
          check: async () => { publish({ phase: 'checking' }); await Promise.resolve(); return publish({ phase: 'available', latestVersion: '0.2.3' }); },
          download: async () => { publish({ phase: 'downloading', percent: 50, latestVersion: '0.2.3' }); await Promise.resolve(); return publish({ phase: 'downloaded', latestVersion: '0.2.3' }); },
          install: async () => { window.__prismInstallCalls++; },
        },
      };
    `);
    await page.goto(ui.url);
    await page.waitForSelector('#kernel-status [data-status="ready"]');
    await page.getByRole("button", { name: "切换会话导航" }).click();
    const account = page.getByRole("button", { name: "账户与更新" });
    const position = await account.boundingBox();
    expect(position!.x).toBeLessThan(64);
    expect(position!.y).toBeGreaterThan(800);
    await account.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("menu").waitFor();
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      'document.activeElement?.getAttribute("aria-label") === "账户与更新"',
    );
    await account.click();
    await page.getByRole("menuitem", { name: "检查更新", exact: true }).click();
    await page.getByRole("menuitem", { name: "下载 v0.2.3", exact: true }).click();
    await page.getByRole("menuitem", { name: "重启并安装更新", exact: true }).waitFor();
    expect(await page.evaluate("window.__prismInstallCalls")).toBe(0);
    await page.getByRole("menuitem", { name: "重启并安装更新", exact: true }).click();
    expect(await page.evaluate("window.__prismInstallCalls")).toBe(1);
    await page.getByRole("menuitem", { name: "工作台设置", exact: true }).click();
    await page.locator('#settings input[name="model"]').waitFor();
    expect(
      await page
        .getByRole("button", { name: "切换会话导航" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });
});
