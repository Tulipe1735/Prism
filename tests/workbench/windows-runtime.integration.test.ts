import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execute = promisify(execFile);
const windowsNode = "/mnt/c/Program Files/nodejs/node.exe";
const distribution = process.env.WSL_DISTRO_NAME ?? "Ubuntu";
const enabled = process.env.PRISM_WINDOWS_RUNTIME === "1";

describe.runIf(enabled)("WSL runtime through native Windows Node", () => {
  let root: string;
  let windowsProbe: string;
  const deployed = new Set<string>();

  beforeAll(async () => {
    const { stdout } = await execute(windowsNode, [
      "-e",
      'process.stdout.write(require("node:os").tmpdir())',
    ]);
    const windowsTemp = (await execute("wslpath", ["-u", stdout.trim()])).stdout.trim();
    root = await mkdtemp(join(windowsTemp, "prism runtime test-"));
    const fixture = join(root, "fixture");
    const resources = join(root, "resources/runtime");
    await mkdir(join(fixture, "node/bin"), { recursive: true });
    await mkdir(resources, { recursive: true });
    await writeFile(
      join(fixture, "node/bin/node"),
      `#!/bin/sh\nexec "${process.execPath}" "$@"\n`,
    );
    await chmod(join(fixture, "node/bin/node"), 0o644);
    await writeFile(join(fixture, "kernel.cjs"), 'console.log("fixture kernel")');
    const payload = join(resources, "prism-kernel.tar.gz");
    await execute("tar", ["-czf", payload, "-C", fixture, "."]);
    const sha256 = createHash("sha256")
      .update(await readFile(payload))
      .digest("hex");
    await writeFile(
      join(resources, "manifest.json"),
      JSON.stringify({
        version: `test-${basename(root).replaceAll(" ", "-")}`,
        nodeVersion: process.versions.node,
        arch: "x64",
        sha256,
      }),
    );
    await build({
      entryPoints: [resolve("src/workbench/wsl-runtime.ts")],
      outfile: join(root, "runtime.cjs"),
      platform: "node",
      format: "cjs",
      bundle: true,
    });
    await writeFile(
      join(root, "probe.cjs"),
      `const { prepareWslRuntime } = require('./runtime.cjs');
const path = require('node:path');
prepareWslRuntime({ resources: path.join(__dirname, 'resources'), onProgress: () => {}, installBrowser: false, ...JSON.parse(process.argv[2]) })
  .then(result => console.log(JSON.stringify({ ok: true, result })))
  .catch(error => console.log(JSON.stringify({ ok: false, error: error.message })));
`,
    );
    windowsProbe = (
      await execute("wslpath", ["-w", join(root, "probe.cjs")])
    ).stdout.trim();
  });

  afterAll(async () => {
    for (const directory of deployed)
      await rm(directory, { recursive: true, force: true });
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  async function prepare(options: { distribution: string; dataDir?: string }): Promise<{
    ok: boolean;
    error?: string;
    result?: { dataDir: string; entry: { path: string }; platform: string };
  }> {
    const { stdout } = await execute(
      windowsNode,
      [windowsProbe, JSON.stringify(options)],
      {
        timeout: 30_000,
      },
    );
    const response = JSON.parse(stdout.trim());
    if (response.ok) deployed.add(dirname(response.result.entry.path));
    return response;
  }

  it("starts with the default data directory when no override is supplied", async () => {
    const response = await prepare({ distribution });
    expect(response, "default startup must work without PRISM_DATA_DIR").toMatchObject({
      ok: true,
      result: { dataDir: join(homedir(), ".prism"), platform: "win32" },
    });
  });

  it("keeps an explicit data path with spaces and quotes intact", async () => {
    const dataDir = join(root, "data with spaces ' quotes");
    expect(await prepare({ distribution, dataDir })).toMatchObject({
      ok: true,
      result: { dataDir },
    });
  });

  it("reports WSL errors written to UTF-16 stdout", async () => {
    const response = await prepare({ distribution: "Prism-test-missing-distribution" });
    expect(response.ok).toBe(false);
    expect(response.error).toContain("WSL_E_DISTRO_NOT_FOUND");
  });
});
