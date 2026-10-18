import type { SessionEntry, SessionSummary } from "../../src/kernel/session.ts";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { TRUNCATION_NOTICE } from "../../src/kernel/loop.ts";
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

it("runs a command and returns output, exit code and duration", async () => {
  const { kernel, model, workspace } = await start({
    answers: [
      {
        toolCalls: [
          {
            id: "call_1",
            name: "run_command",
            arguments: JSON.stringify({ command: "printf 'hello\\n'" }),
          },
        ],
      },
      { text: ["Done."] },
    ],
  });
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);

  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "say hello" },
  });
  const completed = await events.waitFor(
    (event) => event.type === "tool.completed" && event.callId === "call_1",
  );
  if (completed.type !== "tool.completed") throw new Error("Expected a completed tool");
  expect(completed.result).toContain("exit code: 0");
  expect(completed.result).toMatch(/duration: \d+ms/);
  expect(completed.result).toContain("hello");

  await events.waitFor(
    (event) => event.type === "session.updated" && event.session.entryCount === 4,
  );
  const fedBack = model.requests[1]?.messages.at(-1);
  expect(fedBack).toMatchObject({ role: "tool", tool_call_id: "call_1" });
  expect(fedBack?.content).toContain("hello");
  events.close();
});

it("reports a failing command to the model instead of stopping the task", async () => {
  const { kernel, model, workspace } = await start({
    answers: [
      {
        toolCalls: [
          {
            id: "call_1",
            name: "run_command",
            arguments: JSON.stringify({ command: "echo broken >&2; exit 3" }),
          },
        ],
      },
      { text: ["Fixing it."] },
    ],
  });
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);

  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "run the failing command" },
  });
  const failed = await events.waitFor(
    (event) => event.type === "tool.failed" && event.callId === "call_1",
  );
  if (failed.type !== "tool.failed") throw new Error("Expected a failed tool");
  expect(failed.error).toContain("exit code: 3");
  expect(failed.error).toContain("broken");

  await events.waitFor(
    (event) => event.type === "session.updated" && event.session.entryCount === 4,
  );
  expect(model.requests[1]?.messages.at(-1)?.content).toContain("exit code: 3");
  events.close();
});

it("cuts long command output at the result limit", async () => {
  const { kernel, workspace } = await start({
    answers: [
      {
        toolCalls: [
          {
            id: "call_1",
            name: "run_command",
            arguments: JSON.stringify({
              command: "printf '%*s' 9000 '' | tr ' ' x",
            }),
          },
        ],
      },
      { text: ["Done."] },
    ],
  });
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);

  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "print a lot" },
  });
  const completed = await events.waitFor(
    (event) => event.type === "tool.completed" && event.callId === "call_1",
  );
  if (completed.type !== "tool.completed") throw new Error("Expected a completed tool");
  expect(completed.result.startsWith("exit code: 0")).toBe(true);
  expect(completed.result.endsWith(TRUNCATION_NOTICE)).toBe(true);
  expect(completed.result.length).toBe(8_000 + TRUNCATION_NOTICE.length);
  events.close();
});

it("runs a command in a workspace subdirectory when cwd is set", async () => {
  const { kernel, workspace } = await start({
    answers: [
      {
        toolCalls: [
          {
            id: "call_1",
            name: "run_command",
            arguments: JSON.stringify({ command: "pwd", cwd: "sub" }),
          },
        ],
      },
      { text: ["Done."] },
    ],
  });
  await mkdir(join(workspace, "sub"), { recursive: true });
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);

  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "where am I" },
  });
  const completed = await events.waitFor(
    (event) => event.type === "tool.completed" && event.callId === "call_1",
  );
  if (completed.type !== "tool.completed") throw new Error("Expected a completed tool");
  expect(completed.result).toContain(join(workspace, "sub"));
  events.close();
});

it("stops a command that runs past the configured timeout", async () => {
  const { kernel, workspace } = await start({
    command: { timeoutMs: 250 },
    answers: [
      {
        toolCalls: [
          {
            id: "call_1",
            name: "run_command",
            arguments: JSON.stringify({ command: "sleep 5" }),
          },
        ],
      },
      { text: ["Done."] },
    ],
  });
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);

  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "start a long command" },
  });
  const failed = await events.waitFor(
    (event) => event.type === "tool.failed" && event.callId === "call_1",
  );
  if (failed.type !== "tool.failed") throw new Error("Expected a failed tool");
  expect(failed.error).toContain("timed out after 250ms");
  events.close();
});

it("honours a timeout the model passes per call", async () => {
  const { kernel, workspace } = await start({
    answers: [
      {
        toolCalls: [
          {
            id: "call_1",
            name: "run_command",
            arguments: JSON.stringify({ command: "sleep 5", timeoutMs: 300 }),
          },
        ],
      },
      { text: ["Done."] },
    ],
  });
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);

  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "start a long command" },
  });
  const failed = await events.waitFor(
    (event) => event.type === "tool.failed" && event.callId === "call_1",
  );
  if (failed.type !== "tool.failed") throw new Error("Expected a failed tool");
  expect(failed.error).toContain("timed out after 300ms");
  events.close();
});

it("kills a running command when the user cancels the task", async () => {
  const { kernel, workspace } = await start({
    answers: [
      {
        toolCalls: [
          {
            id: "call_1",
            name: "run_command",
            arguments: JSON.stringify({ command: "sleep 10" }),
          },
        ],
      },
    ],
  });
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);

  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "start a long command" },
  });
  await events.waitFor(
    (event) => event.type === "tool.started" && event.callId === "call_1",
  );

  const cancelled = await api<{ cancelled: boolean }>(
    kernel.url,
    `/sessions/${session.id}/cancel`,
    { method: "POST" },
  );
  expect(cancelled.body).toEqual({ cancelled: true });

  await events.waitFor(
    (event) => event.type === "session.updated" && event.session.entryCount === 4,
  );
  const detail = await api<{ entries: SessionEntry[] }>(
    kernel.url,
    `/sessions/${session.id}`,
  );
  expect(detail.body.entries.map((entry) => entry.type)).toEqual([
    "message",
    "tool_call",
    "tool_result",
    "message",
  ]);
  const result = detail.body.entries[2];
  expect(result).toMatchObject({ type: "tool_result", isError: true });
  expect((result as { content: string }).content).toMatch(/cancelled/i);
  const last = detail.body.entries.at(-1);
  expect(last).toMatchObject({ role: "system" });
  expect((last as { content: string }).content).toMatch(/cancel/i);
  events.close();
});
