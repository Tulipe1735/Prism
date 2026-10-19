import type { SessionEntry, SessionSummary } from "../../src/kernel/session.ts";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { api, connectEvents, type KernelHarness, startTestKernel } from "./harness.ts";

let harness: KernelHarness | undefined;

afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
});

async function start(
  options: Parameters<typeof startTestKernel>[0] = {},
): Promise<KernelHarness> {
  harness = await startTestKernel(options);
  return harness;
}

/** The session log as the workbench would replay it: the file on disk. */
async function readLog(dataDir: string, sessionId: string): Promise<SessionEntry[]> {
  const root = join(dataDir, "sessions");
  for (const directory of await readdir(root)) {
    try {
      const lines = (
        await readFile(join(root, directory, `${sessionId}.jsonl`), "utf8")
      )
        .split("\n")
        .filter((line) => line !== "");
      return lines.slice(1).map((line) => JSON.parse(line) as SessionEntry);
    } catch {
      // Not this workspace directory.
    }
  }
  throw new Error(`Session ${sessionId} was not written under ${root}`);
}

async function createSession(url: string, workspace: string): Promise<SessionSummary> {
  const response = await api<{ session: SessionSummary }>(url, "/sessions", {
    method: "POST",
    body: { workspace },
  });
  expect(response.status).toBe(201);
  return response.body.session;
}

it("streams the model reply as deltas and persists it in the session log", async () => {
  const { kernel, model, workspace, dataDir } = await start({
    answers: [{ text: ["Hel", "lo", "!"] }],
  });
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);

  const sent = await api<{ entryId: string }>(
    kernel.url,
    `/sessions/${session.id}/messages`,
    { method: "POST", body: { text: "Hi there" } },
  );
  expect(sent.status).toBe(202);

  const deltas: string[] = [];
  let entryId = "";
  for (let index = 0; index < 3; index += 1) {
    const delta = await events.waitFor((event) => event.type === "message.delta");
    if (delta.type !== "message.delta") throw new Error("Expected a message delta");
    deltas.push(delta.delta);
    entryId = delta.entryId;
  }
  expect(deltas).toEqual(["Hel", "lo", "!"]);
  expect(entryId).not.toBe("");

  const updated = await events.waitFor(
    (event) => event.type === "session.updated" && event.session.entryCount === 2,
  );
  if (updated.type !== "session.updated") throw new Error("Expected a session update");
  expect(updated.session.leafId).toBe(entryId);

  const entries = await readLog(dataDir, session.id);
  expect(entries.map((entry) => entry.type)).toEqual(["message", "message"]);
  expect(entries[0]).toMatchObject({ role: "user", content: "Hi there" });
  expect(entries[1]).toMatchObject({
    id: entryId,
    role: "assistant",
    content: "Hello!",
  });

  const request = model.requests[0];
  expect(request?.stream).toBe(true);
  expect(request?.model).toBe("scripted-model");
  expect(request?.messages[0]?.role).toBe("system");
  expect(request?.messages[0]?.content).toContain(workspace);
  expect(request?.tools?.map((tool) => tool.function.name)).toEqual(
    expect.arrayContaining(["echo", "skill"]),
  );
  events.close();
});

it("runs the tools the model calls, feeds results back and keeps the log ordered", async () => {
  const { kernel, model, workspace, dataDir } = await start({
    answers: [
      {
        text: ["Checking."],
        toolCalls: [{ id: "call_1", name: "echo", arguments: '{"text":"pong"}' }],
      },
      { text: ["Done."] },
    ],
  });
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);

  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "ping" },
  });
  await events.waitFor(
    (event) => event.type === "session.updated" && event.session.entryCount === 5,
  );

  const types = events.events.map((event) => event.type);
  const started = types.indexOf("tool.started");
  const completed = types.indexOf("tool.completed");
  expect(started).toBeGreaterThanOrEqual(0);
  expect(completed).toBeGreaterThan(started);
  expect(events.events.find((event) => event.type === "tool.started")).toMatchObject({
    callId: "call_1",
    name: "echo",
    arguments: { text: "pong" },
  });
  expect(events.events.find((event) => event.type === "tool.completed")).toMatchObject({
    callId: "call_1",
    result: "pong",
  });

  expect((await readLog(dataDir, session.id)).map((entry) => entry.type)).toEqual([
    "message",
    "message",
    "tool_call",
    "tool_result",
    "message",
  ]);
  const toolCall = (await readLog(dataDir, session.id))[2];
  expect(toolCall).toMatchObject({ type: "tool_call", callId: "call_1", name: "echo" });

  // The second model request carries the tool result back as a tool message.
  expect(model.requests[1]?.messages.at(-1)).toMatchObject({
    role: "tool",
    content: "pong",
    tool_call_id: "call_1",
  });
  expect(model.requests[1]?.messages.at(-2)).toMatchObject({ role: "assistant" });
  events.close();
});

