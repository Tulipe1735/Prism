import type { Tool } from "../../src/kernel/tool.ts";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startUiServer, type RunningUiServer } from "../../src/workbench/ui-server.ts";
import { startTestKernel, type KernelHarness } from "../kernel/harness.ts";

const UI_ROOT = resolve("dist/workbench-ui");
const DIFF = "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,2 +1,3 @@\n export function main() {\n-  return 1;\n+  return 2;\n }\n";

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

  afterAll(async () => {
    await browser?.close();
  });

  afterEach(async () => {
    await page?.close().catch(() => undefined);
    await ui?.close();
    await harness?.cleanup();
  });

  it(
    "runs the acceptance path: workspace, session, streaming, diff, approval",
    { timeout: 120_000 },
    async () => {
    harness = await startTestKernel({
      answers: [
        {
          text: ["我先改文件。"],
          toolCalls: [{ id: "call-edit", name: "edit_file", arguments: '{"path":"src/app.ts"}' }],
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
    page = await browser.newPage();

    // A plain browser talking to the UI origin only, exactly like Electron does.
    await page.goto(ui.url);
    await page.waitForSelector('#kernel-status [data-status="ready"]');

    await page.fill("#workspace-input", harness.workspace);
    await page.click('[data-action="use-workspace"]');
    await page.click('[data-action="new-session"]');
    await page.waitForSelector("#chat-header strong");

    await page.fill("#message", "改一下 src/app.ts，然后越界写一次");
    await page.click("#send");

    // Streaming assistant text and the tool process appear as they happen.
    await page.waitForSelector(".entry.assistant");
    await page.waitForSelector('.tool[data-call="call-edit"] .state[data-state="ok"]');
    await page.click('.tool[data-call="call-edit"] summary');
    expect(
      await page.locator('.tool[data-call="call-edit"] .diff .add').first().innerText(),
    ).toContain("+  return 2;");

    // The approval card carries the four facts and answers once.
    await page.waitForSelector(".approval");
    const card = page.locator(".approval");
    expect(await card.innerText()).toContain("write_outside");
    expect(await card.innerText()).toContain("目标在工作区之外");
    expect(await card.innerText()).toContain("/etc/hosts");
    expect(await card.innerText()).toContain("会向系统文件追加一行");
    expect(await card.locator("button").count()).toBe(2);
    await card.locator('[data-action="approve"]').click();

    await page.waitForSelector('.tool[data-call="call-outside"] .state[data-state="ok"]', {
      timeout: 10_000,
    });
    await page.waitForFunction(
      () => document.querySelector("#task-state")?.textContent === "空闲",
      undefined,
      { timeout: 10_000 },
    );
    expect(await page.locator("#timeline").innerText()).toContain("全部完成。");

    // Artifacts: the touched file with its diff.
    await page.click('[data-view="artifacts"]');
    expect(
      await page.locator('#artifacts [data-path="src/app.ts"]').innerText(),
    ).toContain("+1 −1");
    await page.click('#artifacts [data-path="src/app.ts"] summary');
    expect(await page.locator("#artifacts .diff .remove").first().innerText()).toContain(
      "-  return 1;",
    );

    // Settings are the effective kernel settings, read-only.
    await page.click('[data-view="settings"]');
    const settings = await page.locator("#settings").innerText();
    expect(settings).toContain("scripted-model");
    expect(settings).toContain("workspace-write");
    expect(settings).toContain(harness.dataDir);

    // Rename, search and delete act on the session list.
    await page.click('[data-action="rename-session"]');
    await page.fill('form[data-action="rename-form"] input[name="title"]', "验收会话");
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
});
