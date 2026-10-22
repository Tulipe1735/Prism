import type { KernelEvent } from "../../src/kernel/events.ts";
import type { SessionEntry } from "../../src/kernel/session.ts";
import type { Tool } from "../../src/kernel/tool.ts";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  KernelApiError,
  KernelClient,
  parseSse,
} from "../../src/workbench/ui/client.ts";
import { isTaskRunning } from "../../src/workbench/ui/derive.ts";
import { startTestKernel } from "../kernel/harness.ts";

/** Stands in for the file tools of 03: asks once, then reports the answer. */
const askTool: Tool = {
  name: "write_outside",
  description: "writes outside the workspace after one approval",
  parameters: { type: "object", properties: {} },
  async execute(_args, context) {
    const approved = await context.requestApproval({
      reason: "The target is outside the workspace",
      target: "/etc/hosts",
      impact: "Would append one line to a system file",
    });
    return approved
      ? { content: "wrote /etc/hosts" }
      : { content: "The user refused; nothing was written.", isError: true };
  },
};

async function waitFor<T>(
  predicate: () => T | Promise<T>,
  label: string,
): Promise<NonNullable<T>> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const value = await predicate();
    if (value) return value as NonNullable<T>;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

it("talks to the kernel over HTTP and maps coded errors", async () => {
  const harness = await startTestKernel();
  try {
    const client = new KernelClient({ baseUrl: harness.kernel.url });

    expect(await client.status()).toMatchObject({ status: "ready" });
    const settings = await client.settings();
    expect(settings).toMatchObject({
      dataDir: harness.dataDir,
      permissions: { scope: "workspace-write" },
      browser: { engine: "chromium" },
    });
    expect(settings.model.hasApiKey).toBe(true);

    const created = await client.createSession({
      workspace: harness.workspace,
      title: "first",
    });
    expect(await client.listSessions(harness.workspace)).toMatchObject([
      { id: created.id },
    ]);
    expect(await client.listSessions("/elsewhere")).toEqual([]);

    const renamed = await client.renameSession(created.id, "second");
    expect(renamed.title).toBe("second");
    const read = await client.readSession(created.id);
    expect(read).toMatchObject({ session: { title: "second" }, entries: [] });

    const missing = client
      .readSession("11111111-2222-3333-4444-555555555555")
      .catch((error: unknown) => error);
    expect(await missing).toBeInstanceOf(KernelApiError);
    expect(await missing).toMatchObject({ code: "SESSION_NOT_FOUND", status: 404 });

    await client.deleteSession(created.id);
    expect(await client.listSessions()).toEqual([]);
  } finally {
    await harness.cleanup();
  }
});

it("streams a task: deltas, tool process and session updates", async () => {
  const harness = await startTestKernel({
    answers: [
      {
        text: ["Let me look. "],
        toolCalls: [
          { id: "call-7", name: "echo", arguments: '{"text":"from the kernel"}' },
        ],
      },
      { text: ["Done."] },
    ],
  });
  try {
    const client = new KernelClient({ baseUrl: harness.kernel.url });
    const session = await client.createSession({ workspace: harness.workspace });
    const events: KernelEvent[] = [];
    const close = client.openEvents({ onEvent: (event) => events.push(event) });
    await waitFor(
      () => events.some((event) => event.type === "kernel.status"),
      "status",
    );

    await client.sendMessage(session.id, "please echo something");
    await waitFor(
      () => events.some((event) => event.type === "tool.completed"),
      "the tool result",
    );
    await waitFor(
      () => events.at(-1)?.type === "session.updated" && events.length > 3,
      "the session update after the turn",
    );
    const log = await waitFor(async () => {
      const read = await client.readSession(session.id);
      return isTaskRunning(read.entries) ? null : read;
    }, "the finished turn");

    expect(
      events
        .filter((event) => event.type === "message.delta")
        .map((event) => (event as { delta: string }).delta),
    ).toEqual(["Let me look. ", "Done."]);
    expect(events.find((event) => event.type === "tool.started")).toMatchObject({
      callId: "call-7",
      name: "echo",
      arguments: { text: "from the kernel" },
    });
    expect(events.find((event) => event.type === "tool.completed")).toMatchObject({
      callId: "call-7",
      result: "from the kernel",
    });
    expect(log?.entries.map((entry) => entry.type)).toEqual([
      "message",
      "message",
      "tool_call",
      "tool_result",
      "message",
    ]);
    close();
  } finally {
    await harness.cleanup();
  }
});

