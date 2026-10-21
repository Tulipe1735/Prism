import type { PluginSummary } from "../../src/kernel/creator.ts";
import type { SessionSummary } from "../../src/kernel/session.ts";
import type { ToolContext } from "../../src/kernel/tool.ts";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { loadConfig } from "../../src/kernel/config.ts";
import { CREATOR_GUIDE } from "../../src/kernel/creator.ts";
import { Kernel } from "../../src/kernel/kernel.ts";
import { api, type KernelHarness, readSessionLog, startTestKernel } from "./harness.ts";

let harness: KernelHarness | undefined;
let restarted: Kernel | undefined;
afterEach(async () => {
  await restarted?.close();
  await harness?.cleanup();
  restarted = undefined;
  harness = undefined;
});

function source(result = "Hello from a plugin", toolName = "wish_echo"): string {
  return `export const inject = ['tools'];
export function apply(ctx) {
  ctx.effect(() => ctx.tools.register({
    name: ${JSON.stringify(toolName)}, description: 'A test wish.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() { return { content: ${JSON.stringify(result)} }; }
  }));
}`;
}

async function start(enabled = true): Promise<KernelHarness> {
  harness = await startTestKernel({ configFile: { creator: { enabled } } });
  return harness;
}

it("enables authoring through settings, persists it and refuses installation while disabled", async () => {
  const { kernel, dataDir } = await start(false);
  expect(kernel.kernel.ctx.tools.get("plugin_manager")).toBeUndefined();
  const refused = await api(kernel.url, "/plugins", {
    method: "POST",
    body: { action: "install", name: "wish", description: "A wish", source: source() },
  });
  expect(refused.status).toBe(403);
  expect(
    (
      await api(kernel.url, "/settings", {
        method: "PUT",
        body: { creator: { enabled: true } },
      })
    ).status,
  ).toBe(200);
  expect(kernel.kernel.ctx.tools.get("plugin_manager")).toBeDefined();
  expect(
    JSON.parse(await readFile(join(dataDir, "config.json"), "utf8")).creator.enabled,
  ).toBe(true);
  expect(
    (
      await api(kernel.url, "/settings", {
        method: "PUT",
        body: { creator: { enabled: "yes" } },
      })
    ).status,
  ).toBe(400);
});

