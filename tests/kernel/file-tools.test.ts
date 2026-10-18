import type { SessionSummary } from "../../src/kernel/session.ts";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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

it("reads a workspace file the model asks for", async () => {
  const { kernel, model, workspace } = await start({
    answers: [
      {
        toolCalls: [
          { id: "call_1", name: "read_file", arguments: '{"path":"hello.txt"}' },
        ],
      },
      { text: ["Done."] },
    ],
  });
  await writeFile(join(workspace, "hello.txt"), "hello from disk\n");
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);

  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "read hello.txt" },
  });
  const completed = await events.waitFor(
    (event) => event.type === "tool.completed" && event.callId === "call_1",
  );
  if (completed.type !== "tool.completed") throw new Error("Expected a completed tool");
  expect(completed.result).toBe("hello from disk\n");

  await events.waitFor(
    (event) => event.type === "session.updated" && event.session.entryCount === 4,
  );
  expect(model.requests[1]?.messages.at(-1)).toMatchObject({
    role: "tool",
    content: "hello from disk\n",
    tool_call_id: "call_1",
  });
  events.close();
});

it("writes a file the model asks for, creating parent directories", async () => {
  const { kernel, workspace } = await start({
    answers: [
      {
        toolCalls: [
          {
            id: "call_1",
            name: "write_file",
            arguments: '{"path":"notes/idea.txt","content":"written by the model"}',
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
    body: { text: "save an idea" },
  });
  const completed = await events.waitFor(
    (event) => event.type === "tool.completed" && event.callId === "call_1",
  );
  if (completed.type !== "tool.completed") throw new Error("Expected a completed tool");
  expect(completed.result).toContain("notes/idea.txt");
  await events.waitFor(
    (event) => event.type === "session.updated" && event.session.entryCount === 4,
  );
  expect(await readFile(join(workspace, "notes", "idea.txt"), "utf8")).toBe(
    "written by the model",
  );
  events.close();
});

it("lists a directory, marking subdirectories and flagging empty ones", async () => {
  const { kernel, workspace } = await start({
    answers: [
      {
        toolCalls: [
          { id: "call_1", name: "list_directory", arguments: "{}" },
          {
            id: "call_2",
            name: "list_directory",
            arguments: '{"path":"empty"}',
          },
        ],
      },
      { text: ["Done."] },
    ],
  });
  await mkdir(join(workspace, "src"), { recursive: true });
  await mkdir(join(workspace, "empty"), { recursive: true });
  await writeFile(join(workspace, "README.md"), "# readme\n");
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);

  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "list the workspace" },
  });
  const first = await events.waitFor(
    (event) => event.type === "tool.completed" && event.callId === "call_1",
  );
  if (first.type !== "tool.completed") throw new Error("Expected a completed tool");
  expect(first.result).toBe("README.md\nempty/\nsrc/");
  const second = await events.waitFor(
    (event) => event.type === "tool.completed" && event.callId === "call_2",
  );
  if (second.type !== "tool.completed") throw new Error("Expected a completed tool");
  expect(second.result).toBe("(empty directory)");
  events.close();
});

it("finds files by glob pattern inside the workspace", async () => {
  const { kernel, workspace } = await start({
    answers: [
      {
        toolCalls: [
          { id: "call_1", name: "glob", arguments: '{"pattern":"**/*.ts"}' },
          { id: "call_2", name: "glob", arguments: '{"pattern":"*.md"}' },
        ],
      },
      { text: ["Done."] },
    ],
  });
  await mkdir(join(workspace, "src"), { recursive: true });
  await writeFile(join(workspace, "top.txt"), "top\n");
  await writeFile(join(workspace, "src", "a.ts"), "export const a = 1;\n");
  await writeFile(join(workspace, "src", "b.md"), "# b\n");
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);

  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "find the typescript files" },
  });
  const first = await events.waitFor(
    (event) => event.type === "tool.completed" && event.callId === "call_1",
  );
  if (first.type !== "tool.completed") throw new Error("Expected a completed tool");
  expect(first.result).toBe("src/a.ts");
  const second = await events.waitFor(
    (event) => event.type === "tool.completed" && event.callId === "call_2",
  );
  if (second.type !== "tool.completed") throw new Error("Expected a completed tool");
  expect(second.result).toBe('No files matched "*.md".');
  events.close();
});