it("changes the settings the kernel lets the workbench change", async () => {
  const harness = await startTestKernel();
  try {
    const client = new KernelClient({ baseUrl: harness.kernel.url });

    const readOnly = await client.updateSettings({
      permissions: { scope: "read-only" },
    });
    expect(readOnly.permissions.scope).toBe("read-only");
    expect(readOnly.browser.actionsNeedApproval).toBe(false);
    expect((await client.settings()).permissions.scope).toBe("read-only");

    const guarded = await client.updateSettings({
      browser: { actionsNeedApproval: true },
    });
    expect(guarded).toMatchObject({
      permissions: { scope: "read-only" },
      browser: { actionsNeedApproval: true },
    });

    // Model, engine and search source are editable too; the key never comes back.
    const switched = await client.updateSettings({
      model: {
        model: "deepseek-reasoner",
        apiKey: "sk-written",
        thinking: "max",
      },
      browser: { engine: "firefox" },
      search: { provider: "deepseek", baseUrl: "https://gateway.example.com" },
    });
    expect(switched).toMatchObject({
      model: { model: "deepseek-reasoner", hasApiKey: true, thinking: "max" },
      browser: { engine: "firefox", actionsNeedApproval: true },
      search: { provider: "deepseek", baseUrl: "https://gateway.example.com" },
    });
    expect(JSON.stringify(switched)).not.toContain("sk-written");

    const refused = await client
      .updateSettings({ permissions: { scope: "wide-open" } } as never)
      .catch((error: unknown) => error);
    expect(refused).toMatchObject({ code: "INVALID_REQUEST", status: 400 });
  } finally {
    await harness.cleanup();
  }
});

it("answers an approval the kernel asks for a write outside the workspace", async () => {
  const base = await mkdtemp(join(tmpdir(), "prism-workbench-approval-"));
  const workspace = join(base, "workspace");
  const outside = join(base, "outside-the-workspace.txt");
  const harness = await startTestKernel({
    workspace,
    answers: [
      {
        toolCalls: [
          {
            id: "call-outside",
            name: "write_file",
            arguments: JSON.stringify({ path: outside, content: "outside\n" }),
          },
        ],
      },
      { text: ["Done."] },
    ],
  });
  try {
    const client = new KernelClient({ baseUrl: harness.kernel.url });
    const session = await client.createSession({ workspace: harness.workspace });
    const events: KernelEvent[] = [];
    const close = client.openEvents({ onEvent: (event) => events.push(event) });
    await waitFor(
      () => events.some((event) => event.type === "kernel.status"),
      "the open event stream",
    );
    await client.sendMessage(session.id, "write outside the workspace");

    const requested = await waitFor(
      () => events.find((event) => event.type === "approval.requested"),
      "the approval request",
    );
    expect(requested).toMatchObject({
      sessionId: session.id,
      tool: "write_file",
      reason: "Writes a file outside the workspace",
      target: outside,
    });
    await client.answerApproval(
      session.id,
      (requested as { requestId: string }).requestId,
      true,
    );

    await waitFor(async () => {
      const read = await client.readSession(session.id);
      return read.entries.some(
        (entry) => entry.type === "tool_result" && entry.content.includes("Wrote"),
      );
    }, "the write result");
    expect(await readFile(outside, "utf8")).toBe("outside\n");
    close();
  } finally {
    await harness.cleanup();
    await rm(base, { recursive: true, force: true });
  }
});

it("answers an approval request and reports the outcome", async () => {
  const harness = await startTestKernel({
    answers: [
      { toolCalls: [{ id: "call-9", name: "write_outside", arguments: "{}" }] },
      { text: ["Noted."] },
    ],
    tools: [askTool],
  });
  try {
    const client = new KernelClient({ baseUrl: harness.kernel.url });
    const session = await client.createSession({ workspace: harness.workspace });
    const events: KernelEvent[] = [];
    const close = client.openEvents({ onEvent: (event) => events.push(event) });
    await waitFor(
      () => events.some((event) => event.type === "kernel.status"),
      "status",
    );

    await client.sendMessage(session.id, "write outside the workspace");
    await waitFor(
      () => events.some((event) => event.type === "approval.requested"),
      "the approval request",
    );
    const requested = events.find((event) => event.type === "approval.requested");
    expect(requested).toMatchObject({
      sessionId: session.id,
      tool: "write_outside",
      reason: "The target is outside the workspace",
      target: "/etc/hosts",
      impact: "Would append one line to a system file",
    });
    const requestId = (requested as { requestId: string }).requestId;

    await client.answerApproval(session.id, requestId, true);
    await waitFor(
      () =>
        events.some(
          (event) => event.type === "approval.resolved" && event.approved === true,
        ),
      "the approval result",
    );
    const again = client
      .answerApproval(session.id, requestId, true)
      .catch((error: unknown) => error);
    expect(await again).toMatchObject({ code: "APPROVAL_NOT_FOUND", status: 404 });

    await waitFor(
      async () => !isTaskRunning((await client.readSession(session.id)).entries),
      "the finished turn",
    );
    const finished: { entries: SessionEntry[] } = await client.readSession(session.id);
    expect(
      finished.entries.find(
        (entry) => entry.type === "tool_result" && entry.content === "wrote /etc/hosts",
      ),
    ).toBeDefined();
    close();
  } finally {
    await harness.cleanup();
  }
});

