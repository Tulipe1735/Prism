import { spawn } from "node:child_process";
import { cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { build } from "esbuild";
import { expect, it } from "vitest";
import { copyPluginRuntime } from "../../scripts/plugin-runtime.ts";
import { KernelClient } from "../../src/workbench/ui/client.ts";
import { echoPlugin, pluginBundle } from "../fixtures/plugin.ts";
import { api } from "./harness.ts";

it("prepares backend and UI bundles from a standalone CJS kernel with its shipped runtime", async () => {
  const root = await mkdtemp(join(tmpdir(), "prism-bundle-cjs-"));
  let stop = async (): Promise<void> => {};
  try {
    const entry = join(root, "kernel.cjs");
    await build({
      entryPoints: [resolve("src/interfaces/kernel.ts")],
      outfile: entry,
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node22",
      external: ["playwright", "node-pty", "esbuild"],
      define: { "import.meta.url": "__prismModuleUrl" },
      banner: {
        js: 'const __prismModuleUrl = require("node:url").pathToFileURL(__filename).href;',
      },
    });
    await copyPluginRuntime(root, [`${process.platform}-${process.arch}`]);
    await cp(resolve("src/browser/snapshot.js"), join(root, "snapshot.js"));
    for (const name of ["playwright", "node-pty"])
      await symlink(
        resolve("node_modules", name),
        join(root, "node_modules", name),
        "junction",
      );
    const child = spawn(process.execPath, [entry, "--data-dir", join(root, "data")], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    stop = async () => {
      child.kill();
      await exited;
    };
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const url = await new Promise<string>((resolve, reject) => {
      let stdout = "";
      const timer = setTimeout(
        () => reject(new Error(`Kernel did not start: ${stderr}`)),
        10_000,
      );
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error(`Kernel exited: ${stderr}`));
      });
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
        const line = stdout
          .split("\n")
          .find((line) => line.startsWith('{"type":"kernel.ready"'));
        if (line !== undefined) {
          clearTimeout(timer);
          resolve((JSON.parse(line) as { url: string }).url);
        }
      });
    });
    const client = new KernelClient({ baseUrl: url });
    await client.updateSettings({ creator: { enabled: true } });
    const bundle = pluginBundle(`${echoPlugin()}\nexport function unused() {}`);
    bundle.manifest.ui = [
      { id: "panel", title: "CJS UI", slot: "workbench.panel", entry: "client.ts" },
    ];
    bundle.files["client.ts"] =
      "import {PluginClient} from '@prism/plugin-sdk/client'; const bridge = new PluginClient(); bridge.onContext(context => document.body.textContent = context.sessionId || 'No session');";
    expect(
      (
        await api(url, "/plugins", {
          method: "POST",
          body: { action: "install", bundle },
        })
      ).status,
    ).toBe(200);
    await client.managePlugin("enable", "wish");
    expect((await client.plugins())[0]).toMatchObject({
      name: "wish",
      state: "active",
      tools: ["wish_echo"],
    });
    const [ui] = await client.pluginUi();
    expect((await fetch(ui!.url)).status).toBe(200);
    await client.managePlugin("disable", "wish");
    expect(await client.pluginUi()).toEqual([]);
    await client.shutdown();
    await exited;
    expect(stderr).toBe("");
  } finally {
    await stop();
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
