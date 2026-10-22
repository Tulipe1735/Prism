import type { KernelEvent } from "../../src/kernel/events.ts";
import type { Tool } from "../../src/kernel/tool.ts";
import { afterEach, expect, it, vi } from "vitest";
import { KernelClient } from "../../src/workbench/ui/client.ts";
import { type KernelHarness, startTestKernel } from "./harness.ts";

let harness: KernelHarness;
afterEach(async () => harness?.cleanup());

function gate() {
  let release = (): void => {};
  let entered = (): void => {};
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const tool: Tool = {
    name: "gate",
    description: "Controlled complete tool boundary",
    parameters: { type: "object", properties: {} },
    async execute(_input, { signal }) {
      entered();
      await Promise.race([
        wait,
        new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        ),
      ]);
      return { content: "gate complete" };
    },
  };
  return { tool, started, release, enter: () => entered(), wait };
}

it("applies steering after the whole tool batch, without starting a second task or changing another session", async () => {
  const controlled = gate();
  harness = await startTestKernel({
    tools: [controlled.tool],
    answers: [
      {
        toolCalls: [
          { id: "gate-call", name: "gate", arguments: "{}" },
          { id: "echo-call", name: "echo", arguments: '{"text":"second result"}' },
        ],
      },
      { text: ["已按补充要求完成"] },
    ],
  });
  const client = new KernelClient({ baseUrl: harness.kernel.url });
  const session = await client.createSession({
    workspace: harness.workspace,
    title: "Steering",
  });
  const other = await client.createSession({ workspace: harness.workspace });
  const events: KernelEvent[] = [];
  harness.kernel.kernel.subscribe((event) => events.push(event));
  await client.sendMessage(session.id, "开始");
  await controlled.started;
  try {
    const entryId = await client.steerSession(session.id, "补充：使用中文");
    expect(harness.kernel.kernel.ctx.tasks.pending(session.id)).toEqual([
      { entryId, text: "补充：使用中文" },
    ]);
    expect(
      (await client.readSession(session.id)).entries.some(
        (entry) => entry.id === entryId,
      ),
    ).toBe(false);
    await expect(
      client.sendMessage(session.id, "不能开启第二个任务"),
    ).rejects.toMatchObject({ code: "TASK_RUNNING" });
    await expect(client.steerSession(other.id, "错误会话")).rejects.toMatchObject({
      code: "TASK_NOT_RUNNING",
    });
    controlled.release();
    await harness.kernel.kernel.ctx.tasks.settle(session.id);
    const entries = (await client.readSession(session.id)).entries;
    expect(entries.map((entry) => entry.type)).toEqual([
      "message",
      "tool_call",
      "tool_call",
      "tool_result",
      "tool_result",
      "message",
      "message",
    ]);
    expect(entries[5]).toMatchObject({
      id: entryId,
      role: "user",
      content: "补充：使用中文",
    });
    expect(harness.model.requests[1]?.messages.at(-1)).toMatchObject({
      role: "user",
      content: "补充：使用中文",
    });
    expect((await client.readSession(other.id)).entries).toEqual([]);
    expect(events.filter((event) => event.type === "task.input")).toMatchObject([
      { state: "queued" },
      { state: "applied" },
    ]);
  } finally {
    controlled.release();
  }
});

it("continues after a text-only answer when steering arrived during model streaming", async () => {
  harness = await startTestKernel();
  const client = new KernelClient({ baseUrl: harness.kernel.url });
  const session = await client.createSession({
    workspace: harness.workspace,
    title: "Stream steering",
  });
  const controlled = gate();
  let request = 0;
  vi.spyOn(harness.kernel.kernel.ctx.model, "stream").mockImplementation(
    async function* () {
      if (request++ === 0) {
        yield { type: "text", text: "第一段" };
        controlled.enter();
        await controlled.wait;
      } else yield { type: "text", text: "补充后的回复" };
    },
  );
  await client.sendMessage(session.id, "开始");
  await controlled.started;
  try {
    await client.steerSession(session.id, "继续完善");
    controlled.release();
    await harness.kernel.kernel.ctx.tasks.settle(session.id);
    const log = await client.readSession(session.id);
    expect(
      log.entries
        .filter((entry) => entry.type === "message")
        .map((entry) => entry.content),
    ).toEqual(["开始", "第一段", "继续完善", "补充后的回复"]);
    expect(request).toBe(2);
    await expect(client.steerSession(session.id, "已结束")).rejects.toMatchObject({
      code: "TASK_NOT_RUNNING",
    });
  } finally {
    controlled.release();
  }
});

it("reports queued inputs as cancelled and clears the queue on task cancellation", async () => {
  const controlled = gate();
  harness = await startTestKernel({
    tools: [controlled.tool],
    answers: [
      { toolCalls: [{ id: "cancel-gate", name: "gate", arguments: "{}" }] },
      { text: ["新任务完成"] },
    ],
  });
  const client = new KernelClient({ baseUrl: harness.kernel.url });
  const session = await client.createSession({
    workspace: harness.workspace,
    title: "Cancel",
  });
  const events: KernelEvent[] = [];
  harness.kernel.kernel.subscribe((event) => events.push(event));
  await client.sendMessage(session.id, "开始");
  await controlled.started;
  const entryId = await client.steerSession(session.id, "尚未执行");
  expect(await client.cancelSession(session.id)).toBe(true);
  await harness.kernel.kernel.ctx.tasks.settle(session.id);
  expect(harness.kernel.kernel.ctx.tasks.pending(session.id)).toEqual([]);
  expect(events).toContainEqual({
    type: "task.input",
    sessionId: session.id,
    entryId,
    state: "cancelled",
  });
  expect(
    (await client.readSession(session.id)).entries.some(
      (entry) => entry.id === entryId,
    ),
  ).toBe(false);
  await client.sendMessage(session.id, "新任务");
  await harness.kernel.kernel.ctx.tasks.settle(session.id);
  expect((await client.readSession(session.id)).entries.at(-1)).toMatchObject({
    content: "新任务完成",
  });
});
