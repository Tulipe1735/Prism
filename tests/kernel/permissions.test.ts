import type { SessionEntry, SessionSummary } from "../../src/kernel/session.ts";
import type { Tool, ToolContext } from "../../src/kernel/tool.ts";
import type { JsonValue } from "../../src/kernel/types.ts";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
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
  const response = await api<{ entries: SessionEntry[] }>(url, `/sessions/${sessionId}`);
  return response.body.entries;
}

function stringField(args: JsonValue, key: string): string {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return "";
  const value = (args as Record<string, JsonValue>)[key];
  return typeof value === "string" ? value : "";
}

function writeTarget(args: JsonValue, context: ToolContext): string {
  return resolve(context.workspace, stringField(args, "path"));
}

/**
 * Stands in for the file tool 03 adds: it declares the write it performs, and
 * the kernel checks that declaration before `execute` runs.
 */
const writeFileTool: Tool = {
  name: "write_file",
  description: "Test stand-in for the workspace file tool.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      text: { type: "string" },
    },
    required: ["path", "text"],
    additionalProperties: false,
  },
  effects: (args, context) => [
    { kind: "file-write", path: writeTarget(args, context) },
  ],
  execute: async (args, context) => {
    const path = writeTarget(args, context);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, stringField(args, "text"), "utf8");
    return { content: `Wrote ${path}.` };
  },
};

it("asks once for a write outside the workspace and asks again for the next one", async () => {
  const write = { path: "../outside/note.txt", text: "hello" };
  const { kernel, workspace } = await start({
    answers: [
      {
        toolCalls: [
          { id: "call_1", name: "write_file", arguments: JSON.stringify(write) },
        ],
      },
      {
        toolCalls: [
          { id: "call_2", name: "write_file", arguments: JSON.stringify(write) },
        ],
      },
      { text: ["Done."] },
    ],
    tools: [writeFileTool],
  });
  const outside = resolve(workspace, "..", "outside", "note.txt");
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);

  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "write the note" },
  });

  const first = await events.waitFor((event) => event.type === "approval.requested");
  if (first.type !== "approval.requested") throw new Error("Expected an approval request");
  expect(first).toMatchObject({ sessionId: session.id, tool: "write_file", target: outside });
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
  if (second.type !== "approval.requested") throw new Error("Expected an approval request");
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
  const write = { path: "../outside/note.txt", text: "hello" };
  const { kernel, model, workspace } = await start({
    answers: [
      {
        toolCalls: [
          { id: "call_1", name: "write_file", arguments: JSON.stringify(write) },
        ],
      },
      { text: ["I will not write there."] },
    ],
    tools: [writeFileTool],
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
  const fed = model.requests[1]?.messages.at(-1);
  expect(fed?.role).toBe("tool");
  expect(fed?.content).toContain("refused");
  events.close();
});

it("writes inside the workspace without asking", async () => {
  const write = { path: "src/note.txt", text: "hello" };
  const { kernel, workspace } = await start({
    answers: [
      {
        toolCalls: [
          { id: "call_1", name: "write_file", arguments: JSON.stringify(write) },
        ],
      },
      { text: ["Done."] },
    ],
    tools: [writeFileTool],
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
  expect(events.events.some((event) => event.type === "approval.requested")).toBe(false);
  events.close();
});
