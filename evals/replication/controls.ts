import type { Cohort, SummaryRecord } from "../schema.ts";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { connectBrowser, parseBrowserUrl } from "../../src/browser/connect.ts";
import { pairKey, schedule } from "../runners/cohort.ts";
import {
  assertControls,
  fileHash,
  controls as parentControls,
  verifyConfirmatoryFreeze as verifyParent,
} from "../runners/confirmatory-controls.ts";
import { hashTree } from "../runners/fixtures.ts";
import { hash } from "../runners/run.ts";
import { cohortSchema, parseTasks } from "../schema.ts";

export const ID = "paper-replication-model2-v1";
export const PREFIX = `evals/cohorts/${ID}`;
export const BROWSER_URL = "http://127.0.0.1:9333";
export const DEFERRED =
  "Formal non-inferiority was not tested because no externally justified margin was preregistered.";
export async function auditHistorical(): Promise<{
  checked: number;
  changed: string[];
}> {
  const files: Record<string, string> = JSON.parse(
    await readFile(`${PREFIX}.historical.json`, "utf8"),
  );
  const changed: string[] = [];
  for (const [path, expected] of Object.entries(files)) {
    try {
      if ((await fileHash(path)) !== expected) changed.push(path);
    } catch {
      changed.push(path);
    }
  }
  return { checked: Object.keys(files).length, changed };
}
export function controlDiff(
  parent: Cohort,
  replication: Cohort,
): { expected: string[]; unexpected: string[] } {
  const keys = new Set([...Object.keys(parent), ...Object.keys(replication)]);
  const differences = [...keys].filter(
    (k) =>
      JSON.stringify(parent[k as keyof Cohort]) !==
      JSON.stringify(replication[k as keyof Cohort]),
  );
  return {
    expected: differences.filter((k) => ["id", "model"].includes(k)),
    unexpected: differences.filter((k) => !["id", "model"].includes(k)),
  };
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
      r.metadata.cohort?.id !== ID ||
      r.grounding_success === undefined ||
      r.strict_task_success === undefined
    )
      throw new Error(`Invalid or duplicate replication cell: ${key}`);
    seen.add(key);
  }
}
export async function controls(
  cohort: Cohort,
  browser: Record<string, unknown>,
  browserUrl: string,
): Promise<any> {
  const parent = cohortSchema.parse(
    JSON.parse(await readFile("evals/cohorts/paper-confirmatory-v1.json", "utf8")),
  );
  await verifyParent(parent, browser, browserUrl);
  const diff = controlDiff(parent, cohort);
  if (
    cohort.id !== ID ||
    cohort.model !== "deepseek-v4.1-flash" ||
    diff.unexpected.length ||
    cohort.model === parent.model
  )
    throw new Error(
      "Replication must change only cohort identity and the preregistered model.",
    );
  const tasks = parseTasks(JSON.parse(await readFile(cohort.tasks, "utf8")));
  const base = await parentControls(parent, browser, browserUrl);
  const audit = await auditHistorical();
  if (audit.changed.length)
    throw new Error(`Historical drift: ${audit.changed.join(", ")}`);
  return {
    ...base,
    cohort,
    parent_study: parent.id,
    replication_type: "cross-model",
    original_model: parent.model,
    replication_model: cohort.model,
    cohort_file_hash: await fileHash(`${PREFIX}.json`),
    protocol_hash: await fileHash(`${PREFIX}.protocol.md`),
    historical_manifest_hash: await fileHash(`${PREFIX}.historical.json`),
    parent_freeze_hash: await fileHash(
      "evals/cohorts/paper-confirmatory-v1.freeze.json",
    ),
    replication_source_hash: await hashTree(resolve("evals/replication")),
    replication_test_hash: await fileHash("tests/evals/replication.test.ts"),
    model_selection_hash: await fileHash(`evals/reports/${ID}-model-selection.json`),
    historical_file_hashes: JSON.parse(
      await readFile(`${PREFIX}.historical.json`, "utf8"),
    ),
    task_hashes: Object.fromEntries(
      tasks.map((t) => [
        t.id,
        {
          annotation: hash(JSON.stringify(t)),
          executed: hash(JSON.stringify({ ...t, maxSteps: cohort.maxSteps })),
        },
      ]),
    ),
    adaptive_policy_hash: await fileHash("evals/runners/adaptive.ts"),
    extractor_hash: await fileHash("evals/runners/representation.ts"),
    formatter_hash: await fileHash("evals/runners/model.ts"),
    planned_pairs: schedule(tasks, cohort).map((p) =>
      pairKey({ task_id: p.task.id, ...p }),
    ),
    execution: {
      ...(base.execution as object),
      smoke_allowed: "one neutral connectivity response outside cohort",
      noninferiority_margin: null,
    },
    model_settings: {
      provider: "OpenCode Go",
      model: cohort.model,
      temperature_requested: 0,
      top_p_requested: 1,
      max_tokens: 8192,
      reasoning: "provider-default; no thinking/reasoning_effort fields sent",
      sampling_limitations:
        "DeepSeek documents temperature as ineffective in thinking mode, thinking default enabled/high, top_p effective 0.95–1 in thinking and fixed 1 in non-thinking. OpenCode routing defaults/effective sampling not exposed. Requests retain 0/1; no deterministic or effective-temperature claim, emulation or override.",
      structured_output:
        "response_format=json_object with unchanged probability-head prompt and validation. JSON mode does not enforce Prism schema; empty or truncated content remains failure. No tools/tool_choice fields used.",
      quota:
        "Current remaining account allowance is not exposed by model inventory. Published Go Flash allowance: monthly $60, weekly 50%, 5-hour 20%; parent-scale token usage projects well below 5-hour allowance. No additional purchase/overage enabled; quota failures stop dispatch and preserve completed cells. Cannot guarantee worst-case 6500 calls fit.",
      sources: [
        "https://opencode.ai/docs/go/",
        "https://api-docs.deepseek.com/api/create-chat-completion/",
      ],
    },
    control_diff: {
      expected_difference:
        "Generative model/provider-model configuration only; cohort ID and artifact destinations differ for isolation.",
      config: diff,
      unexpected_drift: [],
      runtime:
        "Exact parent Node/Chrome/OS/browser metadata verified; separate dedicated profile.",
      instrumentation:
        "Separate freeze/dispatch/report and passive cloned-response recorder. Original prompts, policy, extraction, transport, evaluator, executor and analysis functions retained byte-for-byte. Extra response recording has potential minor host resource/latency overhead; no feedback to policy.",
    },
    qualitative_criteria: {
      RQ1: "Clear positive Structural minus Local grounding effect on structural ambiguity; local tasks show no consistent need for structural context. Assess paired CI and per-task directions, not overall-only rates.",
      RQ2: "No substantial increase in Adaptive wrong-target errors; materially fewer representation tokens than Structural; descriptively close grounding sufficient to motivate further study. No numerical reliability margin or non-inferiority test.",
      RQ3: "Clearly lower Adaptive total usage vs Local; Adaptive vs Structural favorable or unresolved, with no large consistent regression. Require complete provider usage for token claims. Assess CI, effect magnitudes and per-task directions.",
      failure_comparison:
        "Primary taxonomy unchanged. Counts and effect directions compared separately across models; no pooled runs. Judgment remains qualitative; no post-outcome thresholds.",
    },
    noninferiority: DEFERRED,
  };
}
export async function verifyConfirmatoryFreeze(
  cohort: Cohort,
  browser: Record<string, unknown>,
  browserUrl: string,
): Promise<void> {
  const frozen = JSON.parse(await readFile(`${PREFIX}.freeze.json`, "utf8"));
  assertControls(await controls(cohort, browser, browserUrl), frozen.controls);
  if ((await fileHash(frozen.source_archive.path)) !== frozen.source_archive.sha256)
    throw new Error("Replication archive drifted.");
}
async function main(): Promise<void> {
  const command = process.argv[2];
  const cohort = cohortSchema.parse(
    JSON.parse(await readFile(`${PREFIX}.json`, "utf8")),
  );
  const connection = await connectBrowser(parseBrowserUrl(BROWSER_URL));
  try {
    const browser = await connection.client.send("Browser.getVersion");
    if (command === "freeze") {
      const snapshot = await controls(cohort, browser, BROWSER_URL);
      const archive = `evals/results/${ID}-source.tar.gz`;
      // Exclusive freeze: refuse before writing an archive or manifest.
      const { open, unlink, access } = await import("node:fs/promises");
      const lock = await open(`${PREFIX}.freeze.lock`, "wx");
      await lock.close();
      try {
        try {
          await access(`${PREFIX}.freeze.json`);
          throw new Error("Already frozen.");
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
        const handle = await open(archive, "wx");
        await handle.close();
        execFileSync("tar", [
          "-czf",
          archive,
          "src",
          "evals/runners",
          "evals/replication",
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
          `${PREFIX}.json`,
          `${PREFIX}.protocol.md`,
          `${PREFIX}.historical.json`,
          cohort.tasks,
        ]);
        await writeFile(
          `${PREFIX}.freeze.json`,
          `${JSON.stringify(
            {
              frozen_at: new Date().toISOString(),
              controls: snapshot,
              source_archive: { path: archive, sha256: await fileHash(archive) },
              historical_audit: await auditHistorical(),
              environment_drift_from_pilot: snapshot.control_diff,
              verification: JSON.parse(
                await readFile(`evals/reports/${ID}-verification.json`, "utf8"),
              ),
            },
            null,
            2,
          )}\n`,
          { flag: "wx" },
        );
      } finally {
        await unlink(`${PREFIX}.freeze.lock`);
      }
    } else if (command !== "verify") throw new Error("Use freeze or verify.");
    await verifyConfirmatoryFreeze(cohort, browser, BROWSER_URL);
    console.log(
      "Verified independent replication freeze, parent evidence, unchanged controls and 240-cell plan.",
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
