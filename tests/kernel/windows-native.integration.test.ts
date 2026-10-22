import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { build } from "esbuild";
import { expect, it } from "vitest";
import { copyPluginRuntime } from "../../scripts/plugin-runtime.ts";

const execute = promisify(execFile);
const enabled =
  process.platform === "win32" || process.env.PRISM_WINDOWS_NATIVE === "1";

it.runIf(enabled)(
  "runs the Cordis kernel natively on Windows, including commands, Unicode, cancellation and process trees",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "prism native test-"));
    try {
      await build({
        entryPoints: {
          kernel: resolve("src/interfaces/kernel.ts"),
          probe: resolve("tests/fixtures/windows-native.ts"),
          mcp: resolve("tests/mcp/fixtures/stdio-server.mjs"),
        },
        outdir: root,
        outExtension: { ".js": ".cjs" },
        bundle: true,
        platform: "node",
        format: "cjs",
        target: "node22",
        external: ["playwright", "esbuild"],
        define: { "import.meta.url": "__prismModuleUrl" },
        banner: {
          js: 'const __prismModuleUrl = require("node:url").pathToFileURL(__filename).href;',
        },
      });
      await cp(resolve("src/browser/snapshot.js"), join(root, "snapshot.js"));
      await cp(resolve("skills"), join(root, "skills"), { recursive: true });
      await writeFile(join(root, "package.json"), '{"type":"module"}\n');
      await copyPluginRuntime(root, ["win32-x64"]);
      const require = createRequire(import.meta.url);
      const playwright = require.resolve("playwright/package.json");
      const playwrightRequire = createRequire(playwright);
      await mkdir(join(root, "node_modules"), { recursive: true });
      for (const [name, manifest] of [
        ["playwright", playwright],
        ["playwright-core", playwrightRequire.resolve("playwright-core/package.json")],
      ])
        await cp(dirname(manifest!), join(root, "node_modules", name!), {
          recursive: true,
          dereference: true,
        });
      const native = process.platform === "win32";
      const packaged = process.env.PRISM_WINDOWS_PACKAGED === "1";
      const node = packaged
        ? resolve("release/win-unpacked/Prism.exe")
        : native
          ? process.execPath
          : "/mnt/c/Program Files/nodejs/node.exe";
      const probe = native
        ? join(root, "probe.cjs")
        : (await execute("wslpath", ["-w", join(root, "probe.cjs")])).stdout.trim();
      const entry = resolve("release/win-unpacked/resources/runtime/native/kernel.cjs");
      const packagedEntry = packaged
        ? native
          ? entry
          : (await execute("wslpath", ["-w", entry])).stdout.trim()
        : undefined;
      const { stdout } = await execute(
        node,
        [probe, ...(packagedEntry === undefined ? [] : [packagedEntry])],
        {
          timeout: 30_000,
          maxBuffer: 1_000_000,
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: "1",
            WSLENV: [process.env.WSLENV, "ELECTRON_RUN_AS_NODE"]
              .filter(Boolean)
              .join(":"),
          },
        },
      );
      expect(JSON.parse(stdout.trim())).toEqual({
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
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  45_000,
);
