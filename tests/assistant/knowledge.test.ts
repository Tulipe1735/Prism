import type { Document } from "../../src/assistant/types.ts";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { KnowledgeLibrary } from "../../src/assistant/library.ts";
import { AssistantStore } from "../../src/assistant/store.ts";

const directories: string[] = [];
const stores: AssistantStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
});
function directory(): string {
  const path = mkdtempSync(join(tmpdir(), "prism-library-"));
  directories.push(path);
  return path;
}
function open(
  path = directory(),
  options?: ConstructorParameters<typeof AssistantStore>[1],
): AssistantStore {
  const store = new AssistantStore(path, options);
  stores.push(store);
  return store;
}
const note: Document = {
  id: "notion:research",
  source: "notion",
  title: "递归自我改进研究",
  url: "https://www.notion.so/research",
  content: "# 研究进展\n\n递归自我改进依赖可核查的反馈。工具调用需要独立的执行回执。",
  version: "revision-1",
  updatedAt: "2026-10-18T02:00:00.000Z",
};

it("资料副本在重启后保持来源、版本及可阅读的 Markdown 产物", () => {
  const path = directory();
  const store = open(path);
  store.upsertDocument(note);
  store.close();
  const restarted = open(path);
  expect(restarted.getDocument(note.id)).toMatchObject(note);
  expect(readFileSync(restarted.documentPath(note.id), "utf8")).toContain(note.content);
  expect(readFileSync(restarted.documentPath(note.id), "utf8")).toContain(note.url);
});

it("中文问题能检索资料原文位置，资料修改后不会继续引用旧版本", () => {
  const store = open();
  store.upsertDocument(note);
  store.upsertDocument({
    ...note,
    id: "unrelated",
    title: "数据库课程",
    content: "事务提供原子性。",
  });
  expect(store.search("递归自我改进")).toEqual([
    expect.objectContaining({
      documentId: note.id,
      url: note.url,
      version: "revision-1",
      locator: "lines 1-3",
      excerpt: expect.stringContaining("可核查的反馈"),
    }),
  ]);
  store.upsertDocument({
    ...note,
    title: "新版研究",
    content: "# 新记录\n\n当前关注具身规划。",
    version: "revision-2",
  });
  expect(store.search("递归自我改进")).toEqual([]);
  expect(store.search("具身规划")[0]).toMatchObject({
    documentId: note.id,
    version: "revision-2",
  });
});

it("共享研究状态持久化且拒绝覆盖过期版本，撤回资料后派生进展待复核", () => {
  const path = directory();
  const store = open(path, { now: () => new Date("2026-10-18T03:00:00Z") });
  store.upsertDocument(note);
  store.upsertMemory({
    id: "focus",
    kind: "progress",
    text: "已确认研究反馈机制",
    status: "confirmed",
    sourceDocumentIds: [note.id],
    createdAt: note.updatedAt,
    updatedAt: note.updatedAt,
  });
  const concurrent = open(path);
  const version = concurrent.listMemory()[0]!;
  store.upsertMemory(
    { ...version, text: "用户纠正：先比较工具执行反馈" },
    version.updatedAt,
  );
  expect(() =>
    concurrent.upsertMemory(
      { ...version, text: "覆盖另一个角色的进展" },
      version.updatedAt,
    ),
  ).toThrow(/conflict/i);
  store.removeDocument(note.id);
  expect(concurrent.getDocument(note.id)).toBeUndefined();
  expect(concurrent.search("自我改进")).toEqual([]);
  expect(existsSync(store.documentPath(note.id))).toBe(false);
  expect(concurrent.listMemory()[0]).toMatchObject({
    text: "用户纠正：先比较工具执行反馈",
    status: "tentative",
    sourceDocumentIds: [note.id],
  });
  store.close();
  const restarted = open(path);
  expect(restarted.listMemory()[0]?.status).toBe("tentative");
  restarted.deleteMemory("focus");
  expect(restarted.listMemory()).toEqual([]);
});

