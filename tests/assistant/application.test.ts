import type { Model, ModelMessage, ToolDefinition } from "../../src/assistant/types.ts";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { courseMaterials } from "../../src/assistant/courses.ts";
import { createAssistantServer } from "../../src/assistant/http.ts";
import { AssistantRuntime } from "../../src/assistant/runtime.ts";
import { assistantTools, PersonalAssistant } from "../../src/assistant/service.ts";
import { AssistantStore } from "../../src/assistant/store.ts";

const directories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const path of directories.splice(0))
    await rm(path, { recursive: true, force: true });
});

it("prepares a sourced morning brief, delivers at Shanghai ten, and does not resend after restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "prism-assistant-app-"));
  directories.push(directory);
  let time = new Date("2026-10-18T01:40:00Z");
  const now = () => time;
  const store = new AssistantStore(directory, { now });
  const runtime = new AssistantRuntime({
    store,
    now,
    model: {
      complete: async () => ({
        message: {
          role: "assistant",
          content: JSON.stringify({
            items: [
              {
                documentId: "github:example/agent",
                reason: "工具使用与当前浏览器执行项目有关",
                takeaway: "提供可读的工具执行反馈与评测样例",
                connection: "可对照 Prism 的任务结果与输入回执边界",
              },
            ],
          }),
        },
        usage: { inputTokens: 100, outputTokens: 80 },
      }),
    },
  });
  const delivered: string[] = [];
  const app = new PersonalAssistant({
    store,
    runtime,
    now,
    sources: {
      trending: {
        collect: async () => [
          {
            id: "github:example/agent",
            source: "github" as const,
            title: "example/agent",
            url: "https://github.com/example/agent",
            content: "Agent tool feedback and evaluation",
            updatedAt: now().toISOString(),
          },
        ],
      },
    },
    send: async (body) => {
      delivered.push(body);
      return { id: "message-1" };
    },
  });
  await app.tick();
  expect(delivered).toEqual([]);
  time = new Date("2026-10-18T02:00:00Z");
  await app.tick();
  expect(delivered).toHaveLength(1);
  expect(delivered[0]).toContain("https://github.com/example/agent");
  expect(delivered[0]).toContain("Prism");
  store.close();
  const reopened = new AssistantStore(directory, { now });
  const next = new PersonalAssistant({
    store: reopened,
    runtime,
    now,
    sources: {},
    send: async (body) => {
      delivered.push(body);
      return { id: "message-2" };
    },
  });
  await next.tick();
  expect(delivered).toHaveLength(1);
  reopened.close();
});

async function workspace() {
  const directory = await mkdtemp(join(tmpdir(), "prism-assistant-app-"));
  directories.push(directory);
  return new AssistantStore(directory);
}
const project = () => ({
  id: "github:example/agent",
  source: "github" as const,
  title: "example/agent",
  url: "https://github.com/example/agent",
  content: "Agent tool feedback and evaluation",
  updatedAt: new Date().toISOString(),
});
const selection = {
  items: [
    {
      documentId: "github:example/agent",
      takeaway: "执行反馈",
      reason: "有可检查的实现",
      connection: "支持Prism研究",
    },
  ],
};
const staticModel = (content: unknown): Model => ({
  complete: async () => ({
    message: { role: "assistant", content: JSON.stringify(content) },
    usage: { inputTokens: 100, outputTokens: 80 },
  }),
});

