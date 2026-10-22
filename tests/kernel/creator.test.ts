import type { PluginSummary } from "../../src/kernel/creator.ts";
import type { SessionSummary } from "../../src/kernel/session.ts";
import type { ToolContext } from "../../src/kernel/tool.ts";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { loadConfig } from "../../src/kernel/config.ts";
import { loadCreatorGuide } from "../../src/kernel/creator.ts";
import { Kernel } from "../../src/kernel/kernel.ts";
import { echoPlugin, pluginBundle } from "../fixtures/plugin.ts";
import { api, type KernelHarness, readSessionLog, startTestKernel } from "./harness.ts";

let harness: KernelHarness | undefined;
let restarted: Kernel | undefined;
afterEach(async () => {
  await restarted?.close();
  await harness?.cleanup();
  restarted = undefined;
  harness = undefined;
});

async function start(enabled = true): Promise<KernelHarness> {
  harness = await startTestKernel({ configFile: { creator: { enabled } } });
  return harness;
}

it("gates preparation on Creator Mode and keeps authoring tools out of Standard", async () => {
  const { kernel, dataDir } = await start(false);
  expect(kernel.kernel.ctx.tools.get("plugin_manager")).toBeUndefined();
  expect(
    (
      await api(kernel.url, "/plugins", {
        method: "POST",
        body: { action: "install", bundle: pluginBundle(echoPlugin()) },
      })
    ).status,
  ).toBe(403);
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
it("adds the shipped Creator guide only while enabled and retains AGENTS.md instructions", async () => {
  harness = await startTestKernel({
    bundledSkills: "package",
    answers: [{ text: ["standard"] }, { text: ["creator"] }, { text: ["standard"] }],
  });
  const { kernel, model, workspace } = harness;
  const baseline = "Use the project's existing conventions.";
  await writeFile(join(workspace, "AGENTS.md"), baseline);
  const guide = await loadCreatorGuide();
  const session = (
    await api<{ session: SessionSummary }>(kernel.url, "/sessions", {
      method: "POST",
      body: { workspace },
    })
  ).body.session;
  const request = async () => {
    const response = await api(kernel.url, `/sessions/${session.id}/messages`, {
      method: "POST",
      body: { text: "Inspect the workspace." },
    });
    expect(response.status).toBe(202);
    await expect.poll(() => kernel.kernel.isRunning(session.id)).toBe(false);
    return model.requests.at(-1)!;
  };

  const standard = await request();
  expect(standard.messages[0]?.content).toContain(baseline);
  expect(standard.messages[0]?.content).not.toContain(guide);
  expect(standard.messages[0]?.content).not.toContain("- creator:");
  expect(standard.tools?.map((tool) => tool.function.name)).not.toContain(
    "creator_inspect",
  );
  expect(standard.tools?.map((tool) => tool.function.name)).not.toContain(
    "plugin_manager",
  );

  await kernel.kernel.updateSettings({ creator: { enabled: true } });
  const creator = await request();
  expect(creator.messages[0]?.content).toContain(baseline);
  expect(creator.messages[0]?.content).toContain(guide);
  expect(creator.tools?.map((tool) => tool.function.name)).toEqual(
    expect.arrayContaining(["creator_inspect", "plugin_manager"]),
  );

  await kernel.kernel.updateSettings({ creator: { enabled: false } });
  const restored = await request();
  expect(restored.messages[0]?.content).toContain(baseline);
  expect(restored.messages[0]?.content).not.toContain(guide);
  expect(restored.tools?.map((tool) => tool.function.name)).not.toContain(
    "plugin_manager",
  );
});

it("prepares without evaluation, stages updates, explicitly activates and persists disable/remove", async () => {
  const { kernel, dataDir } = await start();
  const manager = kernel.kernel.ctx.creator;
  const bundle = pluginBundle(echoPlugin());
  bundle.files["index.ts"] =
    `import { message } from './nested/message.ts';\n${echoPlugin().replace('"Hello from a plugin"', "message")}`;
  bundle.files["nested/message.ts"] = "export const message: string = 'one';";
  await manager.manage({ action: "install", bundle });
  expect(kernel.kernel.ctx.tools.get("wish_echo")).toBeUndefined();
  expect(manager.list()[0]).toMatchObject({ state: "disabled", enabled: false });
  await manager.manage({ action: "enable", name: "wish" });
  const execute = () =>
    kernel.kernel.ctx.tools
      .get("wish_echo")!
      .execute({}, context(kernel.kernel, dataDir));
  expect(await execute()).toEqual({ content: "one" });
  bundle.files["nested/message.ts"] = "export const message: string = 'two';";
  await manager.manage({ action: "install", bundle });
  expect(await execute()).toEqual({ content: "one" });
  expect(manager.list()[0]?.staged).toBe(true);
  await manager.manage({ action: "enable", name: "wish" });
  expect(await execute()).toEqual({ content: "two" });
  await manager.manage({ action: "reload", name: "wish" });
  expect(
    kernel.kernel.ctx.tools.list().filter((tool) => tool.name === "wish_echo"),
  ).toHaveLength(1);
  expect(await manager.manage({ action: "inspect", name: "wish" })).toEqual(bundle);
  await manager.manage({ action: "disable", name: "wish" });
  expect(kernel.kernel.ctx.tools.get("wish_echo")).toBeUndefined();
  await expect(manager.manage({ action: "reload", name: "wish" })).rejects.toThrow(
    "Enable",
  );
  await manager.manage({ action: "remove", name: "wish" });
  await expect(readFile(join(dataDir, "plugins/wish.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("never evaluates top-level code during preparation", async () => {
  const { kernel } = await start();
  const manager = kernel.kernel.ctx.creator;
  await manager.manage({
    action: "install",
    bundle: pluginBundle(
      "throw new Error('evaluated only on enable'); export function apply() {}",
    ),
  });
  await expect(manager.manage({ action: "enable", name: "wish" })).rejects.toThrow(
    "evaluated only on enable",
  );
  expect(manager.list()[0]?.state).toBe("failed");
});

it("restores the previous tools after failed activation and removes partial registrations", async () => {
  const { kernel, dataDir } = await start();
  const manager = kernel.kernel.ctx.creator;
  await manager.manage({ action: "install", bundle: pluginBundle(echoPlugin()) });
  await manager.manage({ action: "enable", name: "wish" });
  const broken = echoPlugin("partial", "partial_tool").replace(
    /\n\}$/,
    "\nthrow new Error('broken update');\n}",
  );
  await manager.manage({ action: "install", bundle: pluginBundle(broken) });
  await expect(manager.manage({ action: "enable", name: "wish" })).rejects.toThrow(
    "broken update",
  );
  expect(kernel.kernel.ctx.tools.get("partial_tool")).toBeUndefined();
  expect(manager.list()[0]).toMatchObject({
    state: "active",
    staged: true,
    error: expect.stringContaining("broken update"),
  });
  expect(
    await kernel.kernel.ctx.tools
      .get("wish_echo")!
      .execute({}, context(kernel.kernel, dataDir)),
  ).toEqual({ content: "Hello from a plugin" });
  await kernel.close();
  restarted = await Kernel.create({
    config: await loadConfig({ dataDir }),
    bundledPlugins: false,
  });
  expect(restarted.ctx.tools.get("wish_echo")).toBeDefined();
  expect(restarted.ctx.tools.get("partial_tool")).toBeUndefined();
});

it("restores enabled bundles while Creator Mode is off and migrates old on-disk records", async () => {
  const { kernel, dataDir } = await start();
  await kernel.kernel.updateSettings({ creator: { enabled: false } });
  await kernel.close();
  await mkdir(join(dataDir, "plugins"), { recursive: true });
  await writeFile(
    join(dataDir, "plugins/wish.json"),
    JSON.stringify({
      name: "wish",
      description: "Migrated",
      source: echoPlugin(),
      enabled: true,
    }),
  );
  await writeFile(
    join(dataDir, "plugins/broken.json"),
    JSON.stringify({
      name: "broken",
      description: "Broken",
      source: "export function apply( {",
      enabled: true,
    }),
  );
  restarted = await Kernel.create({
    config: await loadConfig({ dataDir }),
    bundledPlugins: false,
  });
  expect(restarted.ctx.tools.get("wish_echo")).toBeDefined();
  expect(restarted.ctx.tools.get("plugin_manager")).toBeUndefined();
  expect(restarted.ctx.creator.list()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "broken", state: "failed" }),
      expect.objectContaining({ name: "wish", state: "active" }),
    ]),
  );
  expect(
    JSON.parse(await readFile(join(dataDir, "plugins/wish.json"), "utf8")),
  ).not.toHaveProperty("source");
});