it("installs, hot-replaces, disables, reloads and removes a persistent plugin", async () => {
  const { kernel, dataDir } = await start();
  const creator = kernel.kernel.ctx.creator;
  await creator.manage({
    action: "install",
    name: "wish",
    description: "A wish",
    source: source(),
  });
  expect(kernel.kernel.ctx.tools.get("wish_echo")).toBeDefined();
  await creator.manage({
    action: "install",
    name: "wish",
    description: "Updated wish",
    source: source("version two"),
  });
  expect(
    kernel.kernel.ctx.tools.list().filter((tool) => tool.name === "wish_echo"),
  ).toHaveLength(1);
  await expect(
    kernel.kernel.ctx.tools
      .get("wish_echo")!
      .execute({}, context(kernel.kernel, dataDir)),
  ).resolves.toEqual({ content: "version two" });
  await creator.manage({ action: "disable", name: "wish" });
  expect(kernel.kernel.ctx.tools.get("wish_echo")).toBeUndefined();
  expect(creator.list()[0]?.state).toBe("disabled");
  await creator.manage({ action: "enable", name: "wish" });
  await creator.manage({ action: "reload", name: "wish" });
  expect(
    kernel.kernel.ctx.tools.list().filter((tool) => tool.name === "wish_echo"),
  ).toHaveLength(1);
  expect(await creator.manage({ action: "inspect", name: "wish" })).toMatchObject({
    source: source("version two"),
  });
  await creator.manage({ action: "remove", name: "wish" });
  expect(kernel.kernel.ctx.tools.get("wish_echo")).toBeUndefined();
  await expect(readFile(join(dataDir, "plugins/wish.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("refuses browser-simple POST requests before evaluating plugin code", async () => {
  const { kernel } = await start();
  const response = await fetch(`${kernel.url}/plugins`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify({
      action: "install",
      name: "wish",
      description: "Blocked",
      source: source(),
    }),
  });
  expect(response.status).toBe(400);
  expect(kernel.kernel.ctx.tools.get("wish_echo")).toBeUndefined();
});

it("runs the authoring example advertised by runtime inspection", async () => {
  const { kernel, dataDir } = await start();
  const example = CREATOR_GUIDE.split("Example source:\n")[1]!;
  await kernel.kernel.ctx.creator.manage({
    action: "install",
    name: "example",
    description: "Live SDK example",
    source: example,
  });
  await expect(
    kernel.kernel.ctx.tools
      .get("word_count")!
      .execute({ text: "hello world" }, context(kernel.kernel, dataDir)),
  ).resolves.toEqual({ content: "2" });
});

it("keeps model-driven plugin changes inside the command permission policy", async () => {
  harness = await startTestKernel({
    scope: "read-only",
    configFile: { creator: { enabled: true } },
    answers: [
      {
        toolCalls: [
          {
            id: "blocked",
            name: "plugin_manager",
            arguments: JSON.stringify({
              action: "install",
              name: "wish",
              description: "Blocked",
              source: source(),
            }),
          },
        ],
      },
      { text: ["只读模式无法安装插件。"] },
    ],
  });
  const { kernel, workspace, dataDir } = harness;
  const { body } = await api<{ session: SessionSummary }>(kernel.url, "/sessions", {
    method: "POST",
    body: { workspace },
  });
  await api(kernel.url, `/sessions/${body.session.id}/messages`, {
    method: "POST",
    body: { text: "安装一个插件" },
  });
  await expect.poll(() => kernel.kernel.isRunning(body.session.id)).toBe(false);
  expect(await readSessionLog(dataDir, body.session.id)).toContainEqual(
    expect.objectContaining({
      type: "tool_result",
      callId: "blocked",
      isError: true,
      content: expect.stringContaining("Permission denied"),
    }),
  );
  expect(kernel.kernel.ctx.tools.get("wish_echo")).toBeUndefined();
});

it("restores the working version and cleans partial registrations after a failed update", async () => {
  const { kernel, dataDir } = await start();
  const creator = kernel.kernel.ctx.creator;
  await creator.manage({
    action: "install",
    name: "wish",
    description: "Working",
    source: source(),
  });
  const broken = `${source("partial", "partial_tool").replace(/\n\}$/, "\nthrow new Error('broken update');\n}")}`;
  await expect(
    creator.manage({
      action: "install",
      name: "wish",
      description: "Broken",
      source: broken,
    }),
  ).rejects.toThrow("broken update");
  expect(kernel.kernel.ctx.tools.get("partial_tool")).toBeUndefined();
  expect(creator.list()).toMatchObject([
    { name: "wish", state: "active", description: "Working" },
  ]);
  expect(
    JSON.parse(await readFile(join(dataDir, "plugins/wish.json"), "utf8")).description,
  ).toBe("Working");
  await expect(
    kernel.kernel.ctx.tools
      .get("wish_echo")!
      .execute({}, context(kernel.kernel, dataDir)),
  ).resolves.toEqual({ content: "Hello from a plugin" });
});

it("restores enabled plugins after restart even when authoring is switched off", async () => {
  const { kernel, dataDir } = await start();
  await kernel.kernel.ctx.creator.manage({
    action: "install",
    name: "wish",
    description: "Persistent",
    source: source(),
  });
  await kernel.kernel.updateSettings({ creator: { enabled: false } });
  expect(kernel.kernel.ctx.tools.get("wish_echo")).toBeDefined();
  expect(kernel.kernel.ctx.tools.get("plugin_manager")).toBeUndefined();
  await kernel.close();
  restarted = await Kernel.create({ config: await loadConfig({ dataDir }) });
  expect(restarted.ctx.tools.get("wish_echo")).toBeDefined();
  expect(restarted.ctx.tools.get("plugin_manager")).toBeUndefined();
});

it("reports broken plugins without preventing startup and rejects invalid names and unavailable services", async () => {
  const { kernel, dataDir } = await start();
  const creator = kernel.kernel.ctx.creator;
  await expect(
    creator.manage({
      action: "install",
      name: "../escape",
      description: "Bad",
      source: source(),
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  await expect(
    creator.manage({
      action: "install",
      name: "dsh",
      description: "DSH",
      source: "export const inject = ['agents']; export function apply() {}",
    }),
  ).rejects.toThrow('Required service "agents"');
  await expect(
    creator.manage({
      action: "install",
      name: "recursive",
      description: "No self dependency",
      source: "export const inject = ['creator']; export function apply() {}",
    }),
  ).rejects.toThrow('Required service "creator"');
  await kernel.close();
  await mkdir(join(dataDir, "plugins"), { recursive: true });
  await writeFile(
    join(dataDir, "plugins/broken.json"),
    JSON.stringify({
      name: "broken",
      description: "Broken source",
      source: "export function apply( {",
      enabled: true,
    }),
  );
  restarted = await Kernel.create({ config: await loadConfig({ dataDir }) });
  expect(restarted.ctx.creator.list()).toMatchObject([
    { name: "broken", state: "failed" },
  ]);
  expect(restarted.ctx.tools.get("read_file")).toBeDefined();
  expect(restarted.ctx.tools.get("plugin_manager")).toBeDefined();
});

it("cancels an active tool call when its plugin is disabled", async () => {
  const { kernel, dataDir } = await start();
  await kernel.kernel.ctx.creator.manage({
    action: "install",
    name: "wait",
    description: "Wait for cancellation",
    source: `export const inject = ['tools'];
export function apply(ctx) {
  ctx.effect(() => ctx.tools.register({ name: 'wait_for_abort', description: 'Wait', parameters: { type: 'object', properties: {} },
    async execute(args, context) {
      await new Promise(resolve => context.signal.addEventListener('abort', resolve, { once: true }));
      return { content: 'cancelled', isError: true };
    }
  }));
}`,
  });
  const tools = kernel.kernel.ctx.tools;
  const running = tools.execute(
    tools.get("wait_for_abort")!,
    {},
    context(kernel.kernel, dataDir),
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  await kernel.kernel.ctx.creator.manage({ action: "disable", name: "wait" });
  await expect(running).resolves.toEqual({ content: "cancelled", isError: true });
  expect(tools.get("wait_for_abort")).toBeUndefined();
});

it("fulfils a wish through HTTP: inspect, create, discover and execute the new tool in the same conversation", async () => {
  harness = await startTestKernel({
    configFile: { creator: { enabled: true } },
    answers: [
      { toolCalls: [{ id: "inspect", name: "creator_inspect", arguments: "{}" }] },
      {
        toolCalls: [
          {
            id: "install",
            name: "plugin_manager",
            arguments: JSON.stringify({
              action: "install",
              name: "wish",
              description: "Created from a wish",
              source: source("Wish fulfilled"),
            }),
          },
        ],
      },
      { toolCalls: [{ id: "verify", name: "wish_echo", arguments: "{}" }] },
      { text: ["插件已创建并验证。"] },
    ],
  });
  const { kernel, workspace, dataDir, model } = harness;
  const session = (
    await api<{ session: SessionSummary }>(kernel.url, "/sessions", {
      method: "POST",
      body: { workspace },
    })
  ).body.session;
  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "给我做一个问候插件，并运行它。" },
  });
  await expect.poll(() => kernel.kernel.isRunning(session.id)).toBe(false);
  const entries = await readSessionLog(dataDir, session.id);
  expect(entries).toContainEqual(
    expect.objectContaining({
      type: "tool_result",
      callId: "verify",
      content: "Wish fulfilled",
      isError: false,
    }),
  );
  expect(model.requests[0]?.messages[0]?.content).toContain("Creator Mode is enabled");
  expect(
    model.requests[0]?.tools?.some((tool) => tool.function.name === "wish_echo"),
  ).toBe(false);
  expect(
    model.requests[2]?.tools?.some((tool) => tool.function.name === "wish_echo"),
  ).toBe(true);
  const listed = await api<{ plugins: PluginSummary[] }>(kernel.url, "/plugins");
  expect(listed.body.plugins).toMatchObject([
    { name: "wish", state: "active", tools: ["wish_echo"] },
  ]);
});

function context(kernel: Kernel, workspace: string): ToolContext {
  return {
    workspace,
    sessionId: "test",
    scope: "workspace-write",
    target: "wsl",
    permissions: kernel.permissions,
    signal: new AbortController().signal,
    requestApproval: async () => false,
  };
}
