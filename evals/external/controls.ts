import type { Cohort, EvalTask } from "../schema.ts";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import process from "node:process";
import { connectBrowser, parseBrowserUrl } from "../../src/browser/connect.ts";
import { schedule, sourceHash } from "../runners/cohort.ts";
import { fileHash } from "../runners/confirmatory-controls.ts";
import { hashTree } from "../runners/fixtures.ts";
import { digest, SYSTEM_PROMPT, TASK_PROMPT_FORMAT } from "../runners/model.ts";
import { cohortSchema, parseTasks } from "../schema.ts";
import { sourceRoot } from "./server.ts";

export const ID = "external-validation-v1";
const prefix = `evals/cohorts/${ID}`;
export async function design(): Promise<{
  config: any;
  models: Cohort[];
  tasks: EvalTask[];
}> {
  const config = JSON.parse(await readFile(`${prefix}.json`, "utf8"));
  const models = config.models.map((c: unknown) => cohortSchema.parse(c));
  const tasks = parseTasks(
    JSON.parse(await readFile(`evals/tasks/${ID}.json`, "utf8")),
  );
  if (
    config.study_id !== ID ||
    config.expected_runs !== 360 ||
    models.length !== 2 ||
    models.map((m: any) => m.model).join() !== "glm-5.3-flash,deepseek-v4.1-flash" ||
    tasks.length !== 15 ||
    tasks.some((t) => t.preregistered || t.fixture || t.fault || t.script || t.maxSteps)
  )
    throw new Error(
      "Design must be 15 unclassified external tasks and two fixed models",
    );
  for (const model of models) {
    if (
      model.id !== ID ||
      model.repeats !== 3 ||
      model.maxSteps !== 8 ||
      model.variants.join() !==
        "indexed-local,indexed-structural,indexed-adaptive,raw-selector-reference"
    )
      throw new Error("Frozen 360-cell design differs");
  }
  return { config, models, tasks };
}

export async function historicalAudit(): Promise<{
  checked: number;
  changed: string[];
}> {
  const inventory: Record<string, string> = JSON.parse(
    await readFile(`${prefix}.historical.json`, "utf8"),
  );
  const changed: string[] = [];
  for (const [path, sha] of Object.entries(inventory))
    if ((await fileHash(path).catch(() => null)) !== sha) changed.push(path);
  if (changed.length)
    throw new Error(`Historical files changed: ${changed.join(", ")}`);
  return { checked: Object.keys(inventory).length, changed };
}

async function controls(browser: any): Promise<Record<string, unknown>> {
  const { config, models, tasks } = await design();
  return {
    config,
    task_hash: await fileHash(`evals/tasks/${ID}.json`),
    config_hash: await fileHash(`${prefix}.json`),
    metadata_hash: await fileHash("evals/external/task-metadata.json"),
    protocol_hash: await fileHash(`${prefix}.protocol.md`),
    historical_inventory_hash: await fileHash(`${prefix}.historical.json`),
    original_method_hash: await sourceHash(),
    representation_policy_hash: await fileHash("evals/runners/adaptive.ts"),
    extractor_formatter_hash: await fileHash("evals/runners/representation.ts"),
    model_formatter_hash: await fileHash("evals/runners/model.ts"),
    system_prompt_hash: digest(SYSTEM_PROMPT),
    task_prompt_hash: digest(TASK_PROMPT_FORMAT),
    study_implementation_hash: await hashTree("evals/external"),
    analysis_hash: await fileHash(`evals/analysis/${ID}.py`),
    test_hash: await fileHash("tests/evals/external.test.ts"),
    external_source_hash: await hashTree(sourceRoot),
    lockfile_hash: await fileHash("pnpm-lock.yaml"),
    browser,
    environment: {
      platform: platform(),
      release: release(),
      arch: arch(),
      node: process.version,
    },
    planned_cells: models.flatMap((m: any) =>
      schedule(tasks, m).map(
        (p) => `${m.model}/${p.task.id}/${p.variant}/${p.repetition}`,
      ),
    ),
  };
}

export async function verifyFreeze(browser: any): Promise<any> {
  const frozen = JSON.parse(await readFile(`${prefix}.freeze.json`, "utf8"));
  if (
    digest(JSON.stringify(await controls(browser))) !==
    digest(JSON.stringify(frozen.controls))
  )
    throw new Error("Frozen external controls changed; dispatch refused");
  if ((await fileHash(frozen.source_archive.path)) !== frozen.source_archive.sha256)
    throw new Error("External source archive drift");
  await historicalAudit();
  return frozen;
}

async function main(): Promise<void> {
  const { config } = await design();
  const connection = await connectBrowser(parseBrowserUrl(config.browser_url));
  try {
    const browser = await connection.client.send("Browser.getVersion");
    if (browser.product !== "Chrome/153.0.8010.12" || process.version !== "v22.23.2")
      throw new Error("Restore pinned historical Node and browser first");
    if (process.argv[2] === "freeze") {
      const handle = await import("node:fs/promises");
      const lock = await handle.open(`${prefix}.freeze.lock`, "wx");
      await lock.close();
      try {
        if (
          await handle.access(`${prefix}.freeze.json`).then(
            () => true,
            () => false,
          )
        )
          throw new Error("Already frozen; never overwrite");
        const snapshot = await controls(browser);
        const historical = await historicalAudit();
        const archive = `evals/results/${ID}-source.tar.gz`;
        const archiveHandle = await handle.open(archive, "wx");
        await archiveHandle.close();
        execFileSync("tar", [
          "-czf",
          archive,
          "src",
          "evals/runners",
          "evals/replication",
          "evals/external",
          "evals/schema.ts",
          "evals/success.ts",
          "evals/failures.ts",
          "tests",
          "package.json",
          "pnpm-lock.yaml",
          `${prefix}.json`,
          `${prefix}.protocol.md`,
          `${prefix}.historical.json`,
          `evals/tasks/${ID}.json`,
          `evals/analysis/${ID}.py`,
          ".scratch/external-validation-v1/sources",
        ]);
        await writeFile(
          `${prefix}.freeze.json`,
          `${JSON.stringify(
            {
              frozen_at: new Date().toISOString(),
              controls: snapshot,
              historical_audit: historical,
              source_archive: { path: archive, sha256: await fileHash(archive) },
              verification: JSON.parse(
                await readFile(`evals/reports/${ID}-verification.json`, "utf8"),
              ),
              browser_preflight: JSON.parse(
                await readFile(`evals/reports/${ID}-browser-preflight.json`, "utf8"),
              ),
            },
            null,
            2,
          )}\n`,
          { flag: "wx" },
        );
      } finally {
        await handle.unlink(`${prefix}.freeze.lock`);
      }
    } else if (process.argv[2] !== "verify") throw new Error("Use freeze or verify");
    await verifyFreeze(browser);
    console.log(
      "Verified frozen 360-cell external plan and unchanged historical evidence",
    );
  } finally {
    await connection.close();
  }
}
if (process.argv[1]?.endsWith("/external/controls.ts"))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
