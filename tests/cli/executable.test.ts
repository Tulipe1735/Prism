import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { VERSION } from "../../src/shared/version.ts";

it.runIf(process.platform !== "win32")(
  "runs through the package executable symlink",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "prism-bin-"));
    const executable = join(directory, "prism");
    try {
      await symlink(resolve("src/interfaces/cli.ts"), executable);
      const { stdout } = await promisify(execFile)(process.execPath, [
        "--experimental-strip-types",
        "--disable-warning=ExperimentalWarning",
        executable,
        "--version",
      ]);
      expect(stdout.trim()).toBe(VERSION);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
