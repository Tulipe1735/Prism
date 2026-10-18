import type { KernelSettings } from "../../src/kernel/kernel.ts";
import type { SessionEntry, SessionSummary } from "../../src/kernel/session.ts";
import type { Tool } from "../../src/kernel/tool.ts";
import type { JsonValue } from "../../src/kernel/types.ts";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
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

async function createSession(url: string, workspace: string): Promise<SessionSummary> {
  const response = await api<{ session: SessionSummary }>(url, "/sessions", {
    method: "POST",
    body: { workspace },
  });
  expect(response.status).toBe(201);
  return response.body.session;
}

/** The session log as the workbench reads it, over HTTP. */
async function readEntries(url: string, sessionId: string): Promise<SessionEntry[]> {
  const response = await api<{ entries: SessionEntry[] }>(
    url,
    `/sessions/${sessionId}`,
  );
  return response.body.entries;
}

/** Waits until the session has as many tool results as the script asked for. */
async function waitForToolResults(
  url: string,
  sessionId: string,
  count: number,
): Promise<SessionEntry[]> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const entries = await readEntries(url, sessionId);
    if (entries.filter((entry) => entry.type === "tool_result").length >= count)
      return entries;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Session ${sessionId} never reached ${count} tool results`);
}

function stringField(args: JsonValue, key: string): string {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return "";
  const value = (args as Record<string, JsonValue>)[key];
  return typeof value === "string" ? value : "";
}

/** The real `write_file` arguments. */
function write(path: string, content: string): string {
  return JSON.stringify({ path, content });
}

/**
 * Stands in for a tool that drives a browser: the real tools of 06 need a
 * running engine, while this test only checks how the policy treats the
 * declared action.
 */
const browserActTool: Tool = {
  name: "test_browser_action",
  description: "Test stand-in for a browser action tool.",
  parameters: {
    type: "object",
    properties: { action: { type: "string" } },
    required: ["action"],
    additionalProperties: false,
  },
  effects: (args) => [
    {
      kind: "browser-action",
      action: stringField(args, "action"),
      target: "https://example.com/",
    },
  ],
  execute: async (args) => ({ content: `clicked: ${stringField(args, "action")}` }),
};

it("asks once for a write outside the workspace and asks again for the next one", async () => {
  const { kernel, workspace } = await start({
    answers: [
      {
        toolCalls: [
          {
            id: "call_1",
            name: "write_file",
            arguments: write("../outside/note.txt", "hello"),
          },
        ],
      },
      {
        toolCalls: [
          {
            id: "call_2",
            name: "write_file",
            arguments: write("../outside/note.txt", "hello"),
          },
        ],
      },
      { text: ["Done."] },
    ],
  });
  const outside = resolve(workspace, "..", "outside", "note.txt");
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);

  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "write the note" },
  });

  const first = await events.waitFor((event) => event.type === "approval.requested");
  if (first.type !== "approval.requested")
    throw new Error("Expected an approval request");
  expect(first).toMatchObject({
    sessionId: session.id,
    tool: "write_file",
    target: outside,
  });
  expect(first.reason).toContain("outside the workspace");
  expect(first.impact).toContain(outside);
  await expect(readFile(outside, "utf8")).rejects.toThrow();

  const answered = await api<{ approved: boolean }>(
    kernel.url,
    `/sessions/${session.id}/approvals/${first.requestId}`,
    { method: "POST", body: { approved: true } },
  );
  expect(answered.status).toBe(200);
  await events.waitFor(
    (event) =>
      event.type === "approval.resolved" &&
      event.requestId === first.requestId &&
      event.approved,
  );
  await events.waitFor(
    (event) => event.type === "tool.completed" && event.callId === "call_1",
  );
  expect(await readFile(outside, "utf8")).toBe("hello");

  // The same write again: the approval is never remembered (ADR-0005).
  const second = await events.waitFor((event) => event.type === "approval.requested");
  if (second.type !== "approval.requested")
    throw new Error("Expected an approval request");
  expect(second).toMatchObject({ tool: "write_file", target: outside });
  expect(second.requestId).not.toBe(first.requestId);
  await api(kernel.url, `/sessions/${session.id}/approvals/${second.requestId}`, {
    method: "POST",
    body: { approved: true },
  });
  await events.waitFor(
    (event) => event.type === "tool.completed" && event.callId === "call_2",
  );

  expect(
    events.events.filter((event) => event.type === "approval.requested"),
  ).toHaveLength(2);
  await events.waitFor(
    (event) => event.type === "session.updated" && event.session.entryCount === 6,
  );
  const entries = await readEntries(kernel.url, session.id);
  expect(entries.map((entry) => entry.type)).toEqual([
    "message",
    "tool_call",
    "tool_result",
    "tool_call",
    "tool_result",
    "message",
  ]);
  events.close();
});

it("does not run the action when the user refuses and says so to the model", async () => {
  const { kernel, model, workspace } = await start({
    answers: [
      {
        toolCalls: [
          {
            id: "call_1",
            name: "write_file",
            arguments: write("../outside/note.txt", "hello"),
          },
        ],
      },
      { text: ["I will not write there."] },
    ],
  });
  const outside = resolve(workspace, "..", "outside", "note.txt");
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);

  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "write the note" },
  });
  const requested = await events.waitFor(
    (event) => event.type === "approval.requested",
  );
  if (requested.type !== "approval.requested")
    throw new Error("Expected an approval request");

  await api(kernel.url, `/sessions/${session.id}/approvals/${requested.requestId}`, {
    method: "POST",
    body: { approved: false },
  });
  await events.waitFor(
    (event) =>
      event.type === "approval.resolved" &&
      event.requestId === requested.requestId &&
      !event.approved,
  );
  const failed = await events.waitFor(
    (event) => event.type === "tool.failed" && event.callId === "call_1",
  );
  if (failed.type !== "tool.failed") throw new Error("Expected a failed tool");
  expect(failed.error).toContain("refused");

  await expect(readFile(outside, "utf8")).rejects.toThrow();
  const entries = await readEntries(kernel.url, session.id);
  const result = entries.find((entry) => entry.type === "tool_result");
  expect(result).toMatchObject({ callId: "call_1", isError: true });
  expect((result as { content: string }).content).toContain("refused");

  // The model reads the refusal as the tool result and can change its approach.
  await events.waitFor(
    (event) => event.type === "session.updated" && event.session.entryCount === 4,
  );
  const fed = model.requests[1]?.messages.find(
    (message) => message.tool_call_id === "call_1",
  );
  expect(fed?.role).toBe("tool");
  expect(fed?.content).toContain("refused");
  events.close();
});

it("writes inside the workspace without asking", async () => {
  const { kernel, workspace } = await start({
    answers: [
      {
        toolCalls: [
          {
            id: "call_1",
            name: "write_file",
            arguments: write("src/note.txt", "hello"),
          },
        ],
      },
      { text: ["Done."] },
    ],
  });
  const inside = join(workspace, "src", "note.txt");
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);

  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "write the note" },
  });
  await events.waitFor(
    (event) => event.type === "tool.completed" && event.callId === "call_1",
  );

  expect(await readFile(inside, "utf8")).toBe("hello");
  expect(events.events.some((event) => event.type === "approval.requested")).toBe(
    false,
  );
  events.close();
});

it("takes no effects off the table in the full-access scope", async () => {
  const { kernel, workspace } = await start({
    answers: [
      {
        toolCalls: [
          {
            id: "call_1",
            name: "write_file",
            arguments: write("../outside/note.txt", "hello"),
          },
        ],
      },
      {
        toolCalls: [
          { id: "call_2", name: "run_command", arguments: '{"command":"ls"}' },
        ],
      },
      { text: ["Done."] },
    ],
    scope: "full-access",
  });
  const outside = resolve(workspace, "..", "outside", "note.txt");
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);

  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "write the note and list files" },
  });
  await events.waitFor(
    (event) => event.type === "tool.completed" && event.callId === "call_2",
  );

  expect(await readFile(outside, "utf8")).toBe("hello");
  expect(events.events.some((event) => event.type === "approval.requested")).toBe(
    false,
  );
  events.close();
});

it("refuses writes and commands in the read-only scope without asking", async () => {
  const { kernel, model, workspace } = await start({
    answers: [
      {
        toolCalls: [
          {
            id: "call_1",
            name: "write_file",
            arguments: write("src/note.txt", "hello"),
          },
          {
            id: "call_2",
            name: "write_file",
            arguments: write("../outside/note.txt", "hello"),
          },
          { id: "call_3", name: "run_command", arguments: '{"command":"touch x"}' },
        ],
      },
      { text: ["Understood."] },
    ],
    scope: "read-only",
  });
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);

  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "write the note" },
  });
  const failed = await events.waitFor(
    (event) => event.type === "tool.failed" && event.callId === "call_3",
  );
  if (failed.type !== "tool.failed") throw new Error("Expected a failed tool");

  const errors = events.events
    .filter((event) => event.type === "tool.failed")
    .map((event) => (event as { error: string }).error);
  expect(errors).toHaveLength(3);
  for (const error of errors) {
    expect(error).toContain("read-only");
    expect(error).toContain("not executed");
  }

  await expect(readFile(join(workspace, "src", "note.txt"), "utf8")).rejects.toThrow();
  await expect(
    readFile(resolve(workspace, "..", "outside", "note.txt"), "utf8"),
  ).rejects.toThrow();
  // The read-only scope is a hard boundary: it never asks, it refuses.
  expect(events.events.some((event) => event.type === "approval.requested")).toBe(
    false,
  );
  // The model knows which scope it works under before it plans.
  expect(model.requests[0]?.messages[0]?.content).toContain("read-only");
  events.close();
});

it("leaves browser actions alone by default and asks when the setting is on", async () => {
  const { kernel, workspace } = await start({
    answers: [
      {
        toolCalls: [
          {
            id: "call_1",
            name: "test_browser_action",
            arguments: '{"action":"click"}',
          },
        ],
      },
      { text: ["Done."] },
    ],
    browserActionsNeedApproval: true,
    tools: [browserActTool],
  });
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);

  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "click the button" },
  });
  const requested = await events.waitFor(
    (event) => event.type === "approval.requested",
  );
  if (requested.type !== "approval.requested")
    throw new Error("Expected an approval request");
  expect(requested).toMatchObject({ tool: "test_browser_action" });
  expect(requested.reason).toContain("approval");
  expect(requested.target).toContain("https://example.com/");
  expect(requested.impact).toContain("click");
  await expect(
    api(kernel.url, `/sessions/${session.id}/approvals/${requested.requestId}`, {
      method: "POST",
      body: { approved: true },
    }),
  ).resolves.toMatchObject({ status: 200 });
  await events.waitFor(
    (event) => event.type === "tool.completed" && event.callId === "call_1",
  );
  events.close();
});

it("runs browser actions without approval when the setting is off", async () => {
  const { kernel, workspace } = await start({
    answers: [
      {
        toolCalls: [
          {
            id: "call_1",
            name: "test_browser_action",
            arguments: '{"action":"click"}',
          },
        ],
      },
      { text: ["Done."] },
    ],
    tools: [browserActTool],
  });
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);

  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "click the button" },
  });
  await events.waitFor(
    (event) => event.type === "tool.completed" && event.callId === "call_1",
  );
  expect(events.events.some((event) => event.type === "approval.requested")).toBe(
    false,
  );
  events.close();
});

it("switches the scope over HTTP, keeps it in the config file and applies it next", async () => {
  const { kernel, workspace, dataDir } = await start({
    answers: [
      {
        toolCalls: [
          {
            id: "call_1",
            name: "write_file",
            arguments: write("../outside/note.txt", "hello"),
          },
        ],
      },
      { text: ["Done."] },
    ],
    // The patch must merge into this file, not replace it.
    configFile: { model: { apiKey: "sk-keep-me" } },
  });

  const switched = await api<KernelSettings>(kernel.url, "/settings", {
    method: "PUT",
    body: { permissions: { scope: "full-access" } },
  });
  expect(switched.status).toBe(200);
  expect(switched.body).toMatchObject({
    permissions: { scope: "full-access" },
    browser: { engine: "chromium", actionsNeedApproval: false },
  });
  await expect(api<KernelSettings>(kernel.url, "/settings")).resolves.toMatchObject({
    body: { permissions: { scope: "full-access" } },
  });
  expect(
    JSON.parse(await readFile(join(dataDir, "config.json"), "utf8")),
  ).toMatchObject({
    model: { apiKey: "sk-keep-me" },
    permissions: { scope: "full-access" },
  });

  // The next action already runs under the new scope, without approval.
  const outside = resolve(workspace, "..", "outside", "note.txt");
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);
  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "write the note" },
  });
  await events.waitFor(
    (event) => event.type === "tool.completed" && event.callId === "call_1",
  );
  expect(await readFile(outside, "utf8")).toBe("hello");
  expect(events.events.some((event) => event.type === "approval.requested")).toBe(
    false,
  );

  const badScope = await api(kernel.url, "/settings", {
    method: "PUT",
    body: { permissions: { scope: "everything" } },
  });
  expect(badScope.status).toBe(400);
  expect(badScope.body).toMatchObject({ error: { code: "INVALID_REQUEST" } });
  const badFlag = await api(kernel.url, "/settings", {
    method: "PUT",
    body: { browser: { actionsNeedApproval: "yes" } },
  });
  expect(badFlag.status).toBe(400);
  const nothing = await api(kernel.url, "/settings", { method: "PUT", body: {} });
  expect(nothing.status).toBe(400);
  // A section the kernel cannot change at runtime is refused, not dropped.
  const unknown = await api(kernel.url, "/settings", {
    method: "PUT",
    body: { compaction: { keepTokens: 1000 } },
  });
  expect(unknown.status).toBe(400);
  events.close();
});

it("refuses the whole call when one action is denied, without asking about the rest", async () => {
  let ran = false;
  const bothTool: Tool = {
    name: "write_and_click",
    description: "Test stand-in declaring a denied write and a browsable action.",
    parameters: { type: "object", properties: {} },
    effects: () => [
      { kind: "file-write", path: "/etc/hosts" },
      { kind: "browser-action", action: "click", target: "https://example.com/" },
    ],
    execute: async () => {
      ran = true;
      return { content: "did both" };
    },
  };
  const { kernel, workspace } = await start({
    answers: [
      { toolCalls: [{ id: "call_1", name: "write_and_click", arguments: "{}" }] },
      { text: ["Understood."] },
    ],
    scope: "read-only",
    browserActionsNeedApproval: true,
    tools: [bothTool],
  });
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);

  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "do both" },
  });
  const failed = await events.waitFor(
    (event) => event.type === "tool.failed" && event.callId === "call_1",
  );
  if (failed.type !== "tool.failed") throw new Error("Expected a failed tool");
  expect(failed.error).toContain("read-only");

  expect(ran).toBe(false);
  expect(events.events.some((event) => event.type === "approval.requested")).toBe(
    false,
  );
  events.close();
});

it("records the declared effects of each tool call in the session log", async () => {
  const { kernel, workspace } = await start({
    answers: [
      {
        toolCalls: [
          {
            id: "call_1",
            name: "write_file",
            arguments: write("note.txt", "hello"),
          },
          {
            id: "call_2",
            name: "run_command",
            arguments: JSON.stringify({ command: "true" }),
          },
          { id: "call_3", name: "echo", arguments: '{"text":"no effects"}' },
        ],
      },
      { text: ["Done."] },
    ],
  });
  const session = await createSession(kernel.url, workspace);

  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "do three things" },
  });
  const entries = await waitForToolResults(kernel.url, session.id, 3);

  const calls = entries.filter((entry) => entry.type === "tool_call");
  expect(calls[0]).toMatchObject({
    name: "write_file",
    effects: [{ kind: "file-write", path: join(workspace, "note.txt") }],
  });
  expect(calls[1]).toMatchObject({
    name: "run_command",
    effects: [{ kind: "command" }],
  });
  // A tool that declares nothing says "unknown": no effects, not an empty list.
  expect(calls[2]).toMatchObject({ name: "echo" });
  expect(calls[2]).not.toHaveProperty("effects");
});

it("reports a tool whose effects cannot be decided without running it", async () => {
  let ran = false;
  const broken: Tool = {
    name: "broken_effects",
    description: "Test tool whose effect check throws.",
    parameters: { type: "object", properties: {} },
    effects: () => {
      throw new Error("effect check exploded");
    },
    execute: async () => {
      ran = true;
      return { content: "should not run" };
    },
  };
  const { kernel, workspace } = await start({
    answers: [
      { toolCalls: [{ id: "call_1", name: "broken_effects", arguments: "{}" }] },
      { text: ["Understood."] },
    ],
    tools: [broken],
  });
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);

  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "do it" },
  });
  const failed = await events.waitFor(
    (event) => event.type === "tool.failed" && event.callId === "call_1",
  );
  if (failed.type !== "tool.failed") throw new Error("Expected a failed tool");
  expect(failed.error).toContain("effect check exploded");
  // The failure stays inside the call: the tool never ran and the task went on.
  expect(ran).toBe(false);
  await events.waitFor(
    (event) => event.type === "message.delta" && event.delta === "Understood.",
  );
  events.close();
});

it("starts from the scope and the browser approval setting in the config file", async () => {
  const { kernel } = await start({
    configFile: {
      permissions: { scope: "read-only" },
      browser: { actionsNeedApproval: true },
    },
  });

  const settings = await api<KernelSettings>(kernel.url, "/settings");
  expect(settings.body).toMatchObject({
    permissions: { scope: "read-only" },
    browser: { engine: "chromium", actionsNeedApproval: true },
  });
});
