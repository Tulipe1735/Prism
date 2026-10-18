import type { SessionSummary } from "../../src/kernel/session.ts";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
