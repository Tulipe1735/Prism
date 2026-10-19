import type { Buffer } from "node:buffer";
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

const MAIN = resolve("dist/workbench/electron/main.js");

/**
 * The Electron shell can only be started where an Electron runtime and a
 * display exist; elsewhere this suite reports itself as skipped.
 */
function electronBinary(): string | null {
  if (process.env.PRISM_ELECTRON_SMOKE !== "1") return null;
  if (process.env.DISPLAY === undefined && process.env.WAYLAND_DISPLAY === undefined)
    return null;
  try {
    const binary = createRequire(import.meta.url)("electron") as unknown;
    return typeof binary === "string" && existsSync(binary) ? binary : null;
  } catch {
    return null;
  }
}

const BINARY = electronBinary();
const BUILT = existsSync(MAIN);

function firstJsonLine(child: ChildProcess): Promise<Record<string, unknown>> {
  return new Promise((resolveLine, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(
      () => reject(new Error(`Electron printed nothing. stderr: ${stderr}`)),
      60_000,
    );
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      const newline = stdout.indexOf("\n");
      if (newline === -1) return;
      clearTimeout(timer);
      resolveLine(JSON.parse(stdout.slice(0, newline)) as Record<string, unknown>);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Electron exited with code ${code}, signal ${signal}. stderr: ${stderr}`,
        ),
      );
    });
  });
}

function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolveExit) => child.once("exit", () => resolveExit()));
}

describe.runIf(BINARY !== null && BUILT)(
  "electron shell (PRISM_ELECTRON_SMOKE=1, needs a built workbench and a display)",
  () => {
    it("opens the workbench window on a kernel it started itself", async () => {
      const dataDir = await mkdtemp(join(tmpdir(), "prism-electron-smoke-"));
      const child = spawn(
        BINARY as string,
        [MAIN, `--user-data-dir=${join(dataDir, "desktop")}`],
        {
          env: {
            ...process.env,
            PRISM_DATA_DIR: dataDir,
            ELECTRON_ENABLE_LOGGING: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      try {
        const ready = await firstJsonLine(child);
        expect(ready).toMatchObject({ type: "workbench.window" });
        const url = String(ready.url);
        expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

        const shell = await fetch(`${url}/`);
        expect(shell.status).toBe(200);
        expect(await shell.text()).toContain('id="root"');
        expect(
          await fetch(`${url}/kernel/status`).then((response) => response.json()),
        ).toMatchObject({ status: "ready", dataDir });

        child.kill("SIGTERM");
        await waitForExit(child);
      } finally {
        child.kill("SIGKILL");
        await rm(dataDir, { recursive: true, force: true });
      }
    });
  },
);