it("同一消息只生成一个任务且只有一个执行者领取，进度和结果跨重启保留", () => {
  const path = directory();
  const first = open(path);
  const second = open(path);
  const task = first.createTask({
    id: "event-1",
    message: "比较反馈方法",
    conversationId: "chat-1",
    role: "qa",
    effort: "deep",
  });
  expect(second.createTask({ id: "event-1", message: "比较反馈方法" }).id).toBe(
    task.id,
  );
  expect(first.claimTask(task.id)).toBe(true);
  expect(second.claimTask(task.id)).toBe(false);
  first.appendEvent(task.id, {
    at: note.updatedAt,
    kind: "source",
    message: "已找到原始资料",
  });
  second.updateTask(task.id, {
    status: "completed",
    answer: "方法对比结果",
    costCny: 0.02,
  });
  first.close();
  const restarted = open(path);
  expect(restarted.listTasks()).toHaveLength(1);
  expect(restarted.getTask(task.id)).toMatchObject({
    status: "completed",
    answer: "方法对比结果",
    role: "qa",
    effort: "deep",
    conversationId: "chat-1",
    events: [{ message: "已找到原始资料" }],
  });
});

it("多个执行者共享月度费用上限，预占跨重启保留且按原月份结算", () => {
  const path = directory();
  let now = new Date("2026-10-31T15:00:00.000Z");
  const first = open(path, { now: () => now, budgetCny: 50, infrastructureCny: 20 });
  const second = open(path, { now: () => now });
  expect(first.reserveBudget("task-a", 20)).toBe(true);
  expect(second.reserveBudget("task-b", 11)).toBe(false);
  expect(second.reserveBudget("task-b", 10)).toBe(true);
  first.settleBudget("task-a", 15);
  expect(second.budget()).toMatchObject({
    month: "2026-10",
    spentCny: 15,
    reservedCny: 10,
    availableCny: 5,
  });
  second.close();
  const restarted = open(path, { now: () => now });
  expect(restarted.budget().reservedCny).toBe(10);
  now = new Date("2026-10-31T16:00:00.000Z");
  restarted.settleBudget("task-b", 8);
  expect(restarted.budget()).toMatchObject({
    month: "2026-11",
    spentCny: 0,
    reservedCny: 0,
    availableCny: 30,
  });
  now = new Date("2026-10-31T15:30:00.000Z");
  expect(first.budget()).toMatchObject({
    spentCny: 23,
    reservedCny: 0,
    availableCny: 7,
  });
  expect(first.reserveBudget("task-c", 7)).toBe(true);
  first.releaseReservation("task-c");
  expect(first.budget().availableCny).toBe(7);
});

it("晨报只允许一次发送领取，结果未知时重启也不会重复发送", () => {
  const path = directory();
  const first = open(path);
  const second = open(path);
  expect(first.claimDelivery("brief:2026-10-18", "")).toBe(true);
  expect(first.beginDelivery("brief:2026-10-18")).toBe(false);
  first.updateDelivery("brief:2026-10-18", { body: "今天值得读：反馈机制综述" });
  expect(second.claimDelivery("brief:2026-10-18", "重复晨报")).toBe(false);
  expect(first.beginDelivery("brief:2026-10-18")).toBe(true);
  expect(second.beginDelivery("brief:2026-10-18")).toBe(false);
  expect(second.getDelivery("brief:2026-10-18")?.status).toBe("unknown");
  expect(() =>
    first.updateDelivery("brief:2026-10-18", { body: "更改未知交付内容" }),
  ).toThrow(/content/i);
  first.close();
  const restarted = open(path);
  expect(restarted.beginDelivery("brief:2026-10-18")).toBe(false);
  restarted.updateDelivery("brief:2026-10-18", {
    status: "sent",
    providerId: "message-1",
  });
  expect(restarted.listDeliveries()).toEqual([
    expect.objectContaining({
      status: "sent",
      body: "今天值得读：反馈机制综述",
      providerId: "message-1",
    }),
  ]);
});

