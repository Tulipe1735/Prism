import type { Buffer } from "node:buffer";
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { expect, it } from "vitest";
import { VERSION } from "../../src/shared/version.ts";
import { startFakeModel } from "../kernel/harness.ts";

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

/** The workbench launches this bundle; the sources above only cover development. */
const BUILT_ENTRY = resolve("dist/kernel.js");
const BUILT_SNAPSHOT = resolve("dist/snapshot.js");

it.skipIf(!existsSync(BUILT_ENTRY))(
  "serves browser tools from the built bundle",
  async ({ skip }) => {
    expect(
      existsSync(BUILT_SNAPSHOT),
      "run pnpm build: the browser page script is not next to the kernel bundle",
    ).toBe(true);
    const dataDir = await mkdtemp(join(tmpdir(), "prism-kernel-built-"));
    const workspace = join(dataDir, "workspace");
    await mkdir(workspace, { recursive: true });
    const model = await startFakeModel([
      {
        toolCalls: [
          {
            id: "call_1",
            name: "browser_open",
            arguments: JSON.stringify({ url: "about:blank" }),
          },
        ],
      },
      {
        respond: (request) => {
          const result = [...request.messages]
            .reverse()
            .find((message) => message.role === "tool");
          const opened = JSON.parse(result?.content ?? "{}") as {
            session?: string;
          };
          return {
            toolCalls: [
              {
                id: "call_2",
                name: "browser_observe",
                arguments: JSON.stringify({ session: opened.session }),
              },
            ],
          };
        },
      },
      { text: ["Opened."] },
    ]);
    await writeFile(
      join(dataDir, "config.json"),
      JSON.stringify({
        model: { baseUrl: model.baseUrl, model: "scripted-model", apiKey: "test-key" },
      }),
      "utf8",
    );
    const child = spawn(process.execPath, [BUILT_ENTRY, "--data-dir", dataDir], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    try {
      const ready = JSON.parse(await firstLine(child)) as ReadyLine;
      const created = await fetch(`${ready.url}/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspace }),
      });
      const session = ((await created.json()) as { session: { id: string } }).session;
      await fetch(`${ready.url}/sessions/${session.id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "open a page" }),
      });

      const deadline = Date.now() + 20_000;
      while (model.requests.length < 3 && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 50));
      const served = (await (
        await fetch(`${ready.url}/sessions/${session.id}`)
      ).json()) as {
        entries: { type: string; content?: string; isError?: boolean }[];
      };
      const results = served.entries.filter((entry) => entry.type === "tool_result");
      if (
        results.some((entry) =>
          /browser build is not installed/.test(entry.content ?? ""),
        )
      )
        skip(
          "Chromium is not installed for the built kernel; run npx playwright install chromium",
        );
      expect(results.map((entry) => entry.isError)).toEqual([false, false]);
      expect(results[0]!.content).toContain('"session"');
      expect(results[1]!.content).toContain('"url":"about:blank"');

      const shutdown = await fetch(`${ready.url}/shutdown`, { method: "POST" });
      expect(shutdown.status).toBe(202);
      expect(await waitForExit(child)).toBe(0);
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
      await model.close();
      await rm(dataDir, { recursive: true, force: true });
    }
    expect(stderr).toBe("");
  },
);