it("observes fresh portal state after an approved action even when the observation command repeats", async () => {
  const store = await workspace();
  const observe = { command: "observe", session: "portal", scope: "local" };
  const action = {
    command: "act",
    session: "portal",
    observation: "o1",
    target: "t1",
    evidence: "e1",
    operation: "click",
    request_id: "open-courses",
  };
  const commands = [observe, action, observe];
  let round = 0;
  const runtime = new AssistantRuntime({
    store,
    tools: assistantTools(store, {}),
    model: {
      complete: async () => ({
        message:
          round < commands.length
            ? {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: `portal-${round}`,
                    type: "function",
                    function: {
                      name: "local_prism",
                      arguments: JSON.stringify({
                        command: commands[round++],
                        summary: "核对门户课表",
                      }),
                    },
                  },
                ],
              }
            : { role: "assistant", content: "已通过新的观察核对课表。" },
        usage: { inputTokens: 10, outputTokens: 10 },
      }),
    },
  });
  const app = new PersonalAssistant({ store, runtime, sources: {} });
  const task = app.submit({ message: "打开课表并核对课程" });
  await app.drain();
  const first = store.claimLocal("pc")!;
  expect(first.command.prism).toEqual(observe);
  await app.completeLocal(first.id, { observation: "o1" });
  const pending = store
    .getTask(task.id)!
    .messages!.filter((m) => m.role === "tool")
    .map((m) => JSON.parse(m.content!))
    .at(-1);
  app.approve(pending.jobId);
  const click = store.claimLocal("pc")!;
  await app.completeLocal(click.id, { receipt: { outcome: "executed" } });
  const second = store.claimLocal("pc");
  expect(second).toMatchObject({ status: "claimed", command: { prism: observe } });
  expect(second?.id).not.toBe(first.id);
  await app.completeLocal(second!.id, { observation: "o2", courses: ["操作系统"] });
  expect(store.getTask(task.id)).toMatchObject({
    status: "completed",
    answer: "已通过新的观察核对课表。",
  });
  await app.drain();
  store.close();
});

it.each(["completed", "unknown", "failed"] as const)(
  "returns the saved %s action outcome on the same request without waiting or replaying",
  async (status) => {
    const store = await workspace();
    const command = {
      command: "act",
      session: "portal",
      observation: "o1",
      target: "t1",
      evidence: "e1",
      operation: "click",
      request_id: "open-courses",
    };
    let round = 0;
    const model: Model = {
      complete: async (messages) => ({
        message:
          ++round <= 2
            ? {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: `action-${round}`,
                    type: "function",
                    function: {
                      name: "local_prism",
                      arguments: JSON.stringify({
                        command,
                        summary: round === 1 ? "打开课表" : "核对刚才的打开课表动作",
                      }),
                    },
                  },
                ],
              }
            : {
                role: "assistant",
                content: messages.filter((m) => m.role === "tool").at(-1)!.content,
              },
        usage: { inputTokens: 10, outputTokens: 10 },
      }),
    };
    const runtime = new AssistantRuntime({
      store,
      model,
      tools: assistantTools(store, {}),
    });
    const app = new PersonalAssistant({ store, runtime, sources: {} });
    const task = app.submit({ message: "打开课表后核对动作回执" });
    await app.drain();
    const pending = store
      .getTask(task.id)!
      .messages!.filter((m) => m.role === "tool")
      .map((m) => JSON.parse(m.content!))
      .at(-1);
    app.approve(pending.jobId);
    const job = store.claimLocal("pc")!;
    const savedResult = { receipt: { outcome: status }, marker: "saved-original" };
    await app.completeLocal(job.id, savedResult, status);
    const final = store.getTask(task.id)!;
    expect(final.status).toBe("completed");
    expect(JSON.parse(final.answer)).toMatchObject({
      status,
      result: savedResult,
      jobId: job.id,
    });
    expect(store.claimLocal("pc")).toBeUndefined();
    await app.drain();
    store.close();
  },
);

it("confirms the exact local action through the CLI without model credentials and makes the parent claimable", async () => {
  const store = await workspace();
  const task = store.createTask({ message: "确认后打开课程页" });
  const command = {
    command: "act",
    session: "portal",
    observation: "o1",
    target: "t1",
    evidence: "e1",
    operation: "click",
    request_id: "cli-confirm",
  };
  const job = store.enqueueLocal(task.id, {
    prism: command,
    approved: false,
    summary: "打开课程页",
  });
  store.updateTask(task.id, { status: "awaiting-confirmation" });
  await promisify(execFile)(
    process.execPath,
    [
      "--experimental-strip-types",
      fileURLToPath(new URL("../../src/assistant/cli.ts", import.meta.url)),
      "confirm",
      job.id,
    ],
    { env: { ASSISTANT_DATA_DIR: store.directory } },
  );
  expect(store.getTask(task.id)?.status).toBe("waiting-device");
  expect(store.claimLocal("pc")).toMatchObject({
    id: job.id,
    command: { approved: true, prism: command },
  });
  store.close();
});