it("rejects browser-simple management requests, invalid manifests, undeclared dependencies and escaping imports", async () => {
  const { kernel } = await start();
  const manager = kernel.kernel.ctx.creator;
  expect(
    (
      await fetch(`${kernel.url}/plugins`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ action: "install", bundle: pluginBundle(echoPlugin()) }),
      })
    ).status,
  ).toBe(400);
  const invalid = pluginBundle(echoPlugin(), "../escape");
  await expect(
    manager.manage({ action: "install", bundle: invalid }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  for (const path of [
    "../escape.ts",
    "/absolute.ts",
    "a\\escape.ts",
    "node_modules/escape.ts",
  ]) {
    const bundle = pluginBundle(echoPlugin());
    bundle.files[path] = "export {};";
    await expect(manager.manage({ action: "install", bundle })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
  }
  await expect(
    manager.manage({
      action: "install",
      bundle: pluginBundle("import 'zod'; export function apply() {}"),
    }),
  ).rejects.toThrow("Undeclared dependency");
  await expect(
    manager.manage({
      action: "install",
      bundle: pluginBundle("import '../../outside.ts'; export function apply() {}"),
    }),
  ).rejects.toThrow();
  const unapproved = pluginBundle(echoPlugin());
  unapproved.manifest.dependencies = { zod: "4.6.5" };
  await expect(
    manager.manage({ action: "install", bundle: unapproved }),
  ).rejects.toThrow("not approved");
  unapproved.manifest.dependencies.zod = "^4.6.5";
  await expect(
    manager.manage({ action: "install", bundle: unapproved }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(manager.list()).toEqual([]);
});

it("rejects unavailable services and invalid plugin contracts before exposing capabilities", async () => {
  const { kernel } = await start();
  const manager = kernel.kernel.ctx.creator;
  for (const source of [
    "export const inject = ['agents']; export function apply() {}",
    "export const inject = ['creator']; export function apply() {}",
    "export const nothing = 1;",
    echoPlugin("bad", "plugin_manager"),
  ]) {
    await manager.manage({ action: "install", bundle: pluginBundle(source) });
    await expect(manager.manage({ action: "enable", name: "wish" })).rejects.toThrow();
    expect(kernel.kernel.ctx.tools.get("wish_echo")).toBeUndefined();
  }
});

it("executes the authoring example from the shipped guide", async () => {
  const { kernel, dataDir } = await start();
  const inspection = await kernel.kernel.ctx.tools
    .get("creator_inspect")!
    .execute({}, context(kernel.kernel, dataDir));
  const example = /```js\n([\s\S]*?)\n```/u.exec(inspection.content)?.[1];
  expect(example).toBeDefined();
  await kernel.kernel.ctx.creator.manage({
    action: "install",
    bundle: pluginBundle(example!, "example"),
  });
  await kernel.kernel.ctx.creator.manage({ action: "enable", name: "example" });
  const tool = kernel.kernel.ctx.tools.get("word_count")!;
  for (const [text, expected] of [
    ["hello world", "2"],
    ["", "0"],
    [" \t\n ", "0"],
    ["one\n two\tthree", "3"],
  ] as const)
    expect(await tool.execute({ text }, context(kernel.kernel, dataDir))).toEqual({
      content: expected,
    });
  expect(await tool.execute({}, context(kernel.kernel, dataDir))).toEqual({
    content: "text must be a string",
    isError: true,
  });
});

it("keeps model-driven bundle preparation inside the command permission policy", async () => {
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
              bundle: pluginBundle(echoPlugin()),
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

it("cancels in-flight tool calls when a bundle is disabled", async () => {
  const { kernel, dataDir } = await start();
  const manager = kernel.kernel.ctx.creator;
  await manager.manage({
    action: "install",
    bundle: pluginBundle(
      `export const inject=['tools']; export function apply(ctx) { ctx.effect(() => ctx.tools.register({name:'wait_for_abort', description:'Wait', parameters:{type:'object',properties:{}}, async execute(args, context) { await new Promise(resolve => context.signal.addEventListener('abort',resolve,{once:true})); return {content:'cancelled',isError:true}; }})); }`,
    ),
  });
  await manager.manage({ action: "enable", name: "wish" });
  const tools = kernel.kernel.ctx.tools;
  const running = tools.execute(
    tools.get("wait_for_abort")!,
    {},
    context(kernel.kernel, dataDir),
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  await manager.manage({ action: "disable", name: "wish" });
  expect(await running).toEqual({ content: "cancelled", isError: true });
  expect(tools.get("wait_for_abort")).toBeUndefined();
});

it("fulfils a request over HTTP through inspect, prepare, enable and next-round discovery", async () => {
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
              bundle: pluginBundle(echoPlugin("Wish fulfilled")),
            }),
          },
        ],
      },
      {
        toolCalls: [
          {
            id: "enable",
            name: "plugin_manager",
            arguments: JSON.stringify({ action: "enable", name: "wish" }),
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
    body: { text: "给我做一个问候插件，启用并运行它。" },
  });
  await expect.poll(() => kernel.kernel.isRunning(session.id)).toBe(false);
  expect(await readSessionLog(dataDir, session.id)).toContainEqual(
    expect.objectContaining({
      type: "tool_result",
      callId: "verify",
      content: "Wish fulfilled",
      isError: false,
    }),
  );
  expect(
    model.requests[2]?.tools?.some((tool) => tool.function.name === "wish_echo"),
  ).toBe(false);
  expect(
    model.requests[3]?.tools?.some((tool) => tool.function.name === "wish_echo"),
  ).toBe(true);
  expect(
    (await api<{ plugins: PluginSummary[] }>(kernel.url, "/plugins")).body.plugins,
  ).toMatchObject([{ name: "wish", state: "active", tools: ["wish_echo"] }]);
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
