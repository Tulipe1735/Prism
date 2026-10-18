import type { Model, ModelMessage, ToolDefinition } from "../../src/assistant/types.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { z } from "zod";
import { createAssistantServer } from "../../src/assistant/http.ts";
import { AssistantRuntime } from "../../src/assistant/runtime.ts";
import { assistantTools, PersonalAssistant } from "../../src/assistant/service.ts";
import { AssistantStore } from "../../src/assistant/store.ts";

const directories: string[] = [];
afterEach(async () => {
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
