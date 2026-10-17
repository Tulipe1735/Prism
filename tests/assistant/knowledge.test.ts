import type { Document } from "../../src/assistant/types.ts";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
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

test("资料副本在重启后保持来源、版本及可阅读的 Markdown 产物", () => {
  const path = directory();
  const store = open(path);
  store.upsertDocument(note);
  store.close();
  const restarted = open(path);
  expect(restarted.getDocument(note.id)).toMatchObject(note);
  expect(readFileSync(restarted.documentPath(note.id), "utf8")).toContain(note.content);
  expect(readFileSync(restarted.documentPath(note.id), "utf8")).toContain(note.url);
});

test("中文问题能检索资料原文位置，资料修改后不会继续引用旧版本", () => {
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

test("共享研究状态持久化且拒绝覆盖过期版本，撤回资料后派生进展待复核", () => {
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

test("同一消息只生成一个任务且只有一个执行者领取，进度和结果跨重启保留", () => {
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

test("多个执行者共享月度费用上限，预占跨重启保留且按原月份结算", () => {
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

test("晨报只允许一次发送领取，结果未知时重启也不会重复发送", () => {
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

test("本地关键提交在准确内容获批前不交给设备，任务和回执不会重复领取", () => {
  const path = directory();
  const first = open(path);
  const second = open(path);
  const task = first.createTask({ id: "portal-query", message: "准备课程查询" });
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
