import type { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parseExperimentCohort, parseExperimentTasks } from "./schema.ts";

/** Explicit research files only: never include .env, credentials, Git or model receipts. */
const ROOTS = [
  "src",
  "evals/runners",
  "evals/replication",
  "evals/endpoint-audit",
  "evals/relation-ablation",
  "evals/schema.ts",
  "evals/success.ts",
  "evals/failures.ts",
  "evals/fixtures/relation-ablation-v1",
  "evals/tasks/relation-ablation-v1.json",
  "evals/cohorts/relation-ablation-v1.protocol.md",
  "evals/cohorts/relation-ablation-v1-glm.json",
  "evals/cohorts/relation-ablation-v1-deepseek.json",
  "tests",
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "vitest.config.ts",
];
const digest = (data: string | Buffer): string =>
  createHash("sha256").update(data).digest("hex");
export async function preparationFiles(): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function visit(path: string): Promise<void> {
    const entry = await stat(path);
    if (entry.isDirectory()) {
      for (const name of (await readdir(path)).sort()) await visit(`${path}/${name}`);
    } else if (entry.isFile()) files[path] = digest(await readFile(path));
  }
  for (const path of ROOTS) await visit(path);
  return files;
}
interface FreezeManifest {
  study: "relation-ablation-v1";
  frozen_at: string;
  node_version: string;
  browser_version: string;
  files: Record<string, string>;
  archive: { file: string; sha256: string };
  verification: unknown;
}
/** Freeze preparation after offline checks; no connection to a model service. */
export async function createFreeze(
  out: string,
  verificationPath: string,
): Promise<string> {
  const verification = JSON.parse(await readFile(verificationPath, "utf8"));
  if (verification.ok !== true) throw new Error("Offline verification has not passed.");
  const files = await preparationFiles();
  if (digest(JSON.stringify(files)) !== verification.preparation_hash)
    throw new Error(
      "Preparation changed since verification; repeat the affected checks.",
    );
  const plans = await Promise.all(
    ["glm", "deepseek"].map(async (model) =>
      parseExperimentCohort(
        JSON.parse(
          await readFile(`evals/cohorts/relation-ablation-v1-${model}.json`, "utf8"),
        ),
      ),
    ),
  );
  const browser = plans[0]!.browserVersion;
  if (browser === null || plans.some((plan) => plan.browserVersion !== browser))
    throw new Error("Both plans must pin the verified browser version.");
  if (verification.browser_version !== browser)
    throw new Error("Verified browser differs from plan.");
  const tasks = parseExperimentTasks(
    JSON.parse(await readFile(plans[0]!.tasks, "utf8")),
  );
  if (tasks.length !== 48 || plans.some((plan) => plan.arms.length !== 4))
    throw new Error("Freeze requires the complete 48-task, four-arm design.");
  await mkdir(out, { recursive: true });
  const archivePath = `${out}/source.tar.gz`;
  // Exclusive creation protects earlier experiment preparation.
  await writeFile(archivePath, "", { flag: "wx" });
  execFileSync("tar", ["-czf", resolve(archivePath), "--", ...Object.keys(files)]);
  const after = await preparationFiles();
  if (JSON.stringify(after) !== JSON.stringify(files))
    throw new Error("Source changed while archiving.");
  const manifest: FreezeManifest = {
    study: "relation-ablation-v1",
    frozen_at: new Date().toISOString(),
    node_version: process.version,
    browser_version: browser,
    files,
    archive: { file: "source.tar.gz", sha256: digest(await readFile(archivePath)) },
    verification,
  };
  const path = `${out}/freeze.json`;
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return path;
}
export async function verifyFreeze(path: string, cohortPath?: string): Promise<void> {
  const frozen = JSON.parse(await readFile(path, "utf8")) as FreezeManifest;
  if (
    frozen.study !== "relation-ablation-v1" ||
    frozen.node_version !== process.version
  )
    throw new Error("Study or Node version differs from the freeze.");
  const actual = await preparationFiles();
  if (JSON.stringify(actual) !== JSON.stringify(frozen.files))
    throw new Error("Frozen source/configuration changed; no model dispatch.");
  const archive = resolve(path, "..", frozen.archive.file);
  if (digest(await readFile(archive)) !== frozen.archive.sha256)
    throw new Error("Frozen archive changed; no model dispatch.");
  if (cohortPath && !frozen.files[relative(process.cwd(), resolve(cohortPath))])
    throw new Error("The cohort plan is not in the frozen manifest.");
}
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      out: { type: "string" },
      verification: { type: "string" },
      verify: { type: "string" },
    },
  });
  if (values.verify) {
    await verifyFreeze(values.verify);
    console.log("Freeze verified; zero model calls.");
  } else {
    if (!values.out || !values.verification)
      throw new Error("Provide --out and --verification, or --verify.");
    console.log(await createFreeze(values.out, values.verification));
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
