import type { SessionEntry, SessionSummary } from "../../src/kernel/session.ts";
import { expect, it } from "vitest";
import { api, startTestKernel } from "../kernel/harness.ts";
import {
  groupSessions,
  isTaskRunning,
  parseUnifiedDiff,
  searchSessions,
  toArtifacts,
  toChanges,
  toTimeline,
} from "../../src/workbench/ui/derive.ts";
import type { TimelineStep, ToolStep } from "../../src/workbench/ui/derive.ts";

const DIFF = `Changed 1 file:
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 export function main() {
-  return 1;
+  return 2;
 }
+export const done = true;
`;

function entry<T extends SessionEntry>(value: T): T {
  return value;
}

let counter = 0;
function id(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

function message(
  role: "user" | "assistant" | "system",
  content: string,
  parentId: string | null,
): SessionEntry {
  return entry({
    type: "message",
    id: id("message"),
    parentId,
    timestamp: "2026-10-18T09:00:00.000Z",
    role,
    content,
  });
}

function toolCall(
  callId: string,
  name: string,
  args: unknown,
  parentId: string | null,
): SessionEntry {
  return entry({
    type: "tool_call",
    id: id("call"),
    parentId,
    timestamp: "2026-10-18T09:00:01.000Z",
    callId,
    name,
    arguments: JSON.stringify(args),
  });
}

function toolResult(
  callId: string,
  content: string,
  isError: boolean,
  parentId: string | null,
): SessionEntry {
  return entry({
    type: "tool_result",
    id: id("result"),
    parentId,
    timestamp: "2026-10-18T09:00:02.000Z",
    callId,
    content,
    isError,
  });
}

function summary(overrides: Partial<SessionSummary>): SessionSummary {
  return {
    id: "session",
    workspace: "/home/demo/one",
    createdAt: "2026-10-18T09:00:00.000Z",
    updatedAt: "2026-10-18T09:00:00.000Z",
    entryCount: 0,
    leafId: null,
    ...overrides,
  };
}

it("groups sessions by workspace with the most recent group first", () => {
  const groups = groupSessions([
    summary({
      id: "a",
      workspace: "/home/demo/one",
      updatedAt: "2026-10-18T09:00:00.000Z",
    }),
    summary({
      id: "b",
      workspace: "/home/demo/two",
      updatedAt: "2026-10-18T11:00:00.000Z",
    }),
    summary({
      id: "c",
      workspace: "/home/demo/one",
      updatedAt: "2026-10-18T10:00:00.000Z",
    }),
  ]);

  expect(groups.map((group) => group.workspace)).toEqual([
    "/home/demo/two",
    "/home/demo/one",
  ]);
  expect(groups[1]?.sessions.map((session) => session.id)).toEqual(["c", "a"]);
});

it("searches sessions by title, workspace and id", () => {
  const sessions = [
    summary({ id: "6f1c9a3e-1111", title: "Fix the login", workspace: "/home/demo/app" }),
    summary({ id: "b0a1c2d3-2222", workspace: "/srv/website" }),
  ];

  expect(searchSessions(sessions, "  ").map((session) => session.id)).toHaveLength(2);
  expect(searchSessions(sessions, "LOGIN").map((session) => session.id)).toEqual([
    "6f1c9a3e-1111",
  ]);
  expect(searchSessions(sessions, "website").map((session) => session.id)).toEqual([
    "b0a1c2d3-2222",
  ]);
  expect(searchSessions(sessions, "b0a1c2").map((session) => session.id)).toEqual([
    "b0a1c2d3-2222",
  ]);
  expect(searchSessions(sessions, "nothing")).toEqual([]);
});

it("builds a timeline that pairs tool calls with their results", () => {
  const user = message("user", "please fix it", null);
  const call = toolCall("call-1", "edit_file", { path: "src/app.ts" }, user.id);
  const result = toolResult("call-1", DIFF, false, call.id);
  const assistant = message("assistant", "fixed", result.id);

  const timeline = toTimeline([user, call, result, assistant]);
  expect(timeline.map((step) => step.kind)).toEqual(["message", "tool", "message"]);
  expect(timeline[0]).toMatchObject({ kind: "message", role: "user", content: "please fix it" });
  expect(timeline[1]).toMatchObject({
    kind: "tool",
    callId: "call-1",
    name: "edit_file",
    target: "src/app.ts",
    result: DIFF,
    state: "ok",
  });
  expect(timeline[2]).toMatchObject({ kind: "message", role: "assistant", content: "fixed" });
});

it("marks a tool call without a result as running and a failed result as failed", () => {
  const call = toolCall("call-1", "run_command", { command: "pnpm test" }, null);
  const failed = toolResult("call-1", "1 test failed", true, call.id);
  const pending = toolCall("call-2", "echo", { text: "hi" }, failed.id);

  const steps = toTimeline([call, failed, pending]);
  expect(toolStep(steps[0])).toMatchObject({
    callId: "call-1",
    name: "run_command",
    state: "failed",
    result: "1 test failed",
  });
  expect(toolStep(steps[0]).target).toBeUndefined();
  expect(toolStep(steps[1])).toMatchObject({ callId: "call-2", state: "running" });
  expect(toolStep(steps[1]).result).toBeUndefined();
});

function toolStep(step: TimelineStep | undefined): ToolStep {
  if (step?.kind !== "tool")
    throw new Error(`Expected a tool step, received ${JSON.stringify(step)}`);
  return step;
}

it("keeps text that is still streaming as its own step", () => {
  const user = message("user", "hi", null);
  const deltas = new Map([["streamed-1", "thinking about it"]]);

  const timeline = toTimeline([user], { deltas });
  expect(timeline.at(-1)).toMatchObject({
    kind: "message",
    id: "streamed-1",
    role: "assistant",
    content: "thinking about it",
    streaming: true,
  });

  // The delta turns into the persisted entry once the log carries it.
  const persisted = entry({
    type: "message",
    id: "streamed-1",
    parentId: user.id,
    timestamp: "2026-10-18T09:00:03.000Z",
    role: "assistant",
    content: "thinking about it",
  });
  const settled = toTimeline([user, persisted], { deltas });
  expect(settled.at(-1)).toMatchObject({ id: "streamed-1", streaming: false });
});

it("reads a unified diff out of a tool result and counts its lines", () => {
  const parsed = parseUnifiedDiff(DIFF);
  expect(parsed).not.toBeNull();
  expect(parsed?.map((line) => line.kind)).toEqual([
    "meta",
    "meta",
    "hunk",
    "context",
    "remove",
    "add",
    "context",
    "add",
  ]);
  expect(parsed?.map((line) => line.text)).toContain("+  return 2;");
  expect(parseUnifiedDiff("cloned the repository")).toBeNull();
});

it("collects file changes with their diff and latest artifact state", () => {
  const call = toolCall("call-1", "edit_file", { path: "src/app.ts" }, null);
  const result = toolResult("call-1", DIFF, false, call.id);
  const read = toolCall("call-2", "read_file", { path: "README.md" }, result.id);
  const readResult = toolResult("call-2", "# Prism", false, read.id);
  const failedWrite = toolCall("call-3", "write_file", { path: "src/app.ts" }, readResult.id);
  const failedResult = toolResult("call-3", "permission denied", true, failedWrite.id);

  expect(toChanges([call, result, read, readResult, failedWrite, failedResult])).toMatchObject([
    { path: "src/app.ts", tool: "edit_file", state: "ok", added: 2, removed: 1 },
    { path: "src/app.ts", tool: "write_file", state: "failed", added: 0, removed: 0 },
  ]);

  expect(toArtifacts([call, result, read, readResult, failedWrite, failedResult])).toMatchObject([
    { path: "src/app.ts", calls: 2, state: "failed", added: 2, removed: 1 },
  ]);
});

it("reads the task state from the last log entry", () => {
  const user = message("user", "start", null);
  const call = toolCall("call-1", "echo", { text: "hi" }, user.id);
  const result = toolResult("call-1", "hi", false, call.id);
  const assistant = message("assistant", "done", result.id);
  const system = message("system", "Task failed: no key", assistant.id);

  expect(isTaskRunning([user])).toBe(true);
  expect(isTaskRunning([user, call])).toBe(true);
  expect(isTaskRunning([user, call, result])).toBe(true);
  expect(isTaskRunning([user, call, result, assistant])).toBe(false);
  expect(isTaskRunning([user, system])).toBe(false);
  expect(isTaskRunning([])).toBe(false);
});

it("derives the timeline from a real kernel session log", async () => {
  const harness = await startTestKernel({
    answers: [
      { text: ["Let me change it."], toolCalls: [{ id: "call-42", name: "echo", arguments: '{"text":"hello kernel"}' }] },
      { text: ["All done."] },
    ],
  });
  try {
    const created = await api<{ session: SessionSummary }>(
      harness.kernel.url,
      "/sessions",
      { method: "POST", body: { workspace: harness.workspace, title: "real log" } },
    );
    await api(harness.kernel.url, `/sessions/${created.body.session.id}/messages`, {
      method: "POST",
      body: { text: "change something" },
    });
    const log = await waitForLeaf(harness.kernel.url, created.body.session.id, "message");

    const timeline = toTimeline(log.entries);
    expect(timeline.map((step) => step.kind)).toEqual([
      "message",
      "message",
      "tool",
      "message",
    ]);
    expect(timeline[0]).toMatchObject({ role: "user", content: "change something" });
    expect(timeline[2]).toMatchObject({
      kind: "tool",
      name: "echo",
      state: "ok",
      result: "hello kernel",
    });
    expect(timeline.at(-1)).toMatchObject({ role: "assistant", content: "All done." });
    expect(isTaskRunning(log.entries)).toBe(false);
  } finally {
    await harness.cleanup();
  }
});

/** Waits until the model stopped talking, i.e. the leaf is a finished message. */
async function waitForLeaf(
  url: string,
  sessionId: string,
  kind: "message",
): Promise<{ entries: SessionEntry[] }> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const log = await api<{ entries: SessionEntry[] }>(url, `/sessions/${sessionId}`);
    const leaf = log.body.entries.at(-1);
    if (leaf !== undefined && leaf.type === kind && !isTaskRunning(log.body.entries))
      return log.body;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("The scripted task never reached its last message");
}