it("本地关键提交在准确内容获批前不交给设备，任务和回执不会重复领取", () => {
  const path = directory();
  const first = open(path);
  const second = open(path);
  const task = first.createTask({ id: "portal-query", message: "准备课程查询" });
  first.updateTask(task.id, { status: "waiting-device" });
  const command = {
    prism: { command: "act", target: "observed-ref" },
    approved: false,
    summary: "提交已核对的课程请求",
  };
  const job = first.enqueueLocal(task.id, command);
  expect(second.enqueueLocal(task.id, command).id).toBe(job.id);
  expect(second.claimLocal("laptop")).toBeUndefined();
  first.approveLocal(job.id);
  expect(second.claimLocal("laptop")).toMatchObject({
    id: job.id,
    status: "claimed",
    command: { approved: true, prism: command.prism },
  });
  expect(first.claimLocal("other-device")).toBeUndefined();
  second.completeLocal(job.id, { receipt: { outcome: "unknown" } }, "unknown");
  first.close();
  const restarted = open(path);
  expect(restarted.getLocalJob(job.id)).toMatchObject({
    status: "unknown",
    workerId: "laptop",
    result: { receipt: { outcome: "unknown" } },
  });
  expect(restarted.claimLocal("laptop")).toBeUndefined();
});

it("过期深入任务不能领取模型循环、本地操作或新的用户批准", () => {
  let time = new Date("2026-10-18T02:00:00Z");
  const store = open(directory(), { now: () => time });
  const task = store.createTask({ message: "核对课程证据", effort: "deep" });
  store.updateTask(task.id, { deadlineAt: "2026-10-18T02:20:00Z" });
  const job = store.enqueueLocal(task.id, {
    approved: false,
    prism: { command: "act", request_id: "deadline-request" },
  });
  store.updateTask(task.id, { status: "waiting-device" });
  time = new Date("2026-10-18T02:20:01Z");
  expect(() => store.approveLocal(job.id)).toThrow(/deadline|expired/i);
  expect(store.claimLocal("late-pc")).toBeUndefined();
  store.updateTask(task.id, { status: "queued" });
  expect(store.claimTask(task.id)).toBe(false);
});

it("手动导入 Markdown 保留原文件引用，重复导入只更新同一份资料副本", async () => {
  const store = open();
  const library = new KnowledgeLibrary(store);
  const file = join(directory(), "研究笔记.md");
  writeFileSync(file, "# 反馈研究\n\n先检查工具回执。\n\n[原始附件](./实验报告.pdf)");
  const imported = await library.importFile(file);
  expect(imported).toMatchObject({
    source: "file",
    title: "反馈研究",
    metadata: {
      format: "markdown",
      parseStatus: "parsed",
      references: [{ url: "./实验报告.pdf", status: "not-read" }],
    },
  });
  expect(store.search("工具回执")[0]).toMatchObject({
    documentId: imported.id,
    url: imported.url,
    locator: "lines 1-5",
  });
  writeFileSync(file, "# 新的重点\n\n现在比较奖励设计。");
  const updated = await library.importFile(file);
  expect(updated.id).toBe(imported.id);
  expect(updated.version).not.toBe(imported.version);
  expect(store.listDocuments()).toHaveLength(1);
  expect(store.search("工具回执")).toEqual([]);
  expect(readFileSync(store.documentPath(updated.id), "utf8")).toContain(
    "现在比较奖励设计",
  );
});

it("可提取文本的 PDF 进入资料库并定位到原始页码", async () => {
  const store = open();
  const file = join(directory(), "methods.pdf");
  writeFileSync(
    file,
    pdf([
      "Agent feedback uses verified execution evidence.",
      "Course registration does not prove mastery.",
    ]),
  );
  const document = await new KnowledgeLibrary(store).importFile(file);
  expect(document.metadata).toMatchObject({
    format: "pdf",
    parseStatus: "parsed",
    pageCount: 2,
  });
  expect(store.search("feedback")[0]).toMatchObject({
    documentId: document.id,
    locator: expect.stringContaining("page 1"),
    excerpt: expect.stringContaining("verified execution evidence"),
  });
  expect(store.search("mastery")[0]?.locator).toContain("page 2");
});

it("没有文本的 PDF 明确标记未读取，不能生成伪造正文引用", async () => {
  const store = open();
  const file = join(directory(), "feedback.pdf");
  writeFileSync(file, pdf([""]));
  const document = await new KnowledgeLibrary(store).importFile(file);
  expect(document).toMatchObject({
    content: "",
    metadata: {
      format: "pdf",
      parseStatus: "unreadable",
      unreadPages: [1],
      warnings: [expect.stringContaining("OCR was not performed")],
    },
  });
  expect(store.search("feedback")).toEqual([]);
});

