import type {
  AgentSnapshot,
  ResourceReference,
} from "../../packages/plugin-sdk/src/index.ts";
import { File } from "node:buffer";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { KernelClient } from "../../src/workbench/ui/client.ts";
import { pluginBundle } from "../fixtures/plugin.ts";
import { type KernelHarness, startTestKernel } from "./harness.ts";

let harness: KernelHarness;
afterEach(async () => harness?.cleanup());

async function setup(answers: Parameters<typeof startTestKernel>[0] = {}) {
  harness = await startTestKernel({
    ...answers,
    configFile: { creator: { enabled: true } },
  });
  const manager = harness.kernel.kernel.ctx.creator;
  const bundle = pluginBundle("export function apply() {}", "host-client");
  bundle.manifest.ui = [
    { id: "view", slot: "workbench.panel", title: "Host Client", entry: "ui.ts" },
  ];
  bundle.files["ui.ts"] = "document.body.textContent='Host Client';";
  await manager.manage({ action: "install", bundle });
  await manager.manage({ action: "enable", name: "host-client" });
  const client = new KernelClient({ baseUrl: harness.kernel.url });
  const session = await client.createSession({ workspace: harness.workspace });
  const host = (
    method: Parameters<KernelClient["pluginHostRequest"]>[1],
    input?: unknown,
    sessionId = session.id,
  ) => client.pluginHostRequest("host-client", method, sessionId, input);
  return { manager, client, session, host };
}

it("routes a Standard plugin's message and binary attachment through the shared harness", async () => {
  const { host, session } = await setup({
    answers: [
      {
        toolCalls: [
          { id: "echo-call", name: "echo", arguments: '{"text":"through harness"}' },
        ],
      },
      { text: ["文件已收到"] },
    ],
  });
  // Agent access does not require Creator authoring capabilities.
  await harness.kernel.kernel.updateSettings({ creator: { enabled: false } });
  const data = new Uint8Array([0, 255, 1, 13, 10]).buffer;
  const resource = (await host("resources.upload", {
    name: "素材.bin",
    mediaType: "application/octet-stream",
    data,
  })) as ResourceReference;
  expect(resource).toMatchObject({ name: "素材.bin", size: 5 });
  expect(resource).not.toHaveProperty("path");
  const content = (await host("resources.read", { id: resource.id })) as {
    resource: ResourceReference;
    data: ArrayBuffer;
  };
  expect(new Uint8Array(content.data)).toEqual(new Uint8Array(data));
  expect(content.resource).toEqual(resource);
  const receipt = await host("agent.send", {
    text: "读取素材",
    context: "UI selection: selected-item",
    attachments: [resource.id],
  });
  expect(receipt).toHaveProperty("entryId");
  await harness.kernel.kernel.ctx.tasks.settle(session.id);
  const snapshot = (await host("agent.read")) as AgentSnapshot;
  expect(snapshot).toMatchObject({
    sessionId: session.id,
    running: false,
    pending: [],
  });
  expect(snapshot.entries[0]).toMatchObject({
    role: "user",
    content: "读取素材",
    context: "UI selection: selected-item",
    attachments: [{ id: resource.id }],
  });
  expect(snapshot.entries.at(-1)).toMatchObject({ content: "文件已收到" });
  expect(harness.model.requests[0]?.messages.at(-1)?.content).toContain("素材.bin");
  expect(harness.model.requests[0]?.messages.at(-1)?.content).toContain(
    "UI selection: selected-item",
  );
  expect(harness.model.requests[1]?.messages).toContainEqual(
    expect.objectContaining({ role: "tool", content: "through harness" }),
  );
  expect(
    harness.kernel.kernel.ctx.tools
      .list()
      .some((tool) => tool.name === "plugin_manager"),
  ).toBe(false);
});

