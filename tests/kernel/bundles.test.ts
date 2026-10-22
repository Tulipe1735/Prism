import type { PluginUiEntry } from "../../packages/plugin-sdk/src/index.ts";
import { mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { afterEach, expect, it, vi } from "vitest";
import { readBundle } from "../../packages/plugin-manager/src/bundle.ts";
import { Dependencies } from "../../packages/plugin-manager/src/dependencies.ts";
import { KernelClient } from "../../src/workbench/ui/client.ts";
import { echoPlugin, pluginBundle } from "../fixtures/plugin.ts";
import { api, connectEvents, type KernelHarness, startTestKernel } from "./harness.ts";

let harness: KernelHarness | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  await harness?.cleanup();
  harness = undefined;
});

it("serves UI and session RPC from the same bundle, publishes updates and withdraws both on disable", async () => {
  harness = await startTestKernel({ configFile: { creator: { enabled: true } } });
  const { kernel, workspace } = harness;
  const manager = kernel.kernel.ctx.creator;
  const bundle = pluginBundle(
    `export function apply(ctx, api) { api.rpc.register('echo', async (input, context) => { api.emit('echoed', input, context.sessionId); return {input, sessionId:context.sessionId}; }); }`,
  );
  bundle.manifest.ui = [
    { id: "panel", title: "Example", slot: "workbench.panel", entry: "ui.ts" },
  ];
  bundle.files["ui.ts"] = "document.body.textContent = 'Bundle UI';";
  const events = await connectEvents(`${kernel.url}/events`);
  try {
    await manager.manage({ action: "install", bundle });
    expect(manager.ui()).toEqual([]);
    await manager.manage({ action: "enable", name: "wish" });
    await events.waitFor((event) => event.type === "plugins.updated");
    const { body } = await api<{ entries: PluginUiEntry[] }>(kernel.url, "/plugins/ui");
    const entry = body.entries[0]!;
    expect(entry).toMatchObject({
      plugin: "wish",
      slot: "workbench.panel",
      id: "panel",
    });
    const response = await fetch(`${kernel.url}${entry.url}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    expect(await response.text()).toContain("./boot.js");
    expect(
      (await fetch(`${kernel.url}${entry.url.replace("index.html", "entry.js")}`))
        .status,
    ).toBe(200);
    const client = new KernelClient({ baseUrl: kernel.url });
    const session = await client.createSession({ workspace });
    expect(
      await client.pluginRequest("wish", "echo", session.id, { text: "hello" }),
    ).toEqual({ input: { text: "hello" }, sessionId: session.id });
    expect(
      await events.waitFor((event) => event.type === "plugin.event"),
    ).toMatchObject({
      plugin: "wish",
      name: "echoed",
      sessionId: session.id,
      data: { text: "hello" },
    });
    await expect(
      client.pluginRequest("wish", "echo", "missing-session", {}),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      (
        await fetch(`${kernel.url}/plugins/wish/rpc/echo`, {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: "{}",
        })
      ).status,
    ).toBe(400);
    await manager.manage({ action: "disable", name: "wish" });
    expect(manager.ui()).toEqual([]);
    expect((await fetch(`${kernel.url}${entry.url}`)).status).toBe(404);
    await expect(
      client.pluginRequest("wish", "echo", session.id, {}),
    ).rejects.toMatchObject({ status: 404 });
  } finally {
    events.close();
  }
});

it("rebuilds nested modules repeatedly, retains working UI and tools on errors, and stops watching on disable", async () => {
  harness = await startTestKernel({ configFile: { creator: { enabled: true } } });
  const { kernel, workspace } = harness;
  const manager = kernel.kernel.ctx.creator;
  const directory = join(workspace, "bundle");
  await mkdir(join(directory, "nested"), { recursive: true });
  const bundle = pluginBundle(
    `import { value } from './nested/value.ts'; ${echoPlugin().replace('"Hello from a plugin"', "value")}`,
  );
  bundle.manifest.ui = [
    { id: "panel", title: "Dynamic", slot: "workbench.panel", entry: "ui.ts" },
  ];
  await writeFile(
    join(directory, "prism.plugin.json"),
    JSON.stringify(bundle.manifest),
  );
  await writeFile(join(directory, "index.ts"), bundle.files["index.ts"]!);
  await writeFile(join(directory, "ui.ts"), "document.body.textContent='one';");
  const nested = join(directory, "nested/value.ts");
  await writeFile(nested, "export const value: string = 'one';");
  await manager.manage({ action: "develop", directory });
  expect(kernel.kernel.ctx.tools.get("wish_echo")).toBeUndefined();
  await manager.manage({ action: "enable", name: "wish" });
  const first = manager.ui()[0]!;
  const output = async () =>
    kernel.kernel.ctx.tools.get("wish_echo")?.execute(
      {},
      {
        workspace,
        sessionId: "test",
        scope: "workspace-write",
        target: "wsl",
        permissions: kernel.kernel.permissions,
        signal: new AbortController().signal,
        requestApproval: async () => false,
      },
    );
  await writeFile(nested, "export const value = 'two';");
  await expect.poll(output).toEqual({ content: "two" });
  expect(manager.ui()[0]?.revision).not.toBe(first.revision);
  expect((await fetch(`${kernel.url}${first.url}`)).status).toBe(404);
  const working = manager.ui()[0]!.revision;
  await writeFile(nested, "export const value = ;");
  await expect.poll(() => manager.list()[0]?.error).toBeDefined();
  expect(await output()).toEqual({ content: "two" });
  expect(manager.ui()[0]?.revision).toBe(working);
  await writeFile(nested, "export const value = 'three';");
  await expect.poll(output).toEqual({ content: "three" });
  await writeFile(join(directory, "ui.ts"), "document.body.textContent='UI changed';");
  await expect
    .poll(async () => {
      const entry = manager.ui()[0]!;
      return (
        await fetch(`${kernel.url}${entry.url.replace("index.html", "entry.js")}`)
      ).text();
    })
    .toContain("UI changed");
  expect(
    kernel.kernel.ctx.tools.list().filter((tool) => tool.name === "wish_echo"),
  ).toHaveLength(1);
  expect(await readdir(join(manager.directory, "revisions", "wish"))).toHaveLength(1);
  await manager.manage({ action: "disable", name: "wish" });
  await writeFile(nested, "export const value = 'disabled';");
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(kernel.kernel.ctx.tools.get("wish_echo")).toBeUndefined();
  expect(manager.ui()).toEqual([]);
});

it("rejects symlinked development sources", async () => {
  harness = await startTestKernel();
  const { workspace } = harness;
  const bundle = pluginBundle(echoPlugin());
  await writeFile(
    join(workspace, "prism.plugin.json"),
    JSON.stringify(bundle.manifest),
  );
  await symlink(join(workspace, "prism.plugin.json"), join(workspace, "index.ts"));
  await expect(readBundle(workspace)).rejects.toThrow("symlinks");
});

it("uses pnpm in an isolated directory, disables scripts and records a lockfile before caching", async () => {
  harness = await startTestKernel();
  const { workspace } = harness;
  const directory = join(workspace, "manager");
  const binaries = join(workspace, "bin");
  await mkdir(directory);
  await mkdir(binaries);
  await writeFile(
    join(directory, "dependency-policy.json"),
    JSON.stringify({ allowed: { zod: ["4.6.5"] } }),
  );
  // A package-manager fixture checks the real process boundary without a network dependency.
  const executable = join(binaries, "pnpm.cjs");
  await writeFile(
    executable,
    `#!/usr/bin/env node\nconst fs=require('node:fs');fs.writeFileSync('invocation.json',JSON.stringify({args:process.argv.slice(2),ignore:process.env.npm_config_ignore_scripts}));fs.writeFileSync('pnpm-lock.yaml','lockfileVersion: 9.0');`,
  );
  const dependencies = new Dependencies(directory, { cli: executable });
  const manifest = {
    ...pluginBundle(echoPlugin()).manifest,
    dependencies: { zod: "4.6.5" },
  };
  const installed = await dependencies.prepare(manifest);
  const invocation = JSON.parse(
    await readFile(join(installed, "invocation.json"), "utf8"),
  );
  expect(invocation.args).toEqual(
    expect.arrayContaining([
      "--ignore-scripts",
      "--ignore-pnpmfile",
      "--config.registry=https://registry.npmjs.org/",
    ]),
  );
  expect(invocation.ignore).toBe("true");
  expect(await readFile(join(installed, "pnpm-lock.yaml"), "utf8")).toContain(
    "lockfileVersion",
  );
  expect(await dependencies.prepare(manifest)).toBe(installed);
  await writeFile(join(directory, "dependency-policy.json"), '{"allowed":{}}');
  await expect(dependencies.prepare(manifest)).rejects.toThrow("not approved");
});

it("cleans directly registered tools after initialization fails", async () => {
  harness = await startTestKernel({ configFile: { creator: { enabled: true } } });
  const manager = harness.kernel.kernel.ctx.creator;
  await manager.manage({
    action: "install",
    bundle: pluginBundle(
      echoPlugin()
        .replace("ctx.effect(() => ctx.tools.register", "ctx.tools.register")
        .replace("}));", "});")
        .replace(/\n\}$/, "\nthrow new Error('failed');\n}"),
    ),
  });
  await expect(manager.manage({ action: "enable", name: "wish" })).rejects.toThrow(
    "failed",
  );
  expect(harness.kernel.kernel.ctx.tools.get("wish_echo")).toBeUndefined();
});