it("searches file contents and reports path and line", async () => {
  const { kernel, workspace } = await start({
    answers: [
      {
        toolCalls: [
          { id: "call_1", name: "grep", arguments: '{"pattern":"TODO"}' },
          { id: "call_2", name: "grep", arguments: '{"pattern":"nowhere"}' },
        ],
      },
      { text: ["Done."] },
    ],
  });
  await mkdir(join(workspace, "src"), { recursive: true });
  await writeFile(
    join(workspace, "src", "a.ts"),
    "const a = 1;\n// TODO: fix this\n",
  );
  await writeFile(join(workspace, "src", "b.md"), "# b\n");
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);

  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "find the TODO notes" },
  });
  const first = await events.waitFor(
    (event) => event.type === "tool.completed" && event.callId === "call_1",
  );
  if (first.type !== "tool.completed") throw new Error("Expected a completed tool");
  expect(first.result).toBe("src/a.ts:2: // TODO: fix this");
  const second = await events.waitFor(
    (event) => event.type === "tool.completed" && event.callId === "call_2",
  );
  if (second.type !== "tool.completed") throw new Error("Expected a completed tool");
  expect(second.result).toBe('No matches for "nowhere".');
  events.close();
});

it("cuts a long read at the result limit with a visible notice", async () => {
  const { kernel, workspace } = await start({
    answers: [
      {
        toolCalls: [
          { id: "call_1", name: "read_file", arguments: '{"path":"big.txt"}' },
        ],
      },
      { text: ["Done."] },
    ],
  });
  await writeFile(join(workspace, "big.txt"), "x".repeat(9_000));
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);

  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "read the big file" },
  });
  const completed = await events.waitFor(
    (event) => event.type === "tool.completed" && event.callId === "call_1",
  );
  if (completed.type !== "tool.completed") throw new Error("Expected a completed tool");
  expect(completed.result).toBe(
    `${"x".repeat(8_000)}\n[result truncated after 8000 characters]`,
  );
  events.close();
});

it("reads outside the workspace only after the user approves once", async () => {
  const { kernel, model, workspace } = await start({
    answers: [
      {
        toolCalls: [
          {
            id: "call_1",
            name: "read_file",
            arguments: '{"path":"../outside.txt"}',
          },
        ],
      },
      { text: ["Done."] },
    ],
  });
  const outside = join(dirname(workspace), "outside.txt");
  await writeFile(outside, "outside content\n");
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);

  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "read the file above the workspace" },
  });
  const requested = await events.waitFor(
    (event) => event.type === "approval.requested",
  );
  if (requested.type !== "approval.requested")
    throw new Error("Expected an approval request");
  expect(requested).toMatchObject({
    sessionId: session.id,
    tool: "read_file",
    target: outside,
  });
  expect(requested.reason).toMatch(/outside the workspace/);

  const answered = await api<{ approved: boolean }>(
    kernel.url,
    `/sessions/${session.id}/approvals/${requested.requestId}`,
    { method: "POST", body: { approved: true } },
  );
  expect(answered.status).toBe(200);
  const completed = await events.waitFor(
    (event) => event.type === "tool.completed" && event.callId === "call_1",
  );
  if (completed.type !== "tool.completed") throw new Error("Expected a completed tool");
  expect(completed.result).toBe("outside content\n");

  await events.waitFor(
    (event) => event.type === "session.updated" && event.session.entryCount === 4,
  );
  expect(model.requests[1]?.messages.at(-1)).toMatchObject({
    role: "tool",
    content: "outside content\n",
  });
  events.close();
});

it("does not write outside the workspace when the user refuses", async () => {
  const { kernel, model, workspace } = await start({
    answers: [
      {
        toolCalls: [
          {
            id: "call_1",
            name: "write_file",
            arguments: '{"path":"../blocked.txt","content":"nope"}',
          },
        ],
      },
      { text: ["Understood."] },
    ],
  });
  const outside = join(dirname(workspace), "blocked.txt");
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);

  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "write above the workspace" },
  });
  const requested = await events.waitFor(
    (event) => event.type === "approval.requested",
  );
  if (requested.type !== "approval.requested")
    throw new Error("Expected an approval request");
  expect(requested).toMatchObject({
    tool: "write_file",
    target: outside,
  });
  const answered = await api<{ approved: boolean }>(
    kernel.url,
    `/sessions/${session.id}/approvals/${requested.requestId}`,
    { method: "POST", body: { approved: false } },
  );
  expect(answered.body).toEqual({ approved: false });

  const failed = await events.waitFor(
    (event) => event.type === "tool.failed" && event.callId === "call_1",
  );
  if (failed.type !== "tool.failed") throw new Error("Expected a failed tool");
  expect(failed.error).toContain("refused");
  await events.waitFor(
    (event) => event.type === "session.updated" && event.session.entryCount === 4,
  );
  await expect(readFile(outside, "utf8")).rejects.toThrow();
  const fedBack = model.requests[1]?.messages.at(-1);
  expect(fedBack?.role).toBe("tool");
  expect(fedBack?.content).toContain("refused");
  events.close();
});