it("lists skills in the system prompt and reads one through the skill tool", async () => {
  const { kernel, model, workspace, dataDir, home } = await start({
    answers: [
      { toolCalls: [{ id: "call_1", name: "skill", arguments: "{}" }] },
      { toolCalls: [{ id: "call_2", name: "skill", arguments: '{"name":"demo"}' }] },
      { text: ["Done."] },
    ],
  });
  const skillDirectory = join(workspace, ".agents", "skills", "demo");
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(
    join(skillDirectory, "SKILL.md"),
    "---\nname: demo\ndescription: Demo workflow for the tests.\n---\n\nStep one: do the demo.\n",
  );
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);

  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "run the demo" },
  });
  await events.waitFor(
    (event) => event.type === "session.updated" && event.session.entryCount === 6,
  );

  expect(model.requests[0]?.messages[0]?.content).toContain(
    "- demo: Demo workflow for the tests.",
  );
  const completed = events.events.filter((event) => event.type === "tool.completed");
  expect(completed[0]).toMatchObject({ callId: "call_1" });
  expect(completed[1]).toMatchObject({
    callId: "call_2",
    result: "Step one: do the demo.",
  });
  expect((completed[0] as { result: string }).result).toContain("demo");
  expect(home).not.toBe("");
  expect(await readFile(join(skillDirectory, "SKILL.md"), "utf8")).toContain("demo");
  await expect(readLog(dataDir, session.id)).resolves.toHaveLength(6);
  events.close();
});

it("truncates long tool results before they reach the model and the log", async () => {
  const long = "x".repeat(9_000);
  const { kernel, model, workspace, dataDir } = await start({
    answers: [
      {
        toolCalls: [
          { id: "call_1", name: "echo", arguments: JSON.stringify({ text: long }) },
        ],
      },
      { text: ["Done."] },
    ],
  });
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);

  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "echo a lot" },
  });
  const completed = await events.waitFor(
    (event) => event.type === "tool.completed" && event.callId === "call_1",
  );
  if (completed.type !== "tool.completed") throw new Error("Expected a completed tool");
  expect(completed.result).toBe(
    `${"x".repeat(8_000)}\n[result truncated after 8000 characters]`,
  );
  await events.waitFor(
    (event) => event.type === "session.updated" && event.session.entryCount === 4,
  );

  const toolResult = (await readLog(dataDir, session.id)).find(
    (entry) => entry.type === "tool_result",
  );
  expect(toolResult).toMatchObject({ content: completed.result });
  const fedBack = model.requests[1]?.messages.at(-1);
  expect(fedBack?.content).toBe(completed.result);
  events.close();
});

it("reports a refused model request instead of inventing a reply", async () => {
  const { kernel, workspace, dataDir } = await start({ answers: [{ status: 500 }] });
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);

  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "hello?" },
  });
  const updated = await events.waitFor(
    (event) => event.type === "session.updated" && event.session.entryCount === 2,
  );
  if (updated.type !== "session.updated") throw new Error("Expected a session update");

  const entries = await readLog(dataDir, session.id);
  expect(entries[1]).toMatchObject({ role: "system" });
  expect((entries[1] as { content: string }).content).toContain("HTTP 500");
  expect(events.events.some((event) => event.type === "message.delta")).toBe(false);
  events.close();
});

it("cancels a running task: partial text lands, no further events follow", async () => {
  const { kernel, workspace, dataDir } = await start({
    answers: [{ text: ["Thinking..."], hold: true }],
  });
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);

  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "start a long task" },
  });
  await events.waitFor((event) => event.type === "message.delta");

  const cancelled = await api<{ cancelled: boolean }>(
    kernel.url,
    `/sessions/${session.id}/cancel`,
    { method: "POST" },
  );
  expect(cancelled.body).toEqual({ cancelled: true });

  const done = await events.waitFor(
    (event) => event.type === "session.updated" && event.session.entryCount === 3,
  );
  if (done.type !== "session.updated") throw new Error("Expected a session update");
  const entries = await readLog(dataDir, session.id);
  expect(entries.map((entry) => entry.type)).toEqual(["message", "message", "message"]);
  expect(entries[1]).toMatchObject({ role: "assistant", content: "Thinking..." });
  expect(entries[2]).toMatchObject({ role: "system" });

  const seen = events.events.length;
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(events.events.length).toBe(seen);
  expect(events.events.some((event) => event.type === "tool.started")).toBe(false);
  events.close();
});

