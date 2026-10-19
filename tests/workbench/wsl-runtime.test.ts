import { Buffer } from "node:buffer";
import { execFile, spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import {
  parseDistributions,
  PREPARE_RUNTIME_SCRIPT,
  prepareWslRuntime,
} from "../../src/workbench/wsl-runtime.ts";

const directories: string[] = [];
const execute = promisify(execFile);
afterEach(async () => {
  await Promise.all(
    directories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
  directories.length = 0;
});

async function temporary(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "prism-runtime-test-"));
  directories.push(directory);
  return directory;
}

it("decodes Windows WSL output and excludes Docker's internal distributions", () => {
  expect(
    parseDistributions(
      Buffer.from(
        "\uFEFFUbuntu\r\n测试环境\r\ndocker-desktop\r\ndocker-desktop-data\r\n",
        "utf16le",
      ),
    ),
  ).toEqual(["Ubuntu", "测试环境"]);
  expect(parseDistributions(Buffer.from("\r\n", "utf16le"))).toEqual([]);
});

it("rejects a damaged payload before it can start a WSL process", async () => {
  const root = await temporary();
  await mkdir(join(root, "runtime"));
  await writeFile(
    join(root, "runtime/manifest.json"),
    JSON.stringify({
      version: "0.1.6",
      nodeVersion: "22.23.2",
      arch: "x64",
      sha256: "0".repeat(64),
    }),
  );
  await writeFile(join(root, "runtime/prism-kernel.tar.gz"), "tampered");
  await expect(
    prepareWslRuntime({
      resources: root,
      distribution: "Ubuntu",
      installBrowser: false,
      onProgress: () => {},
    }),
  ).rejects.toThrow("校验失败");
});

it.runIf(process.platform === "linux")(
  "deploys an offline runtime atomically and preserves data when it is reused",
  async () => {
    const root = await temporary();
    const fixture = join(root, "payload");
    const data = join(root, "data with spaces ' quotes");
    const archive = join(root, "payload with spaces ' quotes.tar.gz");
    const helpers = join(root, "helpers");
    await mkdir(join(fixture, "node/bin"), { recursive: true });
    await mkdir(data);
    await mkdir(helpers);
    // Windows-created archives can omit the Linux executable bit.
    await writeFile(
      join(fixture, "node/bin/node"),
      `#!/bin/sh\nexec "${process.execPath}" "$@"\n`,
      { mode: 0o644 },
    );
    await writeFile(join(fixture, "kernel.cjs"), "console.log('kernel help')");
    await writeFile(join(data, "config.json"), '{"keep":true}');
    await writeFile(join(helpers, "wslpath"), '#!/bin/sh\nprintf "%s\\n" "$2"\n');
    await chmod(join(helpers, "wslpath"), 0o755);
    await execute("tar", ["-czf", archive, "-C", fixture, "."]);

    const run = (): Promise<string> =>
      new Promise((resolve, reject) => {
        const child = spawn("sh", ["-s", "--", archive, "0.1.6-test", "0", data], {
          env: {
            ...process.env,
            PATH: `${helpers}:${process.env.PATH}`,
            XDG_DATA_HOME: join(root, "xdg"),
          },
          stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => {
          stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.once("error", reject);
        child.once("close", (code) =>
          code === 0 ? resolve(stdout) : reject(new Error(stderr)),
        );
        child.stdin.end(PREPARE_RUNTIME_SCRIPT);
      });
    const first = await run();
    const ready = first
      .split("\n")
      .find((line) => line.startsWith("PRISM_RUNTIME_READY="))!;
    const result = JSON.parse(ready.slice("PRISM_RUNTIME_READY=".length)) as {
      entry: { path: string };
      dataDir: string;
    };
    expect(result.dataDir).toBe(data);
    expect(await readFile(result.entry.path, "utf8")).toContain("kernel help");
    expect(await readFile(join(data, "config.json"), "utf8")).toBe('{"keep":true}');
    expect(first).toContain("正在展开");
    const second = await run();
    expect(second).not.toContain("正在展开");
    expect(second).toContain("PRISM_RUNTIME_READY=");
  },
);
