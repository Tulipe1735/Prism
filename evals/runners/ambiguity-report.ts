import type { Cohort, ResultRecord, StepRecord, SummaryRecord } from "../schema.ts";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import { cohortSchema, parseTasks } from "../schema.ts";
import { failureAnalysis, loadRecords } from "./report.ts";
import { clusterInterval, health, mean, taskRates, variability } from "./statistics.ts";

export const INDEXED_VARIANTS = [
  "indexed-compact",
  "indexed-role",
  "indexed-local",
  "indexed-structural",
] as const;
/** Predeclared bounded follow-up: mixed outcomes or close context arms; never all tasks. */
export function selectRepeatTasks(
  runs: Pick<SummaryRecord, "task_id" | "variant" | "success">[],
): Array<{ task: string; reason: string; score: number }> {
  const selected = [];
  for (const task of [...new Set(runs.map((r) => r.task_id))].sort()) {
    const rates = INDEXED_VARIANTS.map((v) =>
      mean(
        runs
          .filter((r) => r.task_id === task && r.variant === v)
          .map((r) => Number(r.success)),
      ),
    );
    const mixed = rates.filter((p) => p >= 0.2 && p <= 0.8).length;
    const local = rates[2]!;
    const structural = rates[3]!;
    const close =
      Math.abs(local - structural) <= 0.2 &&
      ((local > 0 && local < 1) || (structural > 0 && structural < 1));
    if (mixed || close)
      selected.push({
        task,
        reason: [
          mixed ? "indexed success between 20% and 80%" : "",
          close ? "local/structural within 20 pp with mixed outcomes" : "",
        ]
          .filter(Boolean)
          .join("; "),
        score: mixed + Number(close) + rates.reduce((s, p) => s + p * (1 - p), 0),
      });
  }
  return selected
    .sort((a, b) => b.score - a.score || a.task.localeCompare(b.task))
    .slice(0, 4);
}
const percent = (n: number, d: number): string =>
  d ? `${((100 * n) / d).toFixed(1)}% (${n}/${d})` : "n/a";
const avg = (a: number[]): string => mean(a).toFixed(2);
const interval = (a: number[]): string =>
  clusterInterval(a)
    .map((p) => `${(100 * p).toFixed(1)} pp`)
    .join(" to ");
