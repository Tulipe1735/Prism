import type { Buffer } from "node:buffer";
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { expect, it } from "vitest";
import { VERSION } from "../../src/shared/version.ts";

const ENTRY = resolve("src/interfaces/kernel.ts");

interface ReadyLine {
  type: string;
  url: string;
  port: number;
  version: string;
  dataDir: string;
}

function launch(argument: string[]): ChildProcess {
  return spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      "--disable-warning=ExperimentalWarning",
      ENTRY,
      ...argument,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
}

function firstLine(child: ChildProcess): Promise<string> {
  return new Promise((resolveLine, reject) => {
    let buffer = "";
    const timer = setTimeout(
      () => reject(new Error("The kernel printed nothing")),
      15_000,
    );
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      clearTimeout(timer);
      resolveLine(buffer.slice(0, newline));
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
    });
    child.once("exit", (code) =>
      reject(new Error(`The kernel exited with code ${code}`)),
    );
  });
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolveExit) => child.once("exit", (code) => resolveExit(code)));
}

it("starts headless, announces its address and stops on request", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "prism-kernel-entry-"));
  const child = launch(["--port", "0", "--data-dir", dataDir]);
  try {
    const ready = JSON.parse(await firstLine(child)) as ReadyLine;
    expect(ready).toEqual({
      type: "kernel.ready",
      url: `http://127.0.0.1:${ready.port}`,
      port: ready.port,
      version: VERSION,
      dataDir,
    });

    const status = (await fetch(`${ready.url}/status`).then((response) =>
      response.json(),
    )) as {
      status: string;
    };
    expect(status.status).toBe("ready");

    const shutdown = await fetch(`${ready.url}/shutdown`, { method: "POST" });
    expect(shutdown.status).toBe(202);
    expect(await waitForExit(child)).toBe(0);
  } finally {
    child.kill("SIGKILL");
    await rm(dataDir, { recursive: true, force: true });
  }
});

it("refuses an unusable port argument with a message and a failing exit code", async () => {
  const child = launch(["--port", "not-a-port"]);
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  expect(await waitForExit(child)).toBe(1);
  expect(stderr).toContain("--port");
});
