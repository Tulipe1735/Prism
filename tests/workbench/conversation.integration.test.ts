import { Buffer, File } from "node:buffer";
import { readFile, rm, stat } from "node:fs/promises";
import process from "node:process";
import { afterEach, expect, it } from "vitest";
import { rebuildContext } from "../../src/kernel/session.ts";
import { KernelClient } from "../../src/workbench/ui/client.ts";
import { type KernelHarness, startTestKernel } from "../kernel/harness.ts";

let harness: KernelHarness;
afterEach(async () => harness?.cleanup());

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";

it("names a session from its first task, persists the name, and keeps manual names", async () => {
  harness = await startTestKernel({
    answers: [{ text: ["完成"] }, { text: ["继续完成"] }, { text: ["完成"] }],
    titleAnswer: { text: ["修复登录超时"] },
  });
  const client = new KernelClient({ baseUrl: harness.kernel.url });
  const session = await client.createSession({ workspace: harness.workspace });
  expect(session.title).toBe("workspace · 新会话");
  await client.sendMessage(session.id, "修复登录时的超时错误");
  await expect
    .poll(async () => (await client.readSession(session.id)).session.title)
    .toBe("修复登录超时");
  await harness.kernel.kernel.ctx.tasks.settle(session.id);
  const log = await client.readSession(session.id);
  expect(
    log.entries
      .filter((entry) => entry.type === "message")
      .map((entry) => entry.content),
  ).toEqual(["修复登录时的超时错误", "完成"]);
  expect(harness.model.titleRequests[0]?.tools).toBeUndefined();
  await client.sendMessage(session.id, "继续");
  await harness.kernel.kernel.ctx.tasks.settle(session.id);
  expect(harness.model.titleRequests).toHaveLength(1);
  const manual = await client.createSession({
    workspace: harness.workspace,
    title: "我的名字",
  });
  await client.sendMessage(manual.id, "修复别的问题");
  await harness.kernel.kernel.ctx.tasks.settle(manual.id);
  expect((await client.readSession(manual.id)).session.title).toBe("我的名字");
  expect(harness.model.titleRequests).toHaveLength(1);
});

it("continues the task when automatic naming fails", async () => {
  harness = await startTestKernel({
    answers: [{ text: ["任务已完成"] }],
    titleAnswer: { status: 500 },
  });
  const client = new KernelClient({ baseUrl: harness.kernel.url });
  const session = await client.createSession({ workspace: harness.workspace });
  await client.sendMessage(session.id, "请继续工作");
  await harness.kernel.kernel.ctx.tasks.settle(session.id);
  const log = await client.readSession(session.id);
  expect(log.session.title).toBe(session.title);
  expect(log.entries.at(-1)).toMatchObject({
    role: "assistant",
    content: "任务已完成",
  });
});

it("uploads exact file bytes, sends files without text, exposes their paths to the model and cleans up on delete", async () => {
  harness = await startTestKernel({ answers: [{ text: ["收到文件"] }] });
  const client = new KernelClient({ baseUrl: harness.kernel.url });
  const session = await client.createSession({ workspace: harness.workspace });
  const bytes = new Uint8Array([0, 1, 255, 13, 10]);
  const [text, binary] = await Promise.all([
    client.uploadAttachment(
      session.id,
      new File(["中文内容\n第二行"], "需求.md", { type: "text/markdown" }),
    ),
    client.uploadAttachment(session.id, new File([bytes], "attachment.json")),
  ]);
  expect(await readFile(text.path, "utf8")).toBe("中文内容\n第二行");
  expect(await readFile(binary.path)).toEqual(Buffer.from(bytes));
  await client.sendMessage(session.id, "", [text.id, binary.id]);
  await harness.kernel.kernel.ctx.tasks.settle(session.id);
  const log = await client.readSession(session.id);
  expect(log.entries[0]).toMatchObject({
    role: "user",
    content: "",
    attachments: [text, binary],
  });
  const content = harness.model.requests[0]?.messages.find(
    (message) => message.role === "user",
  )?.content;
  expect(content).toContain(text.path);
  expect(content).toContain("需求.md");
  await client.deleteSession(session.id);
  await expect(stat(text.path)).rejects.toMatchObject({ code: "ENOENT" });
});

it("sends image content through tool rounds, restored history and compaction without persisting base64", async () => {
  harness = await startTestKernel({
    answers: [
      { toolCalls: [{ id: "image-check", name: "echo", arguments: '{"text":"ok"}' }] },
      { text: ["收到图片"] },
      { text: ["继续查看图片"] },
      { text: ["SUMMARY: 已查看截图"] },
    ],
    compaction: { triggerTokens: 100_000, keepTokens: 1 },
  });
  const client = new KernelClient({ baseUrl: harness.kernel.url });
  const session = await client.createSession({ workspace: harness.workspace });
  const bytes = Buffer.from(PNG_BASE64, "base64");
  const attachments = await Promise.all([
    client.uploadAttachment(
      session.id,
      new File([bytes], "截图.png", { type: "image/png" }),
    ),
    client.uploadAttachment(session.id, new File([bytes], "同一截图.PNG")),
  ]);
  await client.sendMessage(
    session.id,
    "",
    attachments.map((file) => file.id),
  );
  await harness.kernel.kernel.ctx.tasks.settle(session.id);

  // A subsequent turn rebuilds the image references from the stored session log.
  await client.sendMessage(session.id, "接着分析");
  await harness.kernel.kernel.ctx.tasks.settle(session.id);
  expect(harness.model.requests).toHaveLength(3);
  await client.compactSession(session.id);
  expect(harness.model.requests).toHaveLength(4);
  expect(harness.model.requests[3]?.tools).toBeUndefined();

  for (const request of harness.model.requests) {
    const content = request.messages.find(
      (message) => message.role === "user",
    )?.content;
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) throw new Error("Expected image content blocks");
    expect(content.filter((part) => part.type === "image_url")).toEqual([
      { type: "image_url", image_url: { url: `data:image/png;base64,${PNG_BASE64}` } },
      { type: "image_url", image_url: { url: `data:image/png;base64,${PNG_BASE64}` } },
    ]);
  }
  const log = await client.readSession(session.id);
  expect(log.entries[0]).toMatchObject({ role: "user", content: "", attachments });
  expect(JSON.stringify(log.entries)).not.toContain(PNG_BASE64);
  expect(
    rebuildContext(log.entries).some((message) => message.attachments !== undefined),
  ).toBe(false);
});