export async function auditCohort(path: string): Promise<ResultRecord[]> {
  const records = await loadRecords([path]);
  const runs = records.filter((r) => r.record_type === "summary");
  const plan = JSON.parse(await readFile(`${path}.meta.json`, "utf8"));
  const check = health(runs, plan.expected_runs);
  if (plan.status !== "complete" || !check.healthy)
    throw new Error(
      `Unhealthy or incomplete cohort ${path}: ${check.reasons.join("; ")}`,
    );
  for (const field of [
    "source_hash",
    "fixture_hash",
    "system_prompt_hash",
    "task_prompt_hash",
  ] as const)
    if (new Set(runs.map((r) => r.metadata[field])).size !== 1)
      throw new Error(`Control drift: ${field}`);
  if (
    runs.some(
      (r) =>
        r.metadata.model !== plan.cohort.model ||
        r.metadata.source_hash !== plan.metadata.source_hash ||
        r.metadata.fixture_hash !== plan.metadata.fixture_hash ||
        JSON.stringify(r.metadata.cohort) !==
          JSON.stringify(cohortSchema.parse(plan.cohort)),
    )
  )
    throw new Error("Run controls differ from frozen plan");
  const pairs = new Set(plan.planned_pairs);
  if (runs.some((r) => !pairs.has(`${r.task_id}/${r.variant}/${r.repetition}`)))
    throw new Error("Unplanned result");
  for (const run of runs) {
    const rows = records.filter(
      (r): r is StepRecord => r.record_type === "step" && r.run_id === run.run_id,
    );
    for (const key of [
      "llm_calls",
      "decision_calls",
      "stale_events",
      "stale_recoveries",
      "http_retries",
    ] as const)
      if (rows.reduce((s, r) => s + r[key], 0) !== run[key])
        throw new Error("Summary counter mismatch");
    if (rows.filter((r) => r.executed).length !== run.steps)
      throw new Error("Executed-step mismatch");
    if (
      rows.reduce((s, r) => s + (r.representation_cost?.estimated_tokens ?? 0), 0) !==
      run.representation_estimated_tokens_total
    )
      throw new Error("Representation cost mismatch");
    if (
      run.success &&
      (!run.evidence?.checks.every((c) => c.passed) || run.evidence.wrong_targets !== 0)
    )
      throw new Error("False oracle success");
  }
  return records;
}
export function ambiguityReport(records: ResultRecord[]): string {
  const runs = records.filter((r) => r.record_type === "summary");
  const initial = runs.filter((r) => r.metadata.cohort?.id === "ambiguity-initial");
  const extension = runs.filter((r) => r.metadata.cohort?.id === "ambiguity-extension");
  const variants = [...INDEXED_VARIANTS, "raw-selector"];
  const lines = [
    "# Action representation / ambiguity study",
    "",
    "This is a fixed-model, bounded-evidence experiment on 16 deterministic local tasks. The four indexed arms use the same agent, validation, executor, budgets, success oracle and status-only page text. Only target descriptions vary. Raw selector is a reference with extra locator DOM evidence and is not part of the causal representation comparison. No stale-recovery ablations or modal fixes are mixed into this study.",
    "",
    "Model: glm-5.3-flash; temperature 0; top_p 1; max_tokens 8192; provider-default reasoning. Chrome/153.0.8010.12, viewport 1120 × 780, eight executed actions, two HTTP retries, five stale retries, and a 240-second deadline. No global page text or DOM dump reaches the indexed arms. Full prompts, confidence heads, raw answers, audits and cost counters remain in JSONL.",
    "",
    "## Initial balanced cohort",
    "",
    "| Representation | Runs | Success | First correct target / all runs | Correct accepted targets | Wrong executed targets | Semantic ambiguity failures | Avg representation estimated tokens / observation |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const v of variants) {
    const group = initial.filter((r) => r.variant === v);
    const observations = group.reduce((s, r) => s + r.representation_observations, 0);
    const firstTargets = group.map((run) =>
      records.find(
        (r) =>
          r.record_type === "step" &&
          r.run_id === run.run_id &&
          r.target_assessment !== null,
      ),
    );
    const firstCorrect = firstTargets.filter(
      (r) => r?.record_type === "step" && r.target_assessment === "correct",
    ).length;
    lines.push(
      `| ${v} | ${group.length} | ${percent(group.filter((r) => r.success).length, group.length)} | ${percent(firstCorrect, group.length)} | ${percent(
        group.reduce((s, r) => s + r.correct_target_selections, 0),
        group.reduce((s, r) => s + r.scored_target_attempts, 0),
      )} | ${percent(
        group.reduce((s, r) => s + (r.wrong_target_actions ?? 0), 0),
        group.reduce((s, r) => s + r.grounding_observed_actions, 0),
      )} | ${percent(group.filter((r) => r.failure_type === "SEMANTIC_AMBIGUITY").length, group.length)} | ${(group.reduce((s, r) => s + r.representation_estimated_tokens_total, 0) / observations).toFixed(2)} |`,
    );
  }
  lines.push(
    "",
    "First correct target / all runs treats runs without an accepted target as not correct. Correct accepted-target rate is conditional on structurally accepted, scored proposals, including stale attempts. Wrong-target rate measures executed inputs with oracle coverage; a monotonic wrong counter makes later goal attainment insufficient. Malformed heads or BLOCKED can fail before any target assessment. Confidence is self-reported and uncalibrated.",
    "",
    "## Final oracle attainment",
    "",
    "Reported success includes protocol/termination errors. Final oracle attainment is supplemental: all retained checks pass, zero wrong inputs and zero required runtime mutations, even if a later model call failed. Failed run labels are never rewritten.",
    "",
    "| Representation | Reported success | Final oracle attained |",
    "|---|---:|---:|",
    ...variants.map((v) => {
      const g = initial.filter((r) => r.variant === v);
      return `| ${v} | ${percent(g.filter((r) => r.success).length, g.length)} | ${percent(g.filter((r) => r.evidence !== null && r.evidence.checks.every((c) => c.passed && c.actual === c.expected) && r.evidence.wrong_targets === 0 && r.evidence.mutation_count === 0).length, g.length)} |`;
    }),
    "",
    "## Paired effects and cost",
    "",
    "| Comparison | Success difference | Task-cluster 95% CI |",
    "|---|---:|---|",
  );
  for (const [base, other] of [
    ["indexed-compact", "indexed-role"],
    ["indexed-role", "indexed-local"],
    ["indexed-local", "indexed-structural"],
  ]) {
    const a = taskRates(initial.filter((r) => r.variant === base));
    const b = taskRates(initial.filter((r) => r.variant === other));
    const diffs = [...a].map(([id, p]) => b.get(id)! - p);
    lines.push(
      `| ${other} minus ${base} | ${(mean(diffs) * 100).toFixed(1)} pp | ${interval(diffs)} |`,
    );
  }
  lines.push(
    "",
    "| Representation | Avg candidate actions | Avg chars / observation | Avg estimated tokens / candidate | Estimated representation tokens spent / verified success | Invalid action rate | Avg steps | LLM HTTP calls | Avg latency (s) | Reported prompt tokens (lower bound) |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  );
  for (const v of variants) {
    const g = initial.filter((r) => r.variant === v);
    const n = g.reduce((s, r) => s + r.representation_observations, 0);
    const c = g.reduce((s, r) => s + r.representation_candidates_total, 0);
    const tokens = g.reduce((s, r) => s + r.representation_estimated_tokens_total, 0);
    const success = g.filter((r) => r.success).length;
    const ids = new Set(g.map((r) => r.run_id));
    const rows = records.filter((r) => r.record_type === "step" && ids.has(r.run_id));
    lines.push(
      `| ${v} | ${(c / n).toFixed(2)} | ${(g.reduce((s, r) => s + r.representation_chars_total, 0) / n).toFixed(2)} | ${c ? (tokens / c).toFixed(2) : "n/a"} | ${success ? (tokens / success).toFixed(2) : "n/a"} | ${percent(
        g.reduce((s, r) => s + r.invalid_actions, 0),
        g.reduce((s, r) => s + r.attempts, 0),
      )} | ${avg(g.map((r) => r.steps))} | ${g.reduce((s, r) => s + r.llm_calls, 0)} | ${avg(g.map((r) => r.latency_ms / 1000))} | ${rows.reduce((s, r) => s + (r.input_tokens ?? 0), 0)} |`,
    );
  }
  lines.push(
    "",
    "Representation tokens use the documented UTF-8 byte-count / 4 heuristic, rounded up per observation. They are not a model tokenizer measurement or a billable-token claim. Exact characters include the target-map JSON syntax; selector reference also includes its DOM. Estimated tokens spent / success includes unsuccessful runs. Actual provider prompt/output usage is retained separately; missing usage and retries without usage make observed totals lower bounds. Candidate size averages can differ after different actions; the first-observation candidate set is identical across indexed arms.",
    "",
    "## Provider-reported token costs",
    "",
    "These are observed lower bounds for the whole prompt and response, including reasoning when the provider counts it. They are separate from the representation estimate. Coverage counts usage-bearing turns; HTTP retries can add attempts without usable token counts.",
    "",
    "| Representation | Reported input tokens | Reported output tokens | Reported total tokens | Usage-bearing / model-call turns |",
    "|---|---:|---:|---:|---:|",
    ...variants.map((v) => {
      const ids = new Set(initial.filter((r) => r.variant === v).map((r) => r.run_id));
      const rows = records.filter(
        (r): r is StepRecord =>
          r.record_type === "step" && ids.has(r.run_id) && r.llm_calls > 0,
      );
      return `| ${v} | ${rows.reduce((s, r) => s + (r.input_tokens ?? 0), 0)} | ${rows.reduce((s, r) => s + (r.output_tokens ?? 0), 0)} | ${rows.reduce((s, r) => s + (r.total_tokens ?? 0), 0)} | ${rows.filter((r) => r.total_tokens !== null).length}/${rows.length} |`;
    }),
    "",
    "## Per-task initial success and grounding",
    "",
    "| Task | Representation | Success | Correct accepted targets | Wrong executions | Mean representation estimated tokens / run |",
    "|---|---|---:|---:|---:|---:|",
  );
  for (const task of [...new Set(initial.map((r) => r.task_id))].sort())
    for (const v of variants) {
      const g = initial.filter((r) => r.task_id === task && r.variant === v);
      lines.push(
        `| ${task} | ${v} | ${percent(g.filter((r) => r.success).length, g.length)} | ${percent(
          g.reduce((s, r) => s + r.correct_target_selections, 0),
          g.reduce((s, r) => s + r.scored_target_attempts, 0),
        )} | ${g.reduce((s, r) => s + (r.wrong_target_actions ?? 0), 0)} | ${avg(g.map((r) => r.representation_estimated_tokens_total))} |`,
      );
    }
  lines.push(
    "",
    "## Failure distribution",
    "",
    "| Representation | Failure | Count |",
    "|---|---|---:|",
  );
  for (const v of variants) {
    const counts = new Map<string, number>();
    for (const r of initial.filter((r) => r.variant === v && !r.success))
      counts.set(r.failure_type!, (counts.get(r.failure_type!) ?? 0) + 1);
    for (const [type, count] of [...counts].sort())
      lines.push(`| ${v} | ${type} | ${count} |`);
  }
  lines.push(
    "",
    "## Selective repeats",
    "",
    "The rule was recorded before the initial results: rank tasks with any indexed-arm success between 20% and 80%, or local/structural success within 20 pp with at least one mixed outcome; score by number of mixed arms, closeness, and summed Bernoulli variance. Extend at most four tasks, using repeats 10–19 for all five arms. The extension is exploratory and does not replace or pool away the balanced initial comparison.",
    "",
  );
  for (const s of selectRepeatTasks(initial)) lines.push(`- ${s.task}: ${s.reason}.`);
  const mixed = variability(initial);
  lines.push(
    "",
    `${mixed.filter((g) => g.successMixed).length}/${mixed.length} initial task/variant groups have mixed success. Temperature 0 did not ensure deterministic outcomes.`,
    "",
    "| Extended task | Representation | Initial success | Additional ten repeats | Combined twenty (selected tasks only) |",
    "|---|---|---:|---:|---:|",
  );
  for (const task of [...new Set(extension.map((r) => r.task_id))].sort())
    for (const v of variants) {
      const a = initial.filter((r) => r.task_id === task && r.variant === v);
      const b = extension.filter((r) => r.task_id === task && r.variant === v);
      lines.push(
        `| ${task} | ${v} | ${percent(a.filter((r) => r.success).length, a.length)} | ${percent(b.filter((r) => r.success).length, b.length)} | ${percent([...a, ...b].filter((r) => r.success).length, a.length + b.length)} |`,
      );
    }
  lines.push(
    "",
    "## Interpretation boundaries",
    "",
    "Demonstrated effects are within these bounded candidate descriptions and this convenience cohort. Compact/role descriptions intentionally lack entity-to-id mappings on repeated-label tasks; their performance is not a test of indexing with a full page dump. Nested cases intentionally retain indistinguishable local text, testing the incremental value of a section. Reorder/rerender completes deterministically before observation; this is not a stale-recovery study. Hidden/disabled elements are omitted identically from indexed candidate sets.",
    "",
    "Raw-selector results are a reference, not a representation treatment: the reference has DOM structure and selector syntax costs, and hidden siblings may count in original-DOM CSS matching even when absent from visible evidence. Do not attribute this asymmetry to semantic superiority of indexing.",
    "",
    "Task-cluster intervals use 2,000 deterministic bootstrap draws, preserving repeats inside tasks. They describe task heterogeneity in a small local sample, not open-web performance. Shared provider effects can correlate repeats. A production default is justified only by a clear reliability/cost advantage; close or task-specific results support optional context, not universal richer-is-better claims. The production TypeSafe model and CLI/MCP representation are unchanged.",
    "",
    "## Representative actual failure traces",
    "",
  );
  const representatives: SummaryRecord[] = [];
  const keys = new Set<string>();
  for (const r of initial.filter((r) => !r.success)) {
    const key = `${r.variant}/${r.failure_type}`;
    if (!keys.has(key)) {
      keys.add(key);
      representatives.push(r);
    }
    if (representatives.length === 8) break;
  }
  const ids = new Set(representatives.map((r) => r.run_id));
  lines.push(failureAnalysis(records.filter((r) => ids.has(r.run_id))));
  return `${lines.join("\n")}\n`;
}
async function main(): Promise<void> {
  const [mode, ...paths] = process.argv.slice(2);
  if (mode === "select") {
    const records = await auditCohort(paths[0]!);
    const runs = records.filter((r) => r.record_type === "summary");
    const selection = selectRepeatTasks(runs);
    const base = cohortSchema.parse(
      JSON.parse(await readFile("evals/cohorts/ambiguity-initial.json", "utf8")),
    );
    const tasks = parseTasks(JSON.parse(await readFile(base.tasks, "utf8"))).filter(
      (t) => selection.some((s) => s.task === t.id),
    );
    if (!tasks.length) {
      console.log("No tasks met selective-repeat criteria.");
      return;
    }
    await writeFile(
      "evals/tasks/ambiguity-extension.json",
      `${JSON.stringify(tasks, null, 2)}\n`,
    );
    const config: Cohort = {
      ...base,
      id: "ambiguity-extension",
      tasks: "evals/tasks/ambiguity-extension.json",
      repeats: 10,
      repetitionOffset: 10,
    };
    await writeFile(
      "evals/cohorts/ambiguity-extension.json",
      `${JSON.stringify(config, null, 2)}\n`,
    );
    await writeFile(
      "evals/reports/ambiguity-repeat-selection.json",
      `${JSON.stringify(selection, null, 2)}\n`,
    );
    console.log(selection);
  } else if (mode === "report") {
    const results = [];
    for (const path of paths) results.push(...(await auditCohort(path)));
    const runs = results.filter((r) => r.record_type === "summary");
    for (const field of [
      "source_hash",
      "fixture_hash",
      "system_prompt_hash",
      "task_prompt_hash",
      "browser_version",
      "model",
      "max_steps",
    ] as const)
      if (new Set(runs.map((r) => r.metadata[field])).size !== 1)
        throw new Error(`Cannot compare changed study controls: ${field}`);
    await mkdir("evals/reports", { recursive: true });
    await writeFile(
      "evals/reports/ambiguity-study.md",
      await format(ambiguityReport(results), {
        parser: "markdown",
        proseWrap: "always",
        printWidth: 88,
      }),
    );
    console.log("Audited cohorts; wrote evals/reports/ambiguity-study.md");
  } else
    throw new Error(
      "Use select INITIAL.jsonl or report INITIAL.jsonl [EXTENSION.jsonl]",
    );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