it("asks for one-time approval and honours the answer", async () => {
  const approvals: { reason: string; target: string; impact: string }[] = [];
  const { kernel, workspace, dataDir } = await start({
    answers: [
      {
        toolCalls: [
          { id: "call_1", name: "danger", arguments: '{"target":"/etc/hosts"}' },
        ],
      },
      { text: ["Done."] },
    ],
    tools: [
      {
        name: "danger",
        description: "Test tool that always needs approval.",
        parameters: { type: "object", properties: {} },
        execute: async (_args, context) => {
          const request = {
            reason: "Writes outside the workspace",
            target: "/etc/hosts",
            impact: "Edits a system file",
          };
          approvals.push(request);
          const approved = await context.requestApproval(request);
          return { content: approved ? "wrote /etc/hosts" : "refused by the user" };
        },
      },
    ],
  });
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);

  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "touch /etc/hosts" },
  });
  const requested = await events.waitFor(
    (event) => event.type === "approval.requested",
  );
  if (requested.type !== "approval.requested")
    throw new Error("Expected an approval request");
  expect(requested).toMatchObject({
    sessionId: session.id,
    tool: "danger",
    reason: "Writes outside the workspace",
    target: "/etc/hosts",
    impact: "Edits a system file",
  });
  expect(approvals).toHaveLength(1);

  const answered = await api<{ approved: boolean }>(
    kernel.url,
    `/sessions/${session.id}/approvals/${requested.requestId}`,
    { method: "POST", body: { approved: true } },
  );
  expect(answered.body).toEqual({ approved: true });
  await events.waitFor(
    (event) =>
      event.type === "approval.resolved" && event.requestId === requested.requestId,
  );
  await events.waitFor(
    (event) => event.type === "session.updated" && event.session.entryCount === 4,
  );

  const again = await api(
    kernel.url,
    `/sessions/${session.id}/approvals/${requested.requestId}`,
    {
      method: "POST",
      body: { approved: true },
    },
  );
  expect(again.status).toBe(404);
  expect(again.body).toMatchObject({ error: { code: "APPROVAL_NOT_FOUND" } });

  const entries = await readLog(dataDir, session.id);
  expect(entries[2]).toMatchObject({
    type: "tool_result",
    content: "wrote /etc/hosts",
  });
  expect(
    events.events.filter((event) => event.type === "approval.requested"),
  ).toHaveLength(1);
  events.close();
});

it("reports a tool the kernel does not have instead of failing the task", async () => {
  const { kernel, workspace, dataDir } = await start({
    answers: [
      { toolCalls: [{ id: "call_1", name: "teleport", arguments: "{}" }] },
      { text: ["I cannot teleport."] },
    ],
  });
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);

  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "teleport me" },
  });
  const failed = await events.waitFor(
    (event) => event.type === "tool.failed" && event.callId === "call_1",
  );
  if (failed.type !== "tool.failed") throw new Error("Expected a failed tool");
  expect(failed.error).toContain('Unknown tool "teleport"');

  await events.waitFor(
    (event) => event.type === "session.updated" && event.session.entryCount === 4,
  );
  const entries = await readLog(dataDir, session.id);
  expect(entries[2]).toMatchObject({ type: "tool_result", isError: true });
  events.close();
});

it("stops after the round limit and says so instead of looping forever", async () => {
  const work = Array.from({ length: 25 }, (_value, index) => ({
    toolCalls: [{ id: `call_${index}`, name: "echo", arguments: '{"text":"again"}' }],
  }));
  const { kernel, workspace, dataDir } = await start({ answers: work });
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);

  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "keep going" },
  });
  await events.waitFor(
    (event) => event.type === "session.updated" && event.session.entryCount === 52,
  );
  const entries = await readLog(dataDir, session.id);
  expect(entries.at(-1)).toMatchObject({ role: "system" });
  expect((entries.at(-1) as { content: string }).content).toContain("25 model rounds");
  events.close();
});

it("refuses a second message while a task is running and reports a clean session state", async () => {
  const { kernel, workspace } = await start({
    answers: [{ text: ["..."], hold: true }],
  });
  const session = await createSession(kernel.url, workspace);
  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "first" },
  });

  const busy = await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "second" },
  });
  expect(busy.status).toBe(409);
  expect(busy.body).toMatchObject({ error: { code: "TASK_RUNNING" } });

  const cancelled = await api(kernel.url, `/sessions/${session.id}/cancel`, {
    method: "POST",
  });
  expect(cancelled.body).toEqual({ cancelled: true });

  const idle = await api(kernel.url, `/sessions/${session.id}/cancel`, {
    method: "POST",
  });
  expect(idle.body).toEqual({ cancelled: false });
});
