import type { BundleManifest } from "../../plugin-sdk/src/index.ts";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { z } from "zod";

const run = promisify(execFile);
export interface DependencyPolicy {
  allowed: Record<string, string[]>;
}

/** Host-owned policy is never accepted from plugin source or model tool arguments. */
export class Dependencies {
  private readonly directory: string;
  private readonly cli: string;
  constructor(directory: string, options: { cli?: string } = {}) {
    this.directory = directory;
    this.cli =
      options.cli ??
      join(dirname(createRequire(import.meta.url).resolve("pnpm")), "bin/pnpm.cjs");
  }

  async prepare(manifest: BundleManifest): Promise<string> {
    const dependencies = Object.fromEntries(
      Object.entries(manifest.dependencies ?? {}).sort(([a], [b]) =>
        a.localeCompare(b),
      ),
    );
    const policyPath = join(this.directory, "dependency-policy.json");
    const policy = z
      .object({ allowed: z.record(z.string(), z.array(z.string())) })
      .strict()
      .parse(
        JSON.parse(
          await readFile(policyPath, "utf8").catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return '{"allowed":{}}';
            throw error;
          }),
        ),
      );
    for (const [name, version] of Object.entries(dependencies))
      if (!policy.allowed[name]?.includes(version))
        throw new Error(
          `Dependency ${name}@${version} is not approved in ${policyPath}`,
        );
    const hash = createHash("sha256")
      .update(JSON.stringify(dependencies))
      .digest("hex");
    const root = join(this.directory, "dependencies", hash);
    if (await readFile(join(root, ".ready"), "utf8").catch(() => null)) return root;
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ private: true, dependencies }),
    );
    // Do not inherit workspace hooks, registries or install scripts from the author directory.
    await writeFile(join(root, "pnpm-workspace.yaml"), "packages: []\n");
    await writeFile(
      join(root, ".npmrc"),
      "registry=https://registry.npmjs.org/\nignore-scripts=true\nverify-store-integrity=true\n",
    );
    try {
      if (Object.keys(dependencies).length !== 0)
        await run(
          process.execPath,
          [
            this.cli,
            "install",
            "--ignore-scripts",
            "--ignore-pnpmfile",
            "--config.manage-package-manager-versions=false",
            "--config.registry=https://registry.npmjs.org/",
            "--lockfile=true",
            "--strict-peer-dependencies=false",
            `--store-dir=${join(this.directory, "store")}`,
          ],
          {
            cwd: root,
            timeout: 120_000,
            maxBuffer: 2_000_000,
            env: {
              ...process.env,
              CI: "true",
              ELECTRON_RUN_AS_NODE: "1",
              npm_config_ignore_scripts: "true",
            },
          },
        );
      await writeFile(join(root, ".ready"), hash);
      return root;
    } catch (error) {
      await rm(root, { recursive: true, force: true });
      const output =
        error !== null && typeof error === "object" && "stdout" in error
          ? String(error.stdout).slice(-6000)
          : "";
      throw new Error(
        `Plugin dependency installation failed (pnpm is required): ${error instanceof Error ? error.message : String(error)}\n${output}`,
      );
    }
  }
}
