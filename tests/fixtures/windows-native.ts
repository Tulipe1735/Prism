import type { SessionEntry } from "../../src/kernel/session.ts";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { launchKernel } from "../../src/workbench/kernel-process.ts";
import { startFakeModel } from "../kernel/harness.ts";
import { pluginBundle } from "./plugin.ts";

async function main(): Promise<void> {
  assert.equal(process.platform, "win32");
  const root = dirname(fileURLToPath(import.meta.url));
  const workspace = join(root, "工作区 with spaces");
  const dataDir = join(root, "用户 data");
  await mkdir(workspace, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await mkdir(join(workspace, ".agents/skills/native-check"), { recursive: true });
  await writeFile(join(workspace, "AGENTS.md"), "Native workspace instruction marker.");
  await writeFile(
    join(workspace, ".agents/skills/native-check/SKILL.md"),
    "---\nname: native-check\ndescription: Native skill discovery marker.\n---\nUse the native workspace.\n",
  );
  await writeFile(
    join(dataDir, "mcp.json"),
    JSON.stringify({
      mcpServers: {
        native: {
          transport: "stdio",
          command: process.execPath,
          args: [join(root, "mcp.cjs")],
          env: { ELECTRON_RUN_AS_NODE: "1" },
        },
      },
    }),
  );
  await writeFile(
    join(workspace, "hold.cjs"),
    `
const { spawn } = require('node:child_process');
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
require('node:fs').writeFileSync('child.pid', String(child.pid));
setInterval(() => {}, 1000);
`,
  );

  const model = await startFakeModel([
    {
      toolCalls: [
        {
          id: "write",
          name: "write_file",
          arguments: JSON.stringify({ path: "说明.txt", content: "原生 Windows 文件" }),
        },
        {
          id: "mcp",
          name: "mcp__native__echo",
          arguments: JSON.stringify({ text: "native MCP" }),
        },
        {
          id: "command",
          name: "run_command",
          arguments: JSON.stringify({
            command: "echo 中文测试 & echo %PRISM_NATIVE_PROBE%",
          }),
        },
        {
          id: "plugin-install",
          name: "plugin_manager",
          arguments: JSON.stringify({
            action: "install",
            bundle: pluginBundle(
              `import { platform } from 'node:os';
export const inject = ['tools'];
export function apply(ctx) {
  ctx.effect(() => ctx.tools.register({
    name: 'native_plugin_check', description: 'Check native plugin execution.',
    parameters: { type: 'object', properties: {} },
    async execute() { return { content: platform() + ':中文插件' }; }
  }));
}`,
              "native-check",
              "原生插件验证",
            ),
          }),
        },
      ],
    },
    {
      toolCalls: [
        {
          id: "plugin-enable",
          name: "plugin_manager",
          arguments: JSON.stringify({ action: "enable", name: "native-check" }),
        },
      ],
    },
    {
      toolCalls: [
        { id: "plugin-verify", name: "native_plugin_check", arguments: "{}" },
      ],
    },
    { text: ["native complete"] },
    {
      toolCalls: [
        {
          id: "timeout",
          name: "run_command",
          arguments: JSON.stringify({
            command: '"%PRISM_NATIVE_NODE%" hold.cjs',
            timeoutMs: 1500,
          }),
        },
      ],
    },
    { text: ["timeout complete"] },
    { text: ["stream to cancel"], hold: true },
  ]);
  await writeFile(
    join(dataDir, "config.json"),
    JSON.stringify({
      model: { baseUrl: model.baseUrl, model: "native-test" },
      permissions: { scope: "full-access" },
      creator: { enabled: true },
    }),
  );
  const kernel = await launchKernel({
    node: process.execPath,
    entry: { path: process.argv[2] ?? join(root, "kernel.cjs"), flags: [] },
    dataDir,
    env: {
      ...process.env,
      PRISM_NATIVE_PROBE: "native-expansion",
      PRISM_NATIVE_NODE: process.execPath,
    },
  });

  async function request<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(
      `${kernel.url}${path}`,
      body === undefined
        ? undefined
        : {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
    );
    assert(response.ok, `HTTP ${response.status}: ${await response.clone().text()}`);
    return (await response.json()) as T;
  }

  async function until(check: () => Promise<boolean>): Promise<void> {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (await check()) return;
      await setTimeout(25);
    }
    throw new Error("Native kernel did not reach the expected state");
  }

  try {
    const { session } = await request<{ session: { id: string } }>("/sessions", {
      workspace,
    });
    const entries = async (): Promise<SessionEntry[]> =>
      (await request<{ entries: SessionEntry[] }>(`/sessions/${session.id}`)).entries;
    await request(`/sessions/${session.id}/messages`, {
      text: "Write a file and run a native command",
    });
    await until(async () =>
      (await entries()).some(
        (entry) => entry.type === "message" && entry.content === "native complete",
      ),
    );
    const results = (await entries()).filter((entry) => entry.type === "tool_result");
    assert.equal(
      await readFile(join(workspace, "说明.txt"), "utf8"),
      "原生 Windows 文件",
    );
    const mcp = results.find((entry) => entry.callId === "mcp");
    assert(mcp && !mcp.isError);
    assert.match(mcp.content, /echo: native MCP/);
    assert(
      model.requests[0]?.messages.some(
        (message) =>
          typeof message.content === "string" &&
          message.content.includes("Native workspace instruction marker."),
      ),
    );
    assert(
      model.requests[0]?.messages.some(
        (message) =>
          typeof message.content === "string" &&
          message.content.includes("Native skill discovery marker."),
      ),
    );
    const command = results.find((entry) => entry.callId === "command");
    assert(command);
    assert.equal(command.isError, false);
    assert.match(command.content, /中文测试/);
    assert.match(command.content, /native-expansion/);
    assert(!command.content.includes("\uFFFD"));
    const plugin = results.find((entry) => entry.callId === "plugin-verify");
    assert(plugin && !plugin.isError);
    assert.equal(plugin.content, "win32:中文插件");
    assert(
      JSON.parse(await readFile(join(dataDir, "plugins/native-check.json"), "utf8"))
        .enabled,
    );
    await request("/plugins", { action: "reload", name: "native-check" });
    const listing = await request<{ plugins: { name: string; state: string }[] }>(
      "/plugins",
    );
    assert(
      listing.plugins.some(
        (item) => item.name === "native-check" && item.state === "active",
      ),
    );
    await until(
      async () =>
        (await request<{ runningTasks: number }>("/status")).runningTasks === 0,
    );

    await request(`/sessions/${session.id}/messages`, {
      text: "Run a process with a child and enforce its timeout",
    });
    await until(async () =>
      (await entries()).some(
        (entry) => entry.type === "message" && entry.content === "timeout complete",
      ),
    );
    const timeout = (await entries())
      .filter((entry) => entry.type === "tool_result")
      .find((entry) => entry.callId === "timeout");
    assert(timeout?.isError);
    assert.match(timeout.content, /timed out after 1500ms/);
    const childPid = Number(await readFile(join(workspace, "child.pid"), "utf8"));
    assert.throws(
      () => process.kill(childPid, 0),
      "taskkill must end the descendant too",
    );
    await until(
      async () =>
        (await request<{ runningTasks: number }>("/status")).runningTasks === 0,
    );

    await request(`/sessions/${session.id}/messages`, {
      text: "Keep streaming until cancelled",
    });
    await until(async () => model.requests.length === 7);
    await request(`/sessions/${session.id}/cancel`, {});
    await until(async () =>
      (await entries()).some(
        (entry) =>
          entry.type === "message" &&
          entry.role === "system" &&
          entry.content.includes("cancelled"),
      ),
    );
    assert(
      (await entries()).some(
        (entry) =>
          entry.type === "message" &&
          entry.role === "assistant" &&
          entry.content === "stream to cancel",
      ),
    );
    console.log(
      JSON.stringify({
        native: true,
        files: true,
        commands: true,
        unicode: true,
        mcp: true,
        instructions: true,
        skills: true,
        envExpansion: true,
        processTreeTimeout: true,
        cancellation: true,
        creator: true,
      }),
    );
  } finally {
    await kernel.close();
    await model.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