it("DOCX 简历可以导入并引用个人原文而不自动生成学习证据", async () => {
  const store = open();
  const file = join(directory(), "resume.docx");
  // A minimal OOXML document containing two Chinese paragraphs, not a parser mock.
  writeFileSync(
    file,
    Buffer.from(
      "UEsDBBQAAAAIAEVQUl3MVIwQ4AAAAJwBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2Qy07DMBBFf8XyFsUTukAIJekCyhJYlA+w7Eli4Zc8bil/z6QtXaDC0r6PM7rd+hC82GMhl2Ivb1UrBUaTrItTL9+3z829XA/d9isjCbZG6uVca34AIDNj0KRSxsjKmErQlZ9lgqzNh54QVm17BybFirE2demQQ/eEo975KjYH/j5hC3qS4vFkXFi91Dl7Z3RlHfbR/qI0Z4Li5NFDs8t0wwYJVwmL8jfgnHvlHYqzKN50qS86sAs+U7Fgk9kFTqr/a67cmcbRGbzkl7ZckkEiHjh4dVGCdvHnfjjOPXwDUEsDBBQAAAAIAEVQUl02V97cogAAABgBAAALAAAAX3JlbHMvLnJlbHONzzsOwjAMBuCrRN6pCwNCqGkXhNQVlQNEiZtGNA8l4XV7MjBQxMBo+/dnuekedmY3isl4x2Fd1cDISa+M0xzOw3G1g65tTjSLXBJpMiGxsuIShynnsEdMciIrUuUDuTIZfbQilzJqDEJehCbc1PUW46cBS5P1ikPs1RrY8Az0j+3H0Ug6eHm15PKPE1+JIouoKXO4+6hQvdtVYQHbBhcvti9QSwMEFAAAAAgARVBSXfcb1DALAQAARQEAABEAAAB3b3JkL2RvY3VtZW50LnhtbLOxr8jNUShLLSrOzM+zVTLUM1BSSM1Lzk/JzEu3VQoNcdO1ULK3sym3SslPLs1NzStRAKrPK7Yqt1XKKCkpsNLXL07OSM1NLNbLL0jNA8ql5RflJpYAuUXp+uX5RSkFRfnJqcXFQONyc/SNDAzM9HMTM/OUQEYm5adUgugCEFEEIkrsnuxY9WTXrufrGp72tb3fM+vpunnP+zY829r/YnnH05krnnUuf7Gw5+n2pU9btz/Z0fe0f/2L5U3PtnY/a1j+uKHJRh9kAogsApMF6Ia/XLjz+ex1z3f3Aw1/sqP3Rfuqp10rXqxvfDaj71lfz7P+hU9bV7xsXvGsq+HZnPXYDdSHOVsfESR2AFBLAQIUAxQAAAAIAEVQUl3MVIwQ4AAAAJwBAAATAAAAAAAAAAAAAACAAQAAAABbQ29udGVudF9UeXBlc10ueG1sUEsBAhQDFAAAAAgARVBSXTZX3tyiAAAAGAEAAAsAAAAAAAAAAAAAAIABEQEAAF9yZWxzLy5yZWxzUEsBAhQDFAAAAAgARVBSXfcb1DALAQAARQEAABEAAAAAAAAAAAAAAIAB3AEAAHdvcmQvZG9jdW1lbnQueG1sUEsFBgAAAAADAAMAuQAAABYDAAAAAA==",
      "base64",
    ),
  );
  const document = await new KnowledgeLibrary(store).importFile(file);
  expect(document).toMatchObject({
    metadata: { format: "docx", parseStatus: "parsed" },
    content: expect.stringContaining("个人简历：实现浏览器执行工具与可观测性。"),
  });
  expect(store.search("浏览器执行")[0]).toMatchObject({
    documentId: document.id,
    locator: expect.stringMatching(/^lines /),
  });
  expect(store.listMemory()).toEqual([]);
});

it("独立进程同时申请模型费用也不能突破同一份月度余额", async () => {
  const path = directory();
  const store = open(path, { budgetCny: 50, infrastructureCny: 20 });
  const workers = [budgetWorker(path, "parallel-a"), budgetWorker(path, "parallel-b")];
  try {
    await Promise.all(workers.map((worker) => worker.ready));
    for (const worker of workers) worker.start();
    expect((await Promise.all(workers.map((worker) => worker.done))).sort()).toEqual([
      false,
      true,
    ]);
    expect(store.budget()).toMatchObject({ reservedCny: 20, availableCny: 10 });
  } finally {
    for (const worker of workers) worker.kill();
  }
});

