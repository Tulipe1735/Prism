import type { Context } from "cordis";
import type { Tool, ToolContext } from "../../src/kernel/tool.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { loadConfig } from "../../src/kernel/config.ts";
import { Kernel } from "../../src/kernel/kernel.ts";
import { browser } from "../../src/kernel/plugins/capabilities.ts";
import { model } from "../../src/kernel/plugins/core.ts";
import { api, type KernelHarness, readSessionLog, startTestKernel } from "./harness.ts";

let kernel: Kernel | undefined;
let directory: string | undefined;
let harness: KernelHarness | undefined;

afterEach(async () => {
  await harness?.cleanup();
  await kernel?.close();
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  harness = undefined;
  kernel = undefined;
  directory = undefined;
});

async function start(): Promise<Kernel> {
  directory = await mkdtemp(join(tmpdir(), "prism-plugins-"));
  kernel = await Kernel.create({ config: await loadConfig({ dataDir: directory }) });
  return kernel;
}

it("loads every built-in capability through Cordis", async () => {
  const { ctx } = await start();
  expect([...ctx.registry.values()].map((runtime) => runtime.name)).toEqual(
    expect.arrayContaining([
      "configuration",
      "sessions",
      "permissions",
      "approvals",
      "tools",
      "model",
      "instructions",
      "skills",
      "compaction",
      "files",
      "commands",
      "browser",
      "web",
      "mcp",
      "tasks",
    ]),
  );
  expect(ctx.tools.list().map((tool) => tool.name)).toEqual(
    expect.arrayContaining([
      "read_file",
      "write_file",
      "run_command",
      "skill",
      "browser_open",
      "web_search",
      "web_fetch",
    ]),
  );
});

it("withdraws browser tools on unload and restores them exactly once on reload", async () => {
  const { ctx } = await start();
  await [...ctx.registry.get(browser)!.fibers][0]!.dispose();
  expect(ctx.tools.get("browser_open")).toBeUndefined();
  expect(ctx.tools.get("read_file")).toBeDefined();
  await ctx.plugin(browser);
  expect(ctx.tools.list().filter((tool) => tool.name === "browser_open")).toHaveLength(
    1,
  );
});

it("cancels and drains calls before releasing a plugin's resources", async () => {
  const { ctx } = await start();
  const order: string[] = [];
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const tool: Tool = {
    name: "lifecycle_probe",
    description: "Wait for cancellation while holding a resource.",
    parameters: { type: "object", properties: {} },
    execute: async (_args, context) => {
      started();
      await new Promise<void>((resolve) =>
        context.signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      order.push("call finished");
      return { content: "cancelled", isError: true };
    },
  };
  const plugin = {
    name: "lifecycle-probe",
    inject: ["tools"],
    apply(owner: Context) {
      owner.effect(function* () {
        yield () => {
          order.push("resource closed");
        };
        yield owner.tools.register(tool);
      });
    },
  };
  const fiber = await ctx.plugin(plugin);
  const context: ToolContext = {
    workspace: directory!,
    sessionId: "test",
    scope: "workspace-write",
    target: "wsl",
    permissions: ctx.permissions,
    signal: new AbortController().signal,
    requestApproval: async () => false,
  };
  const running = ctx.tools.execute(tool, {}, context);
  await ready;
  await fiber.dispose();
  await running;
  expect(order).toEqual(["call finished", "resource closed"]);
  expect(ctx.tools.get(tool.name)).toBeUndefined();
  await expect(ctx.tools.execute(tool, {}, context)).resolves.toMatchObject({
    isError: true,
  });
});

it("restarts dependent task services when the model provider restarts", async () => {
  const { ctx } = await start();
  const original = ctx.tasks;
  await [...ctx.registry.get(model)!.fibers][0]!.restart();
  await expect.poll(() => ctx.get("tasks")).toBeDefined();
  expect(ctx.tasks).not.toBe(original);
  expect(ctx.tools.list().filter((tool) => tool.name === "run_command")).toHaveLength(
    1,
  );
});

it("aborts an in-flight manual compaction before releasing its model dependency", async () => {
  harness = await startTestKernel({
    answers: [{ text: ["partial summary"], hold: true }],
    compaction: { triggerTokens: 1_000_000, keepTokens: 1 },
  });
  const { kernel: server, model: fakeModel, workspace } = harness;
  const { ctx } = server.kernel;
  const session = await server.kernel.createSession({ workspace });
  await ctx.sessions.append(session.id, {
    type: "message",
    role: "user",
    content: "old context ".repeat(100),
  });
  await ctx.sessions.append(session.id, {
    type: "message",
    role: "assistant",
    content: "previous answer",
  });
  await ctx.sessions.append(session.id, {
    type: "message",
    role: "user",
    content: "latest",
  });
  const pending = server.kernel
    .compactManually(session.id)
    .catch((error: unknown) => error);
  await expect.poll(() => fakeModel.requests.length).toBe(1);
  await [...ctx.registry.get(model)!.fibers][0]!.restart();
  expect(await pending).toBeInstanceOf(Error);
  await expect.poll(() => ctx.get("tasks")).toBeDefined();
  expect(
    (await ctx.sessions.read(session.id)).entries.some(
      (entry) => entry.type === "compaction",
    ),
  ).toBe(false);
});

it("reserves a session before async writes so simultaneous messages cannot start two tasks", async () => {
  harness = await startTestKernel({ answers: [{ text: ["waiting"], hold: true }] });
  const { kernel: server, workspace, dataDir } = harness;
  const created = await api<{ session: { id: string } }>(server.url, "/sessions", {
    method: "POST",
    body: { workspace },
  });
  const sessionId = created.body.session.id;
  const responses = await Promise.all(
    ["one", "two"].map((text) =>
      api(server.url, `/sessions/${sessionId}/messages`, {
        method: "POST",
        body: { text },
      }),
    ),
  );
  expect(responses.map((response) => response.status).sort()).toEqual([202, 409]);
  expect(
    (await readSessionLog(dataDir, sessionId)).filter(
      (entry) => entry.type === "message" && entry.role === "user",
    ),
  ).toHaveLength(1);
});