it("ends a paused deep task at its original deadline and delivers the saved result without new model work", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-18T02:00:00Z"));
  const store = await workspace();
  const delivered: string[] = [];
  const task = store.createTask({
    message: "研究过程中核对本地课程",
    effort: "deep",
    source: "feishu:qa:owner",
  });
  store.updateTask(task.id, {
    status: "waiting-device",
    deadlineAt: "2026-10-18T02:20:00Z",
    answer: "已核查原始论文，等待课程证据；当前成果仍有缺口。",
  });
  const model: Model = {
    complete: async () => {
      throw new Error("Expired tasks must not start model work");
    },
  };
  const runtime = new AssistantRuntime({ store, model });
  const app = new PersonalAssistant({
    store,
    runtime,
    sources: {},
    send: async (body) => {
      delivered.push(body);
      return { id: "expired-result" };
    },
  });
  app.recover();
  await vi.advanceTimersByTimeAsync(20 * 60_000);
  await app.drain();
  expect(store.getTask(task.id)).toMatchObject({
    status: "partial",
    deadlineAt: "2026-10-18T02:20:00Z",
    answer: expect.stringContaining("已核查原始论文"),
  });
  expect(delivered).toHaveLength(1);
  expect(delivered[0]).toContain("partial");
  expect(delivered[0]).toContain("已核查原始论文");
  store.close();
});

it("restores the original deep deadline after a real device pause and restart", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-18T02:00:00Z"));
  let store = await workspace();
  const directory = store.directory;
  const bodies: string[] = [];
  let requests = 0;
  const model: Model = {
    complete: async () => {
      requests++;
      return {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "local",
              type: "function",
              function: {
                name: "local_prism",
                arguments: JSON.stringify({
                  command: { command: "observe", session: "portal", scope: "local" },
                  summary: "核对课程",
                }),
              },
            },
          ],
        },
        usage: { inputTokens: 10, outputTokens: 10 },
      };
    },
  };
  const send = async (body: string) => {
    bodies.push(body);
    return { id: `delivery-${bodies.length}` };
  };
  const runtime = new AssistantRuntime({
    store,
    model,
    tools: assistantTools(store, {}),
  });
  const app = new PersonalAssistant({ store, runtime, sources: {}, send });
  const task = app.submit({
    message: "研究过程中核对课程",
    effort: "deep",
    source: "feishu:qa:owner",
  });
  await app.drain();
  expect(store.getTask(task.id)).toMatchObject({
    status: "waiting-device",
    deadlineAt: "2026-10-18T02:20:00.000Z",
  });
  store.updateTask(task.id, { answer: "暂停前保存的研究线索，证据仍有缺口。" });
  vi.setSystemTime(new Date("2026-10-18T02:10:00Z"));
  app.close();
  store.close();
  store = new AssistantStore(directory);
  const restored = new PersonalAssistant({
    store,
    runtime: new AssistantRuntime({ store, model }),
    sources: {},
    send,
  });
  restored.recover();
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  await restored.drain();
  expect(requests).toBe(1);
  expect(store.getTask(task.id)).toMatchObject({
    status: "partial",
    deadlineAt: "2026-10-18T02:20:00.000Z",
    answer: expect.stringContaining("暂停前保存的研究线索"),
  });
  expect(bodies.at(-1)).toContain("暂停前保存的研究线索");
  expect(bodies.at(-1)).toContain("partial");
  expect(store.claimLocal("late-pc")).toBeUndefined();
  restored.close();
  store.close();
});

