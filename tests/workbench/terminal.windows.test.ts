import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { build } from "esbuild";
import { expect, it } from "vitest";

const execute = promisify(execFile);
const enabled =
  process.platform === "win32" || process.env.PRISM_WINDOWS_NATIVE === "1";

it.runIf(enabled)(
  "runs the native Windows workspace terminal and exits without retaining ConPTY workers",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "prism-terminal-probe-"));
    try {
      const probe = join(root, "probe.cjs");
      await build({
        entryPoints: [resolve("tests/fixtures/workspace-terminal.ts")],
        outfile: probe,
        bundle: true,
        platform: "node",
        format: "cjs",
        target: "node22",
        external: ["node-pty"],
      });
      const require = createRequire(import.meta.url);
      await mkdir(join(root, "node_modules"));
      await cp(
        dirname(require.resolve("node-pty/package.json")),
        join(root, "node_modules/node-pty"),
        { recursive: true, dereference: true },
      );
      const native = process.platform === "win32";
      const entry = native
        ? probe
        : (await execute("wslpath", ["-w", probe])).stdout.trim();
      const { stdout, stderr } = await execute(
        native ? process.execPath : "/mnt/c/Program Files/nodejs/node.exe",
        [entry],
        { timeout: 30_000, windowsHide: true },
      );
      expect(stderr).toBe("");
      expect(JSON.parse(stdout.trim())).toEqual({
        native: true,
        terminal: true,
        unicode: true,
        persistent: true,
        closed: true,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  45_000,
);
