import type { PluginEvent } from "../../packages/plugin-sdk/src/index.ts";
import type { NotionDocument } from "../../plugins/notion/src/protocol.ts";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { readBundle } from "../../packages/plugin-manager/src/bundle.ts";
import { KernelClient } from "../../src/workbench/ui/client.ts";
import {
  connectEvents,
  type EventStream,
  type KernelHarness,
  startTestKernel,
} from "../kernel/harness.ts";

let harness: KernelHarness | undefined;
let events: EventStream | undefined;
afterEach(async () => {
  events?.close();
  await harness?.cleanup();
  events = undefined;
  harness = undefined;
});

async function boot(options: Parameters<typeof startTestKernel>[0] = {}) {
  harness = await startTestKernel({
    ...options,
    configFile: { creator: { enabled: true } },
  });
  const manager = harness.kernel.kernel.ctx.creator;
  await manager.manage({
    action: "install",
    bundle: await readBundle(resolve("plugins/notion")),
  });
  expect(harness.kernel.kernel.ctx.tools.get("notion_read")).toBeUndefined();
  await manager.manage({ action: "enable", name: "notion" });
  const client = new KernelClient({ baseUrl: harness.kernel.url });
  const session = await client.createSession({ workspace: harness.workspace });
  const clientId = randomUUID();
  await client.pluginRequest("notion", "document.ready", session.id, {
    clientId,
    url: "https://app.notion.com/page",
  });
  events = await connectEvents(`${harness.kernel.url}/events`);
  const execute = (
    name: string,
    args = {},
    signal = new AbortController().signal,
    sessionId = session.id,
  ) =>
    harness!.kernel.kernel.ctx.tools.get(name)!.execute(args, {
      sessionId,
      signal,
      workspace: harness!.workspace,
      scope: "workspace-write",
      target: "wsl",
      permissions: harness!.kernel.kernel.permissions,
      requestApproval: async () => false,
    });
  return { client, session, clientId, execute, manager };
}

const document: NotionDocument = {
  url: "https://app.notion.com/page",
  title: "Project",
  revision: "a".repeat(64),
  content: "Original text",
  selection: "Original",
  editable: true,
};

async function command(): Promise<
  PluginEvent & { data: { id: string; clientId: string; kind: string; input: unknown } }
> {
  const event = await events!.waitFor(
    (entry) => entry.type === "plugin.event" && entry.name === "document.request",
  );
  expect(event.type).toBe("plugin.event");
  return event as PluginEvent & {
    data: { id: string; clientId: string; kind: string; input: unknown };
  };
}

it("reads through the active page and rejects foreign sessions, clients and invalid replies", async () => {
  const { client, session, clientId, execute } = await boot();
  const other = await client.createSession({ workspace: harness!.workspace });
  expect(await execute("notion_read", {}, undefined, other.id)).toMatchObject({
    isError: true,
  });
  const result = execute("notion_read");
  const request = await command();
  expect(request).toMatchObject({
    sessionId: session.id,
    data: { clientId, kind: "read" },
  });
  const reply = { id: request.data.id, clientId, document };
  await expect(
    client.pluginRequest("notion", "document.reply", other.id, reply),
  ).rejects.toMatchObject({ code: "REQUEST_EXPIRED" });
  await expect(
    client.pluginRequest("notion", "document.reply", session.id, {
      ...reply,
      clientId: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "REQUEST_EXPIRED" });
  await expect(
    client.pluginRequest("notion", "document.reply", session.id, {
      ...reply,
      document: { ...document, url: "https://example.com/" },
    }),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  await client.pluginRequest("notion", "document.reply", session.id, reply);
  expect(JSON.parse((await result).content)).toEqual(document);
  await expect(
    client.pluginRequest("notion", "document.reply", session.id, reply),
  ).rejects.toMatchObject({ code: "REQUEST_EXPIRED" });
});

it("cancels queued page operations and refuses replies from a superseded page", async () => {
  const { client, session, clientId, execute } = await boot();
  const controller = new AbortController();
  const cancelled = execute(
    "notion_apply",
    { revision: document.revision, text: "Replacement" },
    controller.signal,
  );
  const request = await command();
  controller.abort();
  expect(await cancelled).toMatchObject({
    isError: true,
    content: expect.stringContaining("取消"),
  });
  expect(
    await events!.waitFor(
      (event) => event.type === "plugin.event" && event.name === "document.cancel",
    ),
  ).toMatchObject({ sessionId: session.id, data: { id: request.data.id, clientId } });
  await expect(
    client.pluginRequest("notion", "document.reply", session.id, {
      ...request.data,
      document,
    }),
  ).rejects.toMatchObject({ code: "REQUEST_EXPIRED" });
  const pending = execute("notion_read");
  const old = await command();
  await client.pluginRequest("notion", "document.ready", session.id, {
    clientId: randomUUID(),
    url: document.url,
  });
  expect(await pending).toMatchObject({
    isError: true,
    content: expect.stringContaining("关闭或切换"),
  });
  await expect(
    client.pluginRequest("notion", "document.reply", session.id, {
      ...old.data,
      document,
    }),
  ).rejects.toMatchObject({ code: "REQUEST_EXPIRED" });
});

it("disposes page requests and tool registrations when disabled or a session is removed", async () => {
  const { client, session, execute, manager } = await boot();
  const pending = execute("notion_read");
  await command();
  await client.deleteSession(session.id);
  expect(await pending).toMatchObject({ isError: true });
  await manager.manage({ action: "disable", name: "notion" });
  expect(harness!.kernel.kernel.ctx.tools.get("notion_read")).toBeUndefined();
  expect(harness!.kernel.kernel.ctx.tools.get("notion_apply")).toBeUndefined();
  expect(await client.pluginUi()).toEqual([]);
  await expect(
    client.pluginRequest("notion", "document.ready", session.id, {}),
  ).rejects.toMatchObject({ status: 404 });
});

it("validates write input before asking the page to edit", async () => {
  const { client, session, execute } = await boot();
  for (const args of [
    {},
    { revision: document.revision, text: "" },
    { revision: "old", text: "new" },
    { revision: document.revision, text: "new", extra: true },
  ])
    expect(await execute("notion_apply", args)).toMatchObject({ isError: true });
  await expect(
    client.pluginRequest("notion", "document.ready", session.id, {
      clientId: randomUUID(),
      url: "http://app.notion.com/",
    }),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  await client.pluginRequest("notion", "document.detach", session.id, {
    clientId: "foreign",
  });
  const read = execute("notion_read");
  const request = await command();
  await client.pluginRequest("notion", "document.reply", session.id, {
    ...request.data,
    error: { message: "Page changed" },
  });
  expect(await read).toEqual({ isError: true, content: "Page changed" });
});

it("blocks native Notion edits in a read-only task through the shared permission policy", async () => {
  const { client, session } = await boot({
    scope: "read-only",
    answers: [
      {
        toolCalls: [
          {
            id: "edit",
            name: "notion_apply",
            arguments: JSON.stringify({
              revision: document.revision,
              text: "Forbidden",
            }),
          },
        ],
      },
      { text: ["Read-only edit refused."] },
    ],
  });
  await client.sendMessage(session.id, "Edit the selected text");
  await events!.waitFor((event) => event.type === "task.state" && !event.running);
  const entries = (await client.readSession(session.id)).entries;
  expect(entries).toContainEqual(
    expect.objectContaining({
      type: "tool_result",
      isError: true,
      content: expect.stringContaining("read-only"),
    }),
  );
  expect(
    events!.events.some(
      (event) => event.type === "plugin.event" && event.name === "document.request",
    ),
  ).toBe(false);
});
