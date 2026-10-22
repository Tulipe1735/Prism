import type { Buffer } from "node:buffer";
import type { ElectronApplication, Page } from "playwright";
import type { NotionDocument } from "../../plugins/notion/src/protocol.ts";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { _electron as electron } from "playwright";
import { afterEach, describe, expect, it } from "vitest";
import { KernelClient } from "../../src/workbench/ui/client.ts";
import { type FakeAnswer, type FakeModel, startFakeModel } from "../kernel/harness.ts";

const enabled =
  process.env.PRISM_ELECTRON_WEB_APPS === "1" &&
  existsSync("dist/workbench/electron/web-app-preload.cjs") &&
  (process.env.DISPLAY !== undefined || process.env.WAYLAND_DISPLAY !== undefined);

// A representative native DOM, served in the app's real HTTPS partition. No Notion account is used.
const fixture = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Prism 项目计划 · Notion</title>
<style>body{margin:0;color:#37352f;font:15px/1.7 system-ui;background:white}aside{position:fixed;inset:0 auto 0 0;width:210px;background:#f7f7f5;padding:24px;box-sizing:border-box}button{font:inherit;cursor:pointer;border:0;padding:8px;border-radius:5px;background:transparent;color:inherit}main{margin:90px 430px 0 260px;min-width:300px}h1{font-size:34px}#editor{padding:15px 0;outline:none;border-bottom:1px solid #eee}small{color:#9b9a97}</style>
<aside><strong>Prism Workspace</strong><p><button id="native-ai" aria-label="Notion AI">✦ Notion AI</button></p><small>本地验收页面</small></aside>
<main class="notion-page-content"><h1>Prism 项目计划</h1><p>将原生应用的 AI 入口连接到 Prism harness。</p><div id="editor" contenteditable="true" role="textbox" aria-label="原生页面正文">需要润色的原文</div><p>页面中的内容保留为任务数据。</p></main>
<script>window.originalAiClicks=0;window.inputEvents=[];document.getElementById('native-ai').onclick=()=>window.originalAiClicks++;document.getElementById('editor').addEventListener('input',event=>window.inputEvents.push(event.inputType));</script></html>`;

describe.runIf(enabled)("Notion native app through the real Electron host", () => {
  let app: ElectronApplication | undefined;
  let main: Page;
  let native: Page | undefined;
  let model: FakeModel;
  let directory: string;
  let client: KernelClient;
  let sessionId: string;
  const errors: string[] = [];

  afterEach(async (context) => {
    if (
      context.task.result?.state === "fail" &&
      native !== undefined &&
      !native.isClosed()
    ) {
      await mkdir(".scratch/notion", { recursive: true });
      await native.screenshot({ path: ".scratch/notion/failure.png" }).catch(() => {});
      console.log("Native Notion fixture failure", {
        title: await native.title(),
        bridge: await native.evaluate("typeof window.prismNativeApp"),
        editor: await native.locator("#editor").textContent(),
        inputs: await native.evaluate("window.inputEvents"),
        page: await native
          .locator("body")
          .ariaSnapshot()
          .catch(() => "closed"),
        entries: JSON.stringify(await client.readSession(sessionId).catch(() => null)),
        errors,
      });
    }
    await app?.close();
    await model?.close();
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
    app = undefined;
    native = undefined;
  });

  async function boot(answers: FakeAnswer[]) {
    errors.length = 0;
    directory = await mkdtemp(join(tmpdir(), "prism-notion-electron-"));
    const workspace = join(directory, "workspace");
    await mkdir(workspace);
    model = await startFakeModel(answers);
    await writeFile(
      join(directory, "config.json"),
      JSON.stringify({
        model: { baseUrl: model.baseUrl, apiKey: "test-key", model: "scripted-model" },
        creator: { enabled: true },
      }),
    );
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({
      executablePath: createRequire(import.meta.url)("electron"),
      args: [
        resolve("dist/workbench/electron/main.cjs"),
        `--user-data-dir=${join(directory, "desktop")}`,
      ],
      env: { ...env, PRISM_DATA_DIR: directory },
      timeout: 30_000,
    });
    const ready = new Promise<{ kernelUrl: string }>((resolveReady, reject) => {
      let output = "";
      const timer = setTimeout(
        () => reject(new Error("Electron host did not announce its kernel")),
        15_000,
      );
      const receive = (chunk: Buffer): void => {
        output += chunk.toString();
        for (const line of output.split("\n")) {
          if (!line.includes('"workbench.window"')) continue;
          clearTimeout(timer);
          app!.process().stdout?.removeListener("data", receive);
          resolveReady(JSON.parse(line));
        }
      };
      app!.process().stdout?.on("data", receive);
    });
    await app.evaluate(({ session }, html) => {
      session.fromPartition("persist:prism-web-app-notion-workspace").protocol.handle(
        "https",
        () =>
          new Response(html, {
            headers: {
              "content-type": "text/html;charset=utf-8",
              "content-security-policy":
                "default-src 'none';script-src 'unsafe-inline';style-src 'unsafe-inline';connect-src 'none';form-action 'none'",
            },
          }),
      );
    }, fixture);
    main = await app.firstWindow();
    const host = await ready;
    client = new KernelClient({ baseUrl: host.kernelUrl });
    await client.managePlugin("enable", "notion");
    await main.waitForURL("prism://workbench/");
    await main.waitForSelector('[data-kernel-status="ready"]');
    await main.fill("#workspace-input", workspace);
    await main.click('[data-action="use-workspace"]');
    await main.locator(".workspace-heading").hover();
    await main.click('[data-action="new-session"]');
    await main.waitForSelector("#chat-header strong");
    sessionId = (await client.listSessions())[0]!.id;
    await main.fill("#message", "主会话未发送的草稿");
    await main.locator('[data-view="plugins"]').click();
    await main
      .locator('[data-action="plugin-open"][data-plugin-panel="notion/workspace"]')
      .click();
    const launcher = main.frameLocator('iframe[data-plugin="notion"]');
    await launcher.getByRole("button", { name: "打开 Notion", exact: true }).waitFor();
    const opened = app.waitForEvent("window");
    await launcher.getByRole("button", { name: "打开 Notion", exact: true }).click();
    native = await opened;
    native.on("pageerror", (error) => errors.push(error.message));
    await native.waitForSelector("#prism-notion-root", { state: "attached" });
    await expect
      .poll(() => launcher.getByRole("status").textContent())
      .toContain("Notion 已打开");
    return native;
  }

  async function selectAndOpen(page: Page) {
    await page.locator("#editor").focus();
    await page.evaluate(
      `(() => {const element=document.getElementById('editor');const range=document.createRange();range.selectNodeContents(element);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);})()`,
    );
    await page.getByRole("button", { name: "Notion AI", exact: true }).click();
    await expect
      .poll(() => page.locator(".prism-notion-state").textContent())
      .toContain("已连接 Prism");
  }

  function readAndApply(text: string): FakeAnswer[] {
    return [
      { toolCalls: [{ id: "read", name: "notion_read", arguments: "{}" }] },
      {
        respond: (request) => {
          const last = request.messages.at(-1)!;
          const doc: NotionDocument = JSON.parse(
            typeof last.content === "string" ? last.content : "{}",
          );
          expect(doc).toMatchObject({
            title: "Prism 项目计划 · Notion",
            editable: true,
          });
          return {
            toolCalls: [
              {
                id: "apply",
                name: "notion_apply",
                arguments: JSON.stringify({ revision: doc.revision, text }),
              },
            ],
          };
        },
      },
    ];
  }

  it("redirects the native AI click to the harness, writes through native input, preserves drafts and closes disabled apps", async () => {
    const page = await boot([
      ...readAndApply("通过 Prism 完成润色"),
      { text: ["已在当前 Notion 选区完成修改。"] },
    ]);
    await selectAndOpen(page);
    expect(await page.evaluate("window.originalAiClicks")).toBe(0);
    expect(await page.evaluate("typeof require")).toBe("undefined");
    expect(await page.evaluate("typeof process")).toBe("undefined");
    await page.getByRole("textbox", { name: "向 Prism 提问" }).fill("润色选中的文字");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect
      .poll(() => page.locator(".prism-notion-log").textContent(), { timeout: 10_000 })
      .toContain("已在当前 Notion 选区完成修改。");
    expect(await page.locator("#editor").textContent()).toBe("通过 Prism 完成润色");
    expect(await page.evaluate("window.inputEvents")).toContain("insertText");
    const log = await client.readSession(sessionId);
    expect(log.entries[0]).toMatchObject({
      content: "润色选中的文字",
      context: expect.stringContaining('"selection":"需要润色的原文"'),
    });
    expect(
      log.entries
        .filter((entry) => entry.type === "tool_result")
        .every((entry) => !entry.isError),
    ).toBe(true);
    expect(
      model.requests[0]?.messages.some(
        (message) =>
          message.role === "user" &&
          JSON.stringify(message.content).includes("Prism 项目计划"),
      ),
    ).toBe(true);
    expect(await main.inputValue("#message")).toBe("主会话未发送的草稿");
    await mkdir(".scratch/notion", { recursive: true });
    await page.screenshot({ path: ".scratch/notion/notion-prism-fixture.png" });
    await page.getByRole("textbox", { name: "向 Prism 提问" }).fill("刷新后保留的草稿");
    await page.evaluate(
      "document.cookie='prism-fixture=remembered; Secure; SameSite=Lax; path=/'",
    );
    await page.reload();
    await page.waitForSelector("#prism-notion-root", { state: "attached" });
    await page.getByRole("button", { name: "Notion AI", exact: true }).click();
    expect(
      await page.getByRole("textbox", { name: "向 Prism 提问" }).inputValue(),
    ).toBe("刷新后保留的草稿");
    expect(await page.evaluate("document.cookie")).toContain(
      "prism-fixture=remembered",
    );
    const popupEvent = app!.waitForEvent("window");
    await page.evaluate("window.open('https://identity.example.test/signin')");
    const popup = await popupEvent;
    await popup.waitForLoadState();
    expect(await popup.evaluate("typeof window.prismNativeApp")).toBe("undefined");
    expect(await popup.evaluate("window.opener !== null")).toBe(true);
    expect(await popup.locator("#prism-notion-root").count()).toBe(0);
    await popup.close();
    const other = await client.createSession({ workspace: log.session.workspace });
    expect((await client.readSession(other.id)).entries).toEqual([]);
    const closed = page.waitForEvent("close");
    await client.managePlugin("disable", "notion");
    await closed;
    expect(errors).toEqual([]);
  }, 60_000);

  it("refuses changed page revisions after approval and stops a running task from the page", async () => {
    const page = await boot([
      ...readAndApply("不应覆盖用户修改"),
      { text: ["页面已改变，保留用户的修改。"] },
      ...readAndApply("不应使用已经移动的选区"),
      { text: ["选区已改变，请重新选择。"] },
      { text: ["正在处理…"], hold: true },
    ]);
    await client.updateSettings({ browser: { actionsNeedApproval: true } });
    await selectAndOpen(page);
    await page.getByRole("textbox", { name: "向 Prism 提问" }).fill("修改选中文字");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect
      .poll(async () => (await client.readSession(sessionId)).approvals.length)
      .toBe(1);
    await expect
      .poll(() => page.locator(".prism-notion-state").textContent())
      .toContain("审批");
    expect(await page.locator("#editor").textContent()).toBe("需要润色的原文");
    await page.locator("#editor").fill("用户已经手动修改");
    const approval = (await client.readSession(sessionId)).approvals[0]!;
    await client.answerApproval(sessionId, approval.requestId, true);
    await expect
      .poll(() => page.locator(".prism-notion-log").textContent())
      .toContain("页面已改变，保留用户的修改。");
    expect(await page.locator("#editor").textContent()).toBe("用户已经手动修改");
    expect((await client.readSession(sessionId)).entries).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        isError: true,
        content: expect.stringContaining("已经改变"),
      }),
    );
    await selectAndOpen(page);
    await page.getByRole("textbox", { name: "向 Prism 提问" }).fill("再次修改选中文字");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect
      .poll(async () => (await client.readSession(sessionId)).approvals.length)
      .toBe(1);
    await page.locator("#editor").press("ArrowRight");
    const movedSelection = (await client.readSession(sessionId)).approvals[0]!;
    await client.answerApproval(sessionId, movedSelection.requestId, true);
    await expect
      .poll(() => page.locator(".prism-notion-log").textContent())
      .toContain("选区已改变，请重新选择。");
    expect(await page.locator("#editor").textContent()).toBe("用户已经手动修改");
    expect(
      (await client.readSession(sessionId)).entries
        .filter((entry) => entry.type === "tool_result")
        .at(-1),
    ).toMatchObject({ isError: true, content: expect.stringContaining("已经改变") });
    await page.getByRole("textbox", { name: "向 Prism 提问" }).fill("继续分析");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect
      .poll(() => page.getByRole("button", { name: "停止", exact: true }).isVisible())
      .toBe(true);
    await page.getByRole("button", { name: "停止", exact: true }).click();
    await expect
      .poll(async () => (await client.readSession(sessionId)).running)
      .toBe(false);
    expect(errors).toEqual([]);
  }, 60_000);
});
