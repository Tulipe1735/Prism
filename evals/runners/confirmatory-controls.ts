import type { Cohort, SummaryRecord } from "../schema.ts";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { cohortSchema, parseTasks } from "../schema.ts";
import { pairKey, schedule, sourceHash } from "./cohort.ts";
import { fixtureRoot, hashTree } from "./fixtures.ts";
import { digest, SYSTEM_PROMPT, TASK_PROMPT_FORMAT } from "./model.ts";

export const CONFIRMATORY_ID = "paper-confirmatory-v1";
const prefix = `evals/cohorts/${CONFIRMATORY_ID}`;
export const CONFIRMATORY_VARIANTS = [
  "indexed-local",
  "indexed-structural",
  "indexed-adaptive",
  "raw-selector-reference",
] as const;
export async function fileHash(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

export async function auditHistorical(): Promise<{
  checked: number;
  changed: string[];
}> {
  const protectedFiles: Record<string, string> = JSON.parse(
    await readFile(`${prefix}.historical.json`, "utf8"),
  );
  const changed: string[] = [];
  for (const [path, expected] of Object.entries(protectedFiles)) {
    try {
      if ((await fileHash(path)) !== expected) changed.push(path);
    } catch {
      changed.push(path);
    }
  }
  return { checked: Object.keys(protectedFiles).length, changed };
}

export async function controls(
  cohort: Cohort,
  browser: Record<string, unknown>,
  browserUrl: string,
): Promise<Record<string, unknown>> {
  const tasks = parseTasks(JSON.parse(await readFile(cohort.tasks, "utf8")));
  if (
    cohort.id !== CONFIRMATORY_ID ||
    cohort.repeats !== 5 ||
    cohort.repetitionOffset !== 0 ||
    JSON.stringify(cohort.variants) !== JSON.stringify(CONFIRMATORY_VARIANTS) ||
    tasks.length !== 12 ||
    tasks.some(
      (t) =>
        !t.preregistered ||
        t.fault ||
        !t.url.startsWith(`/${CONFIRMATORY_ID}/`) ||
        t.maxSteps !== undefined ||
        !cohort.categories.includes(t.category),
    ) ||
    ["unique", "local", "structural"].some(
      (c) => tasks.filter((t) => t.preregistered?.ambiguity_class === c).length !== 4,
    )
  )
    throw new Error(
      "Confirmatory design must be twelve annotated tasks × five repeats × four fixed arms.",
    );
  return {
    cohort,
    cohort_file_hash: await fileHash(`${prefix}.json`),
    task_file_hash: await fileHash(cohort.tasks),
    fixture_hash: await hashTree(fixtureRoot),
    source_hash: await sourceHash(),
    protocol_hash: await fileHash(`${prefix}.protocol.md`),
    historical_manifest_hash: await fileHash(`${prefix}.historical.json`),
    system_prompt_hash: digest(SYSTEM_PROMPT),
    task_prompt_hash: digest(TASK_PROMPT_FORMAT),
    node_version: process.version,
    environment: {
      platform: platform(),
      release: release(),
      arch: arch(),
      browser_url: browserUrl,
      browser: {
        product: browser.product,
        revision: browser.revision,
        protocolVersion: browser.protocolVersion,
        jsVersion: browser.jsVersion,
        userAgent: browser.userAgent,
      },
    },
    expected_runs: 240,
    planned_pairs: schedule(tasks, cohort).map((p) =>
      pairKey({ task_id: p.task.id, ...p }),
    ),
    variant_definitions: {
      "indexed-local": "role + label/value + bounded local context (80 characters)",
      "indexed-structural":
        "role + label/value + container + nearby text (120) + section (48)",
      "indexed-adaptive":
        "collision-driven, per-candidate compact → role → local → structural; unchanged pilot policy",
      "raw-selector-reference":
        "selector generation with candidate descriptors and additional sanitized visible DOM; reference only",
    },
    execution: {
      request_timeout_ms: 120000,
      http_max_attempts: 3,
      http_retry_statuses: [429, 503, 529],
      connection_retries: true,
      retry_delay_ms: [500, 1000, 2000],
      action_budget: cohort.maxSteps,
      stale_retries: cohort.staleRetries,
      task_timeout_ms: cohort.timeoutMs,
      call_ceiling: cohort.maxLlmCalls,
      concurrency: cohort.concurrency,
      viewport: cohort.viewport,
      smoke_allowed: false,
      completed_cells_rerunnable: false,
      noninferiority_margin: null,
    },
  };
}
export function assertControls(actual: unknown, frozen: unknown): void {
  if (digest(JSON.stringify(actual)) !== digest(JSON.stringify(frozen)))
    throw new Error("Frozen confirmatory controls drifted; execution/resume refused.");
}
export function verifyCompletedCells(runs: SummaryRecord[], planned: string[]): void {
  const allowed = new Set(planned);
  const seen = new Set<string>();
  for (const r of runs) {
    const key = pairKey(r);
    if (
      !allowed.has(key) ||
      seen.has(key) ||
      r.provider !== "model" ||
      r.metadata.cohort?.id !== CONFIRMATORY_ID ||
      r.grounding_success === undefined ||
      r.strict_task_success === undefined
    )
      throw new Error(`Invalid or duplicate confirmatory cell: ${key}`);
    seen.add(key);
  }
}
export async function verifyConfirmatoryFreeze(
  cohort: Cohort,
  browser: Record<string, unknown>,
  browserUrl: string,
): Promise<void> {
  const frozen = JSON.parse(await readFile(`${prefix}.freeze.json`, "utf8"));
  assertControls(await controls(cohort, browser, browserUrl), frozen.controls);
  const audit = await auditHistorical();
  if (audit.changed.length)
    throw new Error(`Protected historical files changed: ${audit.changed.join(", ")}`);
  if ((await fileHash(frozen.source_archive.path)) !== frozen.source_archive.sha256)
    throw new Error("Frozen source archive drifted.");
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const browserUrl = "http://127.0.0.1:9333";
  const cohort = cohortSchema.parse(
    JSON.parse(await readFile(`${prefix}.json`, "utf8")),
  );
  const browser: any = await (
    await fetch(`${browserUrl}/json/version`, { signal: AbortSignal.timeout(5000) })
  ).json();
  // DevTools HTTP keys differ from Browser.getVersion; use the actual CDP response.
  const { connectBrowser, parseBrowserUrl } =
    await import("../../src/browser/connect.ts");
  if (!browser.webSocketDebuggerUrl) throw new Error("Pinned browser unavailable.");
  const connection = await connectBrowser(parseBrowserUrl(browserUrl));
  try {
    const version = await connection.client.send("Browser.getVersion");
    if (version.product !== cohort.browserVersion)
      throw new Error("Pinned browser drift; no substitution.");
    if (command === "freeze") {
      const audit = await auditHistorical();
      if (audit.changed.length) throw new Error("Historical audit failed.");
      const snapshot = await controls(cohort, version, browserUrl);
      const archivePath = `evals/results/${CONFIRMATORY_ID}-source.tar.gz`;
      // Create exclusively: never replace a prior freeze or source snapshot.
      const sentinel = await import("node:fs/promises");
      const handle = await sentinel.open(`${prefix}.freeze.lock`, "wx");
      await handle.close();
      try {
        try {
          await sentinel.access(`${prefix}.freeze.json`);
          throw new Error("Cohort already frozen.");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        const archiveHandle = await sentinel.open(archivePath, "wx");
        await archiveHandle.close();
        execFileSync("tar", [
          "-czf",
          archivePath,
          "src",
          "evals/runners",
          "evals/schema.ts",
          "evals/success.ts",
          "evals/failures.ts",
          "evals/fixtures",
          "tests",
          "package.json",
          "pnpm-lock.yaml",
          "tsconfig.json",
          "vitest.config.ts",
          "eslint.config.mjs",
          "prettier.config.mjs",
          `${prefix}.json`,
          `${prefix}.protocol.md`,
          `${prefix}.historical.json`,
          cohort.tasks,
        ]);
        const pilot = JSON.parse(
          await readFile("evals/cohorts/ambiguity-adaptive-v1.freeze.json", "utf8"),
        );
        await writeFile(
          `${prefix}.freeze.json`,
          `${JSON.stringify(
            {
              frozen_at: new Date().toISOString(),
              controls: snapshot,
              source_archive: {
                path: archivePath,
                sha256: await fileHash(archivePath),
              },
              historical_audit: audit,
              verification: JSON.parse(
                await readFile(
                  "evals/reports/paper-confirmatory-v1-verification.json",
                  "utf8",
                ),
              ),
              environment_drift_from_pilot: {
                node: { previous: pilot.node_version, current: process.version },
                browser: { previous: pilot.browser_version, current: version.product },
                model: { previous: pilot.cohort.model, current: cohort.model },
                source:
                  "Eval-only confirmatory instrumentation/runner/report; adaptive policy, extractor, formatter, prompt and production runtime retained.",
                fixtures:
                  "Twelve new controlled fixtures; historical files protected by pre-edit inventory.",
                provider_internals:
                  "Not reproducibly controlled; fingerprints and returned model IDs retained per response.",
              },
            },
            null,
            2,
          )}\n`,
          { flag: "wx" },
        );
      } finally {
        await sentinel.unlink(`${prefix}.freeze.lock`);
      }
    } else if (command !== "verify") throw new Error("Use freeze or verify.");
    await verifyConfirmatoryFreeze(cohort, version, browserUrl);
    console.log(
      "Verified frozen controls, 240 planned cells, archive and protected historical files.",
    );
  } finally {
    await connection.close();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