it.runIf(process.env.PRISM_NPM_INTEGRATION === "1")(
  "installs an approved npm dependency and executes its bundled implementation",
  async () => {
    harness = await startTestKernel({ configFile: { creator: { enabled: true } } });
    const manager = harness.kernel.kernel.ctx.creator;
    await writeFile(
      join(manager.directory, "dependency-policy.json"),
      JSON.stringify({ allowed: { "is-number": ["7.0.0"], debug: ["4.4.3"] } }),
    );
    const bundle = pluginBundle(
      "import isNumber from 'is-number'; import debug from 'debug'; export function apply(ctx, api) { api.rpc.register('number', async (input) => ({ valid:isNumber(input), debug:typeof debug('prism') })); }",
    );
    bundle.manifest.dependencies = { "is-number": "7.0.0", debug: "4.4.3" };
    await manager.manage({ action: "install", bundle });
    await manager.manage({ action: "enable", name: "wish" });
    const client = new KernelClient({ baseUrl: harness.kernel.url });
    const session = await client.createSession({ workspace: harness.workspace });
    expect(await client.pluginRequest("wish", "number", session.id, "42")).toEqual({
      valid: true,
      debug: "function",
    });
    expect(await client.pluginRequest("wish", "number", session.id, "hello")).toEqual({
      valid: false,
      debug: "function",
    });
    const [directory] = await readdir(join(manager.directory, "dependencies"));
    expect(
      await readFile(
        join(manager.directory, "dependencies", directory!, "pnpm-lock.yaml"),
        "utf8",
      ),
    ).toContain("is-number");
  },
  120_000,
);
