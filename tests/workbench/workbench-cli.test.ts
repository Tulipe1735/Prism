import type { Buffer } from "node:buffer";
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { expect, it } from "vitest";
import { startTestKernel } from "../kernel/harness.ts";

const ENTRY = resolve("src/workbench/interfaces/workbench.ts");
const UI_ROOT = resolve("src/workbench/ui");

interface ReadyLine {
  type: string;
  url: string;
  port: number;
  kernelUrl: string;
}

function launch(args: string[]): ChildProcess {
  return spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      "--disable-warning=ExperimentalWarning",
      ENTRY,
      ...args,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
}

function firstLine(child: ChildProcess): Promise<string> {
  return new Promise((resolveLine, reject) => {
    let buffer = "";
    const timer = setTimeout(
      () => reject(new Error("The workbench printed nothing")),
      30_000,
    );
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      clearTimeout(timer);
      resolveLine(buffer.slice(0, newline));
    });
    child.once("exit", (code) =>
      reject(new Error(`The workbench exited with code ${code}`)),
    );
  });
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolveExit) => child.once("exit", (code) => resolveExit(code)));
}

it("serves the workbench against a running kernel and stops on request", async () => {
  const harness = await startTestKernel();
  const child = launch([
    "--kernel",
    harness.kernel.url,
    "--ui-root",
    UI_ROOT,
    "--port",
    "0",
  ]);
  try {
    const ready = JSON.parse(await firstLine(child)) as ReadyLine;
    expect(ready).toMatchObject({
      type: "workbench.ready",
      kernelUrl: harness.kernel.url,
    });
    expect(ready.url).toBe(`http://127.0.0.1:${ready.port}`);

    const shell = await fetch(`${ready.url}/`);
    expect(shell.status).toBe(200);
    expect(await shell.text()).toContain('id="session-list"');

    expect(await fetch(`${ready.url}/kernel/status`).then((r) => r.json())).toMatchObject({
      status: "ready",
    });

    const created = await fetch(`${ready.url}/kernel/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspace: harness.workspace }),
    });
    expect(created.status).toBe(201);

    const listed = await fetch(
      `${harness.kernel.url}/sessions?workspace=${encodeURIComponent(harness.workspace)}`,
    ).then((response) => response.json() as Promise<{ sessions: unknown[] }>);
    expect(listed.sessions).toHaveLength(1);

    child.kill("SIGTERM");
    expect(await waitForExit(child)).toBe(0);
  } finally {
    child.kill("SIGKILL");
    await harness.cleanup();
  }
});

it("starts a kernel of its own when none is named", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "prism-workbench-cli-"));
  const child = launch([
    "--project-root",
    resolve("."),
    "--data-dir",
    dataDir,
    "--ui-root",
    UI_ROOT,
  ]);
  try {
    const ready = JSON.parse(await firstLine(child)) as ReadyLine;
    expect(ready.kernelUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const status = await fetch(`${ready.url}/kernel/status`).then((r) => r.json());
    expect(status).toMatchObject({ status: "ready", dataDir });

    child.kill("SIGTERM");
    expect(await waitForExit(child)).toBe(0);
    await expect(fetch(`${ready.kernelUrl}/status`)).rejects.toThrow();
  } finally {
    child.kill("SIGKILL");
    await rm(dataDir, { recursive: true, force: true });
  }
});