it("长段落检索只交付相关的有界引用，不把整份资料灌入任务", () => {
  const store = open();
  store.upsertDocument({
    ...note,
    title: "方法笔记",
    content: `${"背景材料。".repeat(1000)}独立回执可以验证浏览器输入。`,
  });
  const citation = store.search("独立回执")[0]!;
  expect(citation).toMatchObject({
    locator: "lines 1-1",
    excerpt: expect.stringContaining("独立回执"),
  });
  expect(citation.excerpt.length).toBeLessThanOrEqual(1600);
});

it("已报告费用高于预占时仍记账，后续预占必须按真实余额收紧", () => {
  const store = open(undefined, { budgetCny: 50, infrastructureCny: 20 });
  expect(store.reserveBudget("first", 10)).toBe(true);
  expect(store.reserveBudget("second", 20)).toBe(true);
  store.settleBudget("first", 25);
  expect(store.budget()).toMatchObject({
    spentCny: 25,
    reservedCny: 20,
    availableCny: 0,
  });
  expect(store.reserveBudget("second", 10)).toBe(false);
  expect(store.reserveBudget("second", 5)).toBe(true);
  expect(store.budget()).toMatchObject({
    spentCny: 25,
    reservedCny: 5,
    availableCny: 0,
  });
});

it("取消任务后，已排队的本地操作不能获批或被设备领取", () => {
  const store = open();
  const task = store.createTask({ message: "查询课程" });
  store.updateTask(task.id, { status: "waiting-device" });
  const job = store.enqueueLocal(task.id, {
    prism: { command: "observe" },
    approved: false,
  });
  store.approveLocal(job.id);
  store.updateTask(task.id, { status: "cancelled" });
  expect(store.claimLocal("laptop")).toBeUndefined();
  expect(() => store.approveLocal(job.id)).toThrow(/task/i);
  expect(store.getLocalJob(job.id)?.status).toBe("pending");
});

it("重启恢复中断模型请求时将未知用量按预占上界结算，重复恢复不重复扣费", () => {
  const path = directory();
  const store = open(path, { budgetCny: 50, infrastructureCny: 20 });
  store.reserveBudget("interrupted", 3);
  store.close();
  const restarted = open(path);
  expect(restarted.settleInterruptedBudget("interrupted")).toBe(3);
  expect(restarted.settleInterruptedBudget("interrupted")).toBe(0);
  expect(restarted.budget()).toMatchObject({
    spentCny: 3,
    reservedCny: 0,
    availableCny: 27,
  });
});

function budgetWorker(path: string, taskId: string) {
  const module = new URL("../../src/assistant/store.ts", import.meta.url).href;
  const script = `
    import {AssistantStore} from ${JSON.stringify(module)};
    const store = new AssistantStore(process.argv[1]);
    console.log('ready');
    process.stdin.once('data', () => {
      console.log(JSON.stringify(store.reserveBudget(process.argv[2], 20)));
      store.close();
      process.stdin.destroy();
    });
  `;
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script, path, taskId],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let output = "";
  let error = "";
  let ready!: () => void;
  const readiness = new Promise<void>((resolve) => {
    ready = resolve;
  });
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
    if (output.includes("ready\n")) ready();
  });
  child.stderr.on("data", (chunk) => {
    error += chunk.toString();
  });
  const done = new Promise<boolean>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      ready();
      if (code !== 0) reject(new Error(error || `Budget worker exited ${code}`));
      else resolve(JSON.parse(output.trim().split("\n").at(-1)!));
    });
  });
  return {
    ready: readiness,
    done,
    start: () => child.stdin.write("go\n"),
    kill: () => child.kill(),
  };
}

function pdf(pages: string[]): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (const [index, text] of pages.entries()) {
    const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
    );
    objects.push(
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    );
  }
  let result = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(result));
    result += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(result);
  result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    result += `${String(offset).padStart(10, "0")} 00000 n \n`;
  return Buffer.from(
    `${result}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  );
}