it("distinguishes a normal empty recommendation from a source failure", async () => {
  const store = await workspace();
  const now = () => new Date("2026-10-18T02:00:00Z");
  const runtime = new AssistantRuntime({ store, model: staticModel({ items: [] }) });
  const app = new PersonalAssistant({
    store,
    runtime,
    now,
    sources: { trending: { collect: async () => [project()] } },
  });
  await app.tick();
  expect(store.getDelivery("brief:2026-10-18")?.status).toBe("silent");
  const broken = new PersonalAssistant({
    store,
    runtime,
    now: () => new Date("2026-10-19T02:00:00Z"),
    sources: {
      gmail: {
        collect: async () => {
          throw new Error("authorization revoked");
        },
      },
    },
  });
  await expect(broken.tick()).rejects.toThrow("gmail");
  expect(store.getDelivery("brief:2026-10-19")?.status).toBe("failed");
  store.close();
});

it("does not resend an unknown delivery after timeout or restart", async () => {
  const store = await workspace();
  let calls = 0;
  const runtime = new AssistantRuntime({ store, model: staticModel(selection) });
  const options = {
    store,
    runtime,
    now: () => new Date("2026-10-18T02:00:00Z"),
    sources: { trending: { collect: async () => [project()] } },
    send: async () => {
      calls++;
      throw new Error("connection lost after server accepted");
    },
  };
  await new PersonalAssistant(options).tick();
  await new PersonalAssistant(options).tick();
  expect(calls).toBe(1);
  expect(store.getDelivery("brief:2026-10-18")?.status).toBe("unknown");
  expect(store.listMemory().some((m) => m.kind === "reading")).toBe(false);
  store.close();
});