it.each(["missing file", "provider rejection"])(
  "reports image input failure to the conversation: %s",
  async (failure) => {
    harness = await startTestKernel({ answers: [{ status: 400 }] });
    const client = new KernelClient({ baseUrl: harness.kernel.url });
    const session = await client.createSession({ workspace: harness.workspace });
    const attachment = await client.uploadAttachment(
      session.id,
      new File([Buffer.from(PNG_BASE64, "base64")], "截图.png", { type: "image/png" }),
    );
    if (failure === "missing file") await rm(attachment.path);
    await client.sendMessage(session.id, "分析这张图", [attachment.id]);
    await harness.kernel.kernel.ctx.tasks.settle(session.id);
    const log = await client.readSession(session.id);
    expect(log.entries).toHaveLength(2);
    expect(log.entries.at(-1)).toMatchObject({
      type: "message",
      role: "system",
      content: expect.stringContaining(
        failure === "missing file" ? "Could not read attached image" : "HTTP 400",
      ),
    });
    expect(harness.model.requests).toHaveLength(failure === "missing file" ? 0 : 1);
  },
);

it("rejects foreign attachments, invalid filenames and oversized uploads without creating messages", async () => {
  harness = await startTestKernel();
  const client = new KernelClient({ baseUrl: harness.kernel.url });
  const session = await client.createSession({ workspace: harness.workspace });
  const other = await client.createSession({ workspace: harness.workspace });
  const attachment = await client.uploadAttachment(other.id, new File(["x"], "x.txt"));
  await expect(
    client.sendMessage(session.id, "", [attachment.id]),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  await expect(
    client.uploadAttachment(session.id, new File(["x"], "../x.txt")),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  await expect(client.sendMessage(session.id, "", [])).rejects.toMatchObject({
    code: "INVALID_REQUEST",
  });
  const oversized = new File([new Uint8Array(20 * 1024 * 1024 + 1)], "large.bin");
  await expect(client.uploadAttachment(session.id, oversized)).rejects.toMatchObject({
    code: "INVALID_REQUEST",
  });
  expect((await client.readSession(session.id)).entries).toEqual([]);
});

it("runs an interactive shell in the workspace, reuses its state and replays output after reconnecting", async () => {
  harness = await startTestKernel();
  const client = new KernelClient({ baseUrl: harness.kernel.url });
  const terminal = await client.openTerminal(harness.workspace, 80, 24);
  const controller = new AbortController();
  let output = "";
  const reading = client
    .readTerminal(
      terminal.id,
      (event) => {
        if (event.type === "data") output += event.data;
      },
      controller.signal,
    )
    .catch((error) => {
      if (!controller.signal.aborted) throw error;
    });
  try {
    const windows = process.platform === "win32";
    await client.writeTerminal(
      terminal.id,
      windows ? "Write-Output (Get-Location).Path\r" : "pwd\r",
    );
    await expect.poll(() => output, { timeout: 10_000 }).toContain(harness.workspace);
    await client.writeTerminal(
      terminal.id,
      windows
        ? "$env:PRISM_TERMINAL_CHECK='persisted'\r"
        : "export PRISM_TERMINAL_CHECK=persisted\r",
    );
    await client.resizeTerminal(terminal.id, 100, 30);
    expect(await client.openTerminal(harness.workspace, 100, 30)).toEqual(terminal);
    await client.writeTerminal(
      terminal.id,
      windows
        ? "Write-Output ('result:' + $env:PRISM_TERMINAL_CHECK)\r"
        : "printf 'result:%s\\n' \"$PRISM_TERMINAL_CHECK\"\r",
    );
    await expect.poll(() => output, { timeout: 10_000 }).toContain("result:persisted");
  } finally {
    controller.abort();
    await reading;
  }
  const reconnect = new AbortController();
  let replay = "";
  const reconnected = client
    .readTerminal(
      terminal.id,
      (event) => {
        if (event.type === "data") {
          replay += event.data;
          reconnect.abort();
        }
      },
      reconnect.signal,
    )
    .catch((error) => {
      if (!reconnect.signal.aborted) throw error;
    });
  await reconnected;
  expect(replay).toContain("result:persisted");
  await expect(
    client.openTerminal(`${harness.workspace}/missing`, 80, 24),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  await expect(client.resizeTerminal(terminal.id, -1, 24)).rejects.toMatchObject({
    code: "INVALID_REQUEST",
  });
});