it("rejects inactive plugins, foreign references, invalid files, extra identities and arbitrary commands", async () => {
  const { client, session, manager, host } = await setup();
  const other = await client.createSession({ workspace: harness.workspace });
  const file = await client.uploadAttachment(
    other.id,
    new File(["foreign"], "foreign.txt"),
  );
  await expect(host("resources.read", { id: file.id })).rejects.toMatchObject({
    code: "INVALID_REQUEST",
  });
  await expect(
    host("agent.send", { text: "foreign", attachments: [file.id] }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(
    (
      await fetch(`${harness.kernel.url}/plugins/host-client/host/agent.send`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({
          sessionId: session.id,
          input: { text: "invalid transport" },
        }),
      })
    ).status,
  ).toBe(400);
  await expect(
    host("agent.send", { text: "", sessionId: other.id }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  await expect(host("agent.send", { text: "" })).rejects.toMatchObject({
    code: "INVALID_REQUEST",
  });
  await expect(
    host("agent.command", { command: "run_command", commandLine: "anything" }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  await expect(
    host("resources.upload", {
      name: "../escape",
      mediaType: "text/plain",
      data: new ArrayBuffer(1),
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  await expect(
    host("resources.upload", {
      name: "too-large.bin",
      mediaType: "application/octet-stream",
      data: new ArrayBuffer(20 * 1024 * 1024 + 1),
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect((await client.readSession(session.id)).entries).toEqual([]);
  expect((await client.readSession(other.id)).entries).toEqual([]);
  await manager.manage({ action: "disable", name: "host-client" });
  await expect(host("agent.read")).rejects.toMatchObject({
    code: "PLUGIN_NOT_FOUND",
    status: 404,
  });
  await expect(
    host("resources.upload", {
      name: "disabled.txt",
      mediaType: "text/plain",
      data: new ArrayBuffer(0),
    }),
  ).rejects.toMatchObject({ code: "PLUGIN_NOT_FOUND", status: 404 });
});

it("keeps plugin-initiated tasks inside the shared permission checks", async () => {
  const { host, session } = await setup({
    scope: "read-only",
    answers: [
      {
        toolCalls: [
          {
            id: "denied-write",
            name: "write_file",
            arguments: '{"path":"must-not-exist.txt","content":"blocked"}',
          },
        ],
      },
      { text: ["权限不允许写入"] },
    ],
  });
  await host("agent.send", { text: "尝试写入" });
  await harness.kernel.kernel.ctx.tasks.settle(session.id);
  const snapshot = (await host("agent.read")) as AgentSnapshot;
  expect(snapshot.entries).toContainEqual(
    expect.objectContaining({
      type: "tool_result",
      isError: true,
      content: expect.stringContaining("Permission denied"),
    }),
  );
  await expect(
    stat(join(harness.workspace, "must-not-exist.txt")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("recovers pending approval state from a snapshot and clears it on host cancellation", async () => {
  const { host, session, client } = await setup({
    answers: [
      { toolCalls: [{ id: "approval-call", name: "ask_once", arguments: "{}" }] },
    ],
    tools: [
      {
        name: "ask_once",
        description: "Controlled approval",
        parameters: { type: "object", properties: {} },
        async execute(_input, context) {
          const approved = await context.requestApproval({
            reason: "Test approval",
            target: "controlled target",
            impact: "Test only",
          });
          return { content: String(approved) };
        },
      },
    ],
  });
  await host("agent.send", { text: "请求审批" });
  await expect
    .poll(async () => (await client.readSession(session.id)).approvals.length)
    .toBe(1);
  const snapshot = (await host("agent.read")) as AgentSnapshot;
  expect(snapshot).toMatchObject({ running: true, approvals: [{ tool: "ask_once" }] });
  expect(await host("agent.command", { command: "cancel" })).toEqual({
    cancelled: true,
  });
  await harness.kernel.kernel.ctx.tasks.settle(session.id);
  expect(await host("agent.read")).toMatchObject({ running: false, approvals: [] });
});

it("serves attachment bytes as downloads and removes them with the owning session", async () => {
  const { client, session } = await setup();
  const file = await client.uploadAttachment(
    session.id,
    new File(["<script>not executable</script>"], "说明.html", { type: "text/html" }),
  );
  const response = await fetch(client.attachmentUrl(session.id, file.id));
  expect(response.headers.get("content-disposition")).toContain("attachment;");
  expect(response.headers.get("content-security-policy")).toContain("sandbox");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(await response.text()).toBe("<script>not executable</script>");
  await client.deleteSession(session.id);
  expect((await fetch(client.attachmentUrl(session.id, file.id))).status).toBe(404);
});