it("compacts the open session on request and reports what happened", async () => {
  const harness = await startTestKernel({
    answers: [{ text: ["Done."] }],
  });
  try {
    const client = new KernelClient({ baseUrl: harness.kernel.url });
    const session = await client.createSession({ workspace: harness.workspace });
    await client.sendMessage(session.id, "a short task");
    await waitFor(
      async () => !isTaskRunning((await client.readSession(session.id)).entries),
      "the finished turn",
    );

    // Two entries are well inside the keep window: nothing to compact.
    expect(await client.compactSession(session.id)).toMatchObject({
      compacted: false,
    });
    const entries = (await client.readSession(session.id)).entries;
    expect(entries.some((entry) => entry.type === "compaction")).toBe(false);
  } finally {
    await harness.cleanup();
  }
});

it("refuses an approval so the tool reports the refusal", async () => {
  const harness = await startTestKernel({
    answers: [
      { toolCalls: [{ id: "call-9", name: "write_outside", arguments: "{}" }] },
      { text: ["Understood."] },
    ],
    tools: [askTool],
  });
  try {
    const client = new KernelClient({ baseUrl: harness.kernel.url });
    const session = await client.createSession({ workspace: harness.workspace });
    const events: KernelEvent[] = [];
    const close = client.openEvents({ onEvent: (event) => events.push(event) });
    await waitFor(
      () => events.some((event) => event.type === "kernel.status"),
      "status",
    );

    await client.sendMessage(session.id, "write outside the workspace");
    await waitFor(
      () => events.some((event) => event.type === "approval.requested"),
      "the approval request",
    );
    const requested = events.find((event) => event.type === "approval.requested");
    await client.answerApproval(
      session.id,
      (requested as { requestId: string }).requestId,
      false,
    );

    await waitFor(async () => {
      const read = await client.readSession(session.id);
      return read.entries.some(
        (entry) => entry.type === "tool_result" && entry.content.includes("refused"),
      );
    }, "the refusal result");
    const read = await client.readSession(session.id);
    expect(read.entries.find((entry) => entry.type === "tool_result")).toMatchObject({
      isError: true,
    });
    close();
  } finally {
    await harness.cleanup();
  }
});

it("cancels a running task and keeps the log consistent", async () => {
  const harness = await startTestKernel({
    answers: [{ text: ["thinking"], hold: true }],
  });
  try {
    const client = new KernelClient({ baseUrl: harness.kernel.url });
    const session = await client.createSession({ workspace: harness.workspace });
    const events: KernelEvent[] = [];
    const close = client.openEvents({ onEvent: (event) => events.push(event) });
    await waitFor(
      () => events.some((event) => event.type === "kernel.status"),
      "the open event stream",
    );
    await client.sendMessage(session.id, "keep thinking");
    await waitFor(
      () => events.some((event) => event.type === "message.delta"),
      "streaming text",
    );

    expect(await client.cancelSession(session.id)).toBe(true);
    await waitFor(async () => {
      const read = await client.readSession(session.id);
      return read.entries.some(
        (entry) =>
          entry.type === "message" &&
          entry.role === "system" &&
          entry.content.includes("cancelled"),
      );
    }, "the cancellation note");
    const read = await client.readSession(session.id);
    expect(read.entries.map((entry) => entry.type)).toEqual([
      "message",
      "message",
      "message",
    ]);
    expect(read.entries.at(-1)).toMatchObject({ role: "system" });
    expect(await client.cancelSession(session.id)).toBe(false);
    close();
  } finally {
    await harness.cleanup();
  }
});

it("reads SSE frames even when they arrive split", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(": keep-alive\n\nevent: message.delta\nda"));
      controller.enqueue(
        encoder.encode(
          'ta: {"type":"message.delta","sessionId":"s","entryId":"e","delta":"hi"}\n\n' +
            'data: {"type":"kernel.status","status":"ready","version":"0.1.6","dataDir":"/tmp"}\n\n',
        ),
      );
      controller.close();
    },
  });

  const events: KernelEvent[] = [];
  for await (const event of parseSse(stream)) events.push(event);
  expect(events).toMatchObject([
    { type: "message.delta", sessionId: "s", entryId: "e", delta: "hi" },
    { type: "kernel.status", status: "ready" },
  ]);
});
