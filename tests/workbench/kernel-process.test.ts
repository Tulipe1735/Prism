import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { VERSION } from "../../src/shared/version.ts";
import {
  KernelLaunchError,
  launchKernel,
  planKernelLaunch,
  resolveKernelEntry,
} from "../../src/workbench/kernel-process.ts";

const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url));

it("launches the kernel through wsl.exe on Windows", () => {
  const plan = planKernelLaunch({
    platform: "win32",
    wslEntry: "/home/demo/prism/dist/kernel.js",
    dataDir: "\\\\wsl.localhost\\Ubuntu\\home\\demo\\.prism",
    port: 0,
    node: "/usr/bin/node",
  });

  expect(plan.command).toBe("wsl.exe");
  expect(plan.args).toEqual([
    "-e",
    "/usr/bin/node",
    "/home/demo/prism/dist/kernel.js",
    "--data-dir",
    "\\\\wsl.localhost\\Ubuntu\\home\\demo\\.prism",
  ]);
});

it("says what is missing when Windows has no kernel path inside WSL", () => {
  expect(() =>
    planKernelLaunch({ platform: "win32", dataDir: "/home/demo/.prism" }),
  ).toThrow(KernelLaunchError);
  expect(() =>
    planKernelLaunch({ platform: "win32", dataDir: "/home/demo/.prism" }),
  ).toThrow(/PRISM_KERNEL_ENTRY/);
});

it("prefers the built kernel and falls back to the TypeScript entry", async () => {
  const checkout = await mkdtemp(join(tmpdir(), "prism-checkout-"));
  try {
    const developing = resolveKernelEntry(checkout);
    expect(developing.path).toBe(join(checkout, "src/interfaces/kernel.ts"));
    expect(developing.flags).toEqual([
      "--experimental-strip-types",
      "--disable-warning=ExperimentalWarning",
    ]);

    const plan = planKernelLaunch({
      platform: "linux",
      entry: developing,
      dataDir: "/tmp/data",
      port: 4123,
    });
    expect(plan.command).toBe(process.execPath);
    expect(plan.args).toEqual([
      ...developing.flags,
      developing.path,
      "--data-dir",
      "/tmp/data",
      "--port",
      "4123",
    ]);

    await mkdir(join(checkout, "dist"), { recursive: true });
    await writeFile(join(checkout, "dist/kernel.js"), "// built kernel\n");
    const built = resolveKernelEntry(checkout);
    expect(built).toEqual({ path: join(checkout, "dist/kernel.js"), flags: [] });
  } finally {
    await rm(checkout, { recursive: true, force: true });
  }
});

it("starts a real kernel process, reports its address and shuts it down", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "prism-workbench-launch-"));
  const kernel = await launchKernel({ projectRoot: PROJECT_ROOT, dataDir });
  try {
    expect(kernel.url).toBe(`http://127.0.0.1:${kernel.port}`);
    expect(kernel.version).toBe(VERSION);
    expect(kernel.dataDir).toBe(dataDir);

    const status = (await fetch(`${kernel.url}/status`).then((response) =>
      response.json(),
    )) as { status: string };
    expect(status.status).toBe("ready");
    expect(kernel.exited()).toBe(false);

    await kernel.close();
    expect(kernel.exited()).toBe(true);
    await expect(fetch(`${kernel.url}/status`)).rejects.toThrow();
  } finally {
    await kernel.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

it("reports the kernel output when it cannot start", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "prism-workbench-launch-"));
  try {
    const failure = await launchKernel({
      projectRoot: PROJECT_ROOT,
      dataDir,
      entry: { path: join(dataDir, "missing-kernel.js"), flags: [] },
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(KernelLaunchError);
    expect(String(failure)).toContain("missing-kernel.js");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});