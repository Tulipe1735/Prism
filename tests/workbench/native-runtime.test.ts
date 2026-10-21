import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { expect, it } from "vitest";
import {
  installNativeBrowser,
  prepareNativeRuntime,
} from "../../src/workbench/native-runtime.ts";

it("prepares the packaged native payload and runs its bundled browser installer with the runtime environment", async () => {
  const resources = await mkdtemp(join(tmpdir(), "prism-native-runtime-"));
  try {
    const root = join(resources, "runtime/native");
    await mkdir(join(root, "node_modules/playwright"), { recursive: true });
    await writeFile(join(root, "kernel.cjs"), "// kernel fixture\n");
    await writeFile(
      join(root, "node_modules/playwright/cli.js"),
      "console.log(JSON.stringify({args:process.argv.slice(2),value:process.env.PRISM_NATIVE_INSTALL_TEST}));",
    );
    const progress: string[] = [];
    const runtime = await prepareNativeRuntime({
      projectRoot: "unused",
      resources,
      node: process.execPath,
      env: { ...process.env, PRISM_NATIVE_INSTALL_TEST: "runtime env" },
      installBrowser: true,
      onProgress: (text) => progress.push(text),
    });
    expect(runtime.distribution).toBeUndefined();
    expect(runtime.entry?.path).toBe(join(root, "kernel.cjs"));
    expect(progress.join("")).toContain('"args":["install","chromium"]');
    expect(progress.join("")).toContain('"value":"runtime env"');
    await writeFile(
      join(root, "node_modules/playwright/cli.js"),
      'console.error("browser fixture failed");process.exit(1);',
    );
    await expect(installNativeBrowser(runtime, "firefox")).rejects.toThrow(
      "browser fixture failed",
    );
  } finally {
    await rm(resources, { recursive: true, force: true });
  }
});