it("keeps an unknown brief marked sent through HTTP in the recommendation ledger after restart", async () => {
  let store = await workspace();
  const directory = store.directory;
  let sends = 0;
  const runtime = new AssistantRuntime({ store, model: staticModel(selection) });
  const app = new PersonalAssistant({
    store,
    runtime,
    now: () => new Date("2026-10-18T02:00:00Z"),
    sources: { trending: { collect: async () => [project()] } },
    send: async () => {
      sends++;
      throw new Error("Delivery accepted but acknowledgement lost");
    },
  });
  await app.tick();
  expect(store.getDelivery("brief:2026-10-18")?.status).toBe("unknown");
  const token = "owner-secret-01234567890123456789";
  const server = createAssistantServer({
    store,
    app,
    ownerToken: token,
    workerToken: "worker-secret-01234567890123456789",
    cancel: (id) => runtime.cancel(id),
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server missing");
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/deliveries/brief%3A2026-10-18`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "sent", evidence: "已在手机核对完整晨报" }),
      },
    );
    expect(response.status).toBe(200);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    app.close();
    store.close();
  }
  store = new AssistantStore(directory);
  const next = new PersonalAssistant({
    store,
    runtime: new AssistantRuntime({ store, model: staticModel(selection) }),
    now: () => new Date("2026-10-19T02:00:00Z"),
    sources: { trending: { collect: async () => [project()] } },
    send: async () => {
      sends++;
      return { id: "duplicate" };
    },
  });
  await next.tick();
  expect(sends).toBe(1);
  expect(store.getDelivery("brief:2026-10-19")?.status).toBe("silent");
  next.close();
  store.close();
});

it("lets a new phone conversation read the full delivered brief with numbering and recommendation evidence after restart", async () => {
  let store = await workspace();
  const directory = store.directory;
  const second = {
    ...project(),
    id: "github:example/second",
    title: "example/second",
    url: "https://github.com/example/second",
  };
  const items = [
    selection.items[0]!,
    {
      documentId: second.id,
      takeaway: "按来源核查持久工具技能",
      reason: "提供独立验证与失败案例",
      connection: "可用于当前研究的反馈实验",
    },
  ];
  const first = new PersonalAssistant({
    store,
    runtime: new AssistantRuntime({ store, model: staticModel({ items }) }),
    now: () => new Date("2026-10-18T02:00:00Z"),
    sources: { trending: { collect: async () => [project(), second] } },
    send: async () => ({ id: "morning" }),
  });
  await first.tick();
  first.close();
  store.close();
  store = new AssistantStore(directory);
  let round = 0;
  const model: Model = {
    complete: async (messages) => ({
      message:
        ++round === 1
          ? {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "brief",
                  type: "function",
                  function: { name: "brief_history", arguments: "{}" },
                },
              ],
            }
          : {
              role: "assistant",
              content: messages.filter((m) => m.role === "tool").at(-1)!.content,
            },
      usage: { inputTokens: 10, outputTokens: 10 },
    }),
  };
  const runtime = new AssistantRuntime({
    store,
    model,
    tools: assistantTools(store, {}),
  });
  const app = new PersonalAssistant({ store, runtime, sources: {} });
  const token = "owner-secret-01234567890123456789";
  const server = createAssistantServer({
    store,
    app,
    ownerToken: token,
    workerToken: "worker-secret-01234567890123456789",
    cancel: (id) => runtime.cancel(id),
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server missing");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/tasks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "解释今天晨报第2项的推荐理由、要点和与我的联系",
        conversationId: "qa:phone",
        role: "qa",
      }),
    });
    expect(response.status).toBe(202);
    const { id } = z.object({ id: z.string() }).parse(await response.json());
    await app.drain();
    const outcome = store.getTask(id)!;
    expect(outcome.status).toBe("completed");
    const history = JSON.parse(outcome.answer);
    expect(history).toMatchObject({
      brief: {
        key: "brief:2026-10-18",
        status: "sent",
        body: expect.stringContaining("1. example/agent"),
      },
    });
    expect(history.brief.body).toContain("2. example/second");
    expect(history.brief.body).toContain("要点：按来源核查持久工具技能");
    expect(history.brief.body).toContain("推荐理由：提供独立验证与失败案例");
    expect(history.brief.body).toContain("与你的联系：可用于当前研究的反馈实验");
    expect(history.brief.body).toContain("https://github.com/example/second");
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    app.close();
    store.close();
  }
});

it("deduplicates an already delivered paper across Gmail and arXiv source IDs", async () => {
  const store = await workspace();
  let calls = 0;
  const original = {
    ...project(),
    id: "gmail-paper:2605.09423",
    metadata: { canonicalId: "arxiv:2605.09423" },
  };
  store.upsertDocument(original);
  store.upsertMemory({
    id: "pushed:old",
    kind: "question",
    text: "已经推送，但未确认阅读",
    status: "tentative",
    sourceDocumentIds: [original.id],
    createdAt: "2026-10-17",
    updatedAt: "2026-10-17",
  });
  const app = new PersonalAssistant({
    store,
    runtime: new AssistantRuntime({
      store,
      model: {
        complete: async () => {
          calls++;
          throw new Error("Should not rank an already delivered duplicate");
        },
      },
    }),
    now: () => new Date("2026-10-18T02:00:00Z"),
    sources: {
      trending: {
        collect: async () => [{ ...original, id: "arxiv:2605.09423", source: "arxiv" }],
      },
    },
  });
  await app.tick();
  expect(calls).toBe(0);
  expect(store.getDelivery("brief:2026-10-18")?.status).toBe("silent");
  store.close();
});

it("recovers interrupted work conservatively and prevents a cancelled local job from executing", async () => {
  const store = await workspace();
  const task = store.createTask({ message: "中断前的研究" });
  store.claimTask(task.id);
  store.reserveBudget(task.id, 0.25);
  store.claimDelivery("brief:2026-10-18", "");
  const runtime = new AssistantRuntime({ store, model: staticModel({ items: [] }) });
  const app = new PersonalAssistant({ store, runtime, sources: {} });
  app.recover();
  expect(store.getTask(task.id)?.status).toBe("partial");
  expect(store.budget().spentCny).toBe(0.25);
  expect(store.budget().reservedCny).toBe(0);
  expect(store.getDelivery("brief:2026-10-18")?.status).toBe("failed");
  const local = store.createTask({ message: "等待设备的门户查询" });
  store.enqueueLocal(local.id, {
    approved: true,
    prism: { command: "observe", session: "s", scope: "local" },
  });
  store.updateTask(local.id, { status: "waiting-device" });
  runtime.cancel(local.id);
  expect(store.claimLocal("pc")).toBeUndefined();
  store.close();
});

it("uses current course evidence and versioned community material to produce a sourced revision plan", async () => {
  const store = await workspace();
  store.upsertDocument({
    id: "course:current",
    source: "course",
    title: "本人确认的本学期课程",
    url: "file:///course-record.md",
    content: "操作系统：本学期在修；考试日期2026-10-25。尚无逐项掌握证据。",
    version: "2026-autumn",
    updatedAt: new Date().toISOString(),
  });
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/repos/LecterChu/nwpu-cram"))
      return Response.json({ default_branch: "main" });
    if (url.includes("/git/trees/"))
      return Response.json({
        sha: "snapshot-2024",
        truncated: false,
        tree: [
          {
            path: "操作系统/2024/README.md",
            type: "blob",
            sha: "material-2024",
            size: 100,
          },
        ],
      });
    if (url.startsWith("https://raw.githubusercontent.com/"))
      return new Response(
        "# 2024 操作系统复习资料\n覆盖进程调度与内存管理；不包含本学期考试大纲。",
        { headers: { "Content-Type": "text/plain" } },
      );
    throw new Error(`Unexpected course source ${url}`);
  };
  let round = 0;
  const model: Model = {
    complete: async () => {
      round++;
      const call = (name: string, args: Record<string, unknown>) => ({
        role: "assistant" as const,
        content: null,
        tool_calls: [
          {
            id: `course-${round}`,
            type: "function" as const,
            function: { name, arguments: JSON.stringify(args) },
          },
        ],
      });
      return {
        message:
          round === 1
            ? call("document_read", { id: "course:current" })
            : round === 2
              ? call("course_materials", {
                  course: "操作系统",
                  path: "操作系统/2024/README.md",
                })
              : {
                  role: "assistant",
                  content:
                    "依据本人课程记录，操作系统在修，2026-10-25考试。社区材料为2024年，覆盖调度与内存管理，不能代表本学期大纲。先用两道调度题检查理解，再按错题安排复习；目前没有掌握证据。来源：file:///course-record.md 与 https://github.com/LecterChu/nwpu-cram/blob/snapshot-2024/操作系统/2024/README.md",
                },
        usage: { inputTokens: 50, outputTokens: 50 },
      };
    },
  };
  const runtime = new AssistantRuntime({
    store,
    model,
    tools: [courseMaterials(store, fetcher)],
  });
  const result = await runtime.ask({
    message: "根据我的课程记录和相关材料准备操作系统考前复习",
  });
  expect(result.status).toBe("completed");
  expect(result.citations.map((citation) => citation.documentId)).toEqual(
    expect.arrayContaining(["course:current", "course:material-2024"]),
  );
  expect(result.answer).toContain("2024年");
  expect(result.answer).toContain("没有掌握证据");
  expect(result.artifacts?.some((path) => path.endsWith("report.md"))).toBe(true);
  store.close();
});

it("shares confirmed Q&A progress with the next intelligence selection", async () => {
  const store = await workspace();
  let qaRound = 0;
  let briefContext = "";
  const model: Model = {
    complete: async (messages: ModelMessage[], _tools: ToolDefinition[]) => {
      const intelligence = messages.some((m) => m.content?.includes("只输出 JSON"));
      if (intelligence) {
        briefContext = JSON.stringify(messages);
        return {
          message: { role: "assistant", content: JSON.stringify(selection) },
          usage: { inputTokens: 50, outputTokens: 50 },
        };
      }
      qaRound++;
      return {
        message:
          qaRound === 1
            ? {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "progress",
                    type: "function",
                    function: {
                      name: "memory_update",
                      arguments: JSON.stringify({
                        id: "research:progress",
                        kind: "progress",
                        text: "下一步研究工具反馈如何减少无效浏览器动作",
                        status: "tentative",
                      }),
                    },
                  },
                ],
              }
            : { role: "assistant", content: "已记录为待确认的研究进展。" },
        usage: { inputTokens: 50, outputTokens: 50 },
      };
    },
  };
  const runtime = new AssistantRuntime({ store, model });
  const question = await runtime.ask({
    role: "qa",
    message: "记录下一步研究进展",
    conversationId: "qa:one",
  });
  expect(question.status).toBe("completed");
  const progress = store.listMemory().find((m) => m.id === "research:progress")!;
  expect(progress.status).toBe("tentative");
  store.upsertMemory({ ...progress, status: "confirmed" }, progress.updatedAt);
  const app = new PersonalAssistant({
    store,
    runtime,
    now: () => new Date("2026-10-18T02:00:00Z"),
    sources: { trending: { collect: async () => [project()] } },
    send: async () => ({ id: "brief" }),
  });
  await app.tick();
  expect(briefContext).toContain("下一步研究工具反馈如何减少无效浏览器动作");
  expect(briefContext).toContain("confirmed");
  expect(
    store
      .listMemory()
      .some((m) => m.id.startsWith("pushed:") && m.status === "tentative"),
  ).toBe(true);
  store.close();
});

it("keeps local actions pending until the owner confirms the exact command, and isolates worker access", async () => {
  const store = await workspace();
  const command = {
    command: "act",
    session: "s",
    observation: "o",
    target: "t",
    evidence: "e",
    operation: "click",
    request_id: "r",
  };
  let round = 0;
  const model: Model = {
    complete: async () => ({
      message:
        ++round === 1
          ? {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "local",
                  type: "function",
                  function: {
                    name: "local_prism",
                    arguments: JSON.stringify({
                      command,
                      summary: "在门户打开课表，核对当前课程",
                    }),
                  },
                },
              ],
            }
          : {
              role: "assistant",
              content: "已收到输入回执，仍须下一次观察才能确认课表结果。",
            },
      usage: { inputTokens: 10, outputTokens: 10 },
    }),
  };
  const runtime = new AssistantRuntime({
    store,
    model,
    tools: assistantTools(store, {}),
  });
  const app = new PersonalAssistant({ store, runtime, sources: {} });
  const ownerToken = "owner-secret-01234567890123456789";
  const workerToken = "worker-secret-01234567890123456789";
  const server = createAssistantServer({
    store,
    app,
    ownerToken,
    workerToken,
    cancel: (id) => runtime.cancel(id),
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server missing");
  const base = `http://127.0.0.1:${address.port}`;
  const request = (path: string, token: string, value?: unknown, method = "POST") =>
    fetch(base + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    });
  try {
    expect((await request("/memory", workerToken, undefined, "GET")).status).toBe(401);
    const submitted = z
      .object({ id: z.string() })
      .parse(
        await (await request("/tasks", ownerToken, { message: "查本学期课程" })).json(),
      );
    await app.drain();
    const task = store.getTask(submitted.id)!;
    expect(task.status).toBe("awaiting-confirmation");
    const eventText = JSON.stringify(task.messages);
    const match = eventText.match(/local_[a-f\d-]+/);
    const pending = task.messages
      ?.filter((m) => m.role === "tool")
      .map((m) => JSON.parse(m.content ?? "{}"))
      .find((item) => item.jobId);
    expect(pending.jobId || match?.[0]).toBeTruthy();
    expect(
      z
        .object({ job: z.null() })
        .parse(
          await (await request("/worker/next", workerToken, { workerId: "pc" })).json(),
        ).job,
    ).toBeNull();
    expect(
      (await request(`/local/${pending.jobId}/confirm`, workerToken, {})).status,
    ).toBe(401);
    expect(
      (await request(`/local/${pending.jobId}/confirm`, ownerToken, {})).status,
    ).toBe(200);
    const job = z
      .object({
        job: z.object({ id: z.string(), command: z.object({ prism: z.unknown() }) }),
      })
      .parse(
        await (await request("/worker/next", workerToken, { workerId: "pc" })).json(),
      ).job;
    expect(job.command.prism).toEqual(command);
    expect(
      (
        await request(`/worker/jobs/${job.id}`, workerToken, {
          workerId: "other",
          status: "completed",
          result: {},
        })
      ).status,
    ).toBe(409);
    const result = await request(`/worker/jobs/${job.id}`, workerToken, {
      workerId: "pc",
      status: "completed",
      result: { receipt: { outcome: "executed" } },
    });
    expect(result.status).toBe(202);
    await app.drain();
    // Receipt wording must survive the return boundary; executing an input is
    // not sufficient evidence that the course query succeeded.
    expect(store.getTask(task.id)?.answer).toContain("仍须下一次观察");
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    store.close();
  }
});
