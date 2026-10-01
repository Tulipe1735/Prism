import type {
  AdaptiveLevel,
  EvalTask,
  ResultRecord,
  StepRecord,
  SummaryRecord,
  Variant,
} from "../schema.ts";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseTasks } from "../schema.ts";
import { ADAPTIVE_LEVELS } from "./adaptive.ts";
import { pairKey, sourceHash } from "./cohort.ts";
import {
  auditHistorical,
  CONFIRMATORY_VARIANTS,
  fileHash,
  verifyCompletedCells,
} from "./confirmatory-controls.ts";
import { loadRecords } from "./report.ts";
import { representationCost } from "./representation.ts";
import { firstGroundingSuccess, hash } from "./run.ts";
import { clusterInterval, mean } from "./statistics.ts";

const ROOT = "evals/reports/paper-confirmatory-v1";
const pct = (n: number, d: number): string =>
  d ? `${((100 * n) / d).toFixed(1)}% (${n}/${d})` : "n/a";
const num = (n: number | null): string => (n === null ? "n/a" : n.toFixed(2));
const sum = (v: number[]): number => v.reduce((a, b) => a + b, 0);
const avg = (v: number[]): number | null => (v.length ? mean(v) : null);
const infra = (r: SummaryRecord): boolean =>
  (r.infrastructure_failures?.length ?? 0) > 0;
export const rank = (level: AdaptiveLevel): number => ADAPTIVE_LEVELS.indexOf(level);

export function policyDiagnostic(
  step: StepRecord,
  run: SummaryRecord,
): { over: boolean; under: boolean } {
  const a = step.adaptive;
  if (!a?.expected_minimum_level) return { over: false, under: false };
  return {
    over: rank(a.final_level) > rank(a.expected_minimum_level),
    under:
      rank(a.final_level) < rank(a.expected_minimum_level) &&
      (a.unresolved_ambiguity || !run.grounding_success),
  };
}

export interface PairedEffect {
  difference: number;
  interval: [number, number];
  per_task: Array<{ task: string; repeats: number; difference: number }>;
  pairs: number;
  clusters: number;
}
export interface ConfirmatoryAudit {
  expected_runs: number;
  terminal_summaries: number;
  unique_cells: number;
  complete: boolean;
  valid: boolean;
  failures: string[];
  historical: { checked: number; changed: string[] };
  source_archive: { path: string; sha256: string };
}

/** Paired task-repeat differences are averaged inside each task BEFORE cluster resampling. */
export function pairedEffect(
  runs: SummaryRecord[],
  comparator: Variant,
  metric: (r: SummaryRecord) => number | null,
  treatment: Variant = "indexed-adaptive",
): PairedEffect | null {
  const a = runs.filter((r) => r.variant === treatment);
  const b = new Map(
    runs
      .filter((r) => r.variant === comparator)
      .map((r) => [`${r.task_id}/${r.repetition}`, r]),
  );
  const groups = new Map<string, number[]>();
  for (const r of a) {
    const match = b.get(`${r.task_id}/${r.repetition}`);
    if (!match) return null;
    const x = metric(r);
    const y = metric(match);
    if (x === null || y === null) return null;
    groups.set(r.task_id, [...(groups.get(r.task_id) ?? []), x - y]);
  }
  if (!groups.size || a.length !== b.size) return null;
  const perTask = [...groups].sort().map(([task, differences]) => ({
    task,
    repeats: differences.length,
    difference: mean(differences),
  }));
  const values = perTask.map((g) => g.difference);
  return {
    difference: mean(values),
    interval: clusterInterval(values),
    per_task: perTask,
    pairs: a.length,
    clusters: perTask.length,
  };
}

export async function auditConfirmatory(
  records: ResultRecord[],
  tasks: EvalTask[],
): Promise<ConfirmatoryAudit> {
  const freeze = JSON.parse(
    await readFile("evals/cohorts/paper-confirmatory-v1.freeze.json", "utf8"),
  );
  const plan = JSON.parse(
    await readFile("evals/results/paper-confirmatory-v1.jsonl.meta.json", "utf8"),
  );
  const runs = records.filter((r): r is SummaryRecord => r.record_type === "summary");
  const steps = records.filter((r): r is StepRecord => r.record_type === "step");
  verifyCompletedCells(runs, freeze.controls.planned_pairs);
  const failures: string[] = [];
  const ids = new Set(runs.map((r) => r.run_id));
  if (ids.size !== runs.length || steps.some((r) => !ids.has(r.run_id)))
    failures.push("Duplicate terminal or orphan step");
  if (
    plan.experiment_id !== runs[0]?.experiment_id ||
    JSON.stringify(plan.planned_pairs) !== JSON.stringify(freeze.controls.planned_pairs)
  )
    failures.push("Plan differs from freeze");
  if (plan.completed_runs !== runs.length) failures.push("Checkpoint count mismatch");
  for (const r of runs) {
    const t = tasks.find((t) => t.id === r.task_id)!;
    const rows = steps.filter((s) => s.run_id === r.run_id);
    if (
      r.grounding_success !== firstGroundingSuccess(rows) ||
      r.strict_task_success !== r.success ||
      r.steps !== rows.filter((s) => s.executed).length ||
      r.llm_calls !== sum(rows.map((s) => s.llm_calls)) ||
      r.metadata.task_hash !==
        hash(JSON.stringify({ ...t, maxSteps: freeze.controls.cohort.maxSteps })) ||
      r.metadata.source_hash !== freeze.controls.source_hash ||
      r.metadata.fixture_hash !== freeze.controls.fixture_hash ||
      r.metadata.system_prompt_hash !== freeze.controls.system_prompt_hash ||
      r.metadata.task_prompt_hash !== freeze.controls.task_prompt_hash ||
      r.metadata.browser_version !== freeze.controls.environment.browser.product ||
      r.metadata.node_version !== freeze.controls.node_version ||
      r.metadata.model !== freeze.controls.cohort.model ||
      r.metadata.returned_models.some((m) => m !== r.metadata.model) ||
      JSON.stringify(r.metadata.cohort) !== JSON.stringify(freeze.controls.cohort) ||
      rows.some((s) => pairKey(s) !== pairKey(r) || s.experiment_id !== r.experiment_id)
    )
      failures.push(`Outcome/control inconsistency: ${pairKey(r)}`);
    for (const s of rows) {
      if (
        s.model_input &&
        JSON.stringify(representationCost(s.model_input)) !==
          JSON.stringify(s.representation_cost)
      )
        failures.push(`Cost mismatch: ${r.run_id}/${s.step}`);
      if (
        s.adaptive &&
        (s.adaptive.task_ambiguity_class !== t.preregistered?.ambiguity_class ||
          s.adaptive.expected_minimum_level !== t.preregistered?.minimum_level ||
          s.adaptive.matches_minimum_level !==
            (s.adaptive.final_level === t.preregistered?.minimum_level))
      )
        failures.push(`Adaptive annotation mismatch: ${r.run_id}/${s.step}`);
    }
  }
  const historical = await auditHistorical();
  if (historical.changed.length) failures.push("Protected historical files changed");
  if (
    (await sourceHash()) !== freeze.controls.source_hash ||
    (await fileHash("evals/tasks/paper-confirmatory-v1.json")) !==
      freeze.controls.task_file_hash ||
    (await fileHash("evals/cohorts/paper-confirmatory-v1.json")) !==
      freeze.controls.cohort_file_hash ||
    (await fileHash(freeze.source_archive.path)) !== freeze.source_archive.sha256
  )
    failures.push("Frozen source/config/task/archive hash mismatch");
  const complete =
    runs.length === 240 &&
    new Set(runs.map(pairKey)).size === 240 &&
    plan.status === "complete";
  return {
    expected_runs: 240,
    terminal_summaries: runs.length,
    unique_cells: new Set(runs.map(pairKey)).size,
    complete,
    valid: failures.length === 0,
    failures,
    historical,
    source_archive: freeze.source_archive,
  };
}

export function generateConfirmatoryReport(
  records: ResultRecord[],
  tasks: EvalTask[],
  audit: Awaited<ReturnType<typeof auditConfirmatory>>,
  frozen: any,
): { markdown: string; analysis: unknown } {
  const runs = records.filter((r): r is SummaryRecord => r.record_type === "summary");
  const steps = records.filter((r): r is StepRecord => r.record_type === "step");
  const byRun = new Map(runs.map((r) => [r.run_id, r]));
  const annotation = new Map(tasks.map((t) => [t.id, t.preregistered!]));
  const initial = runs
    .map((r) => steps.find((s) => s.run_id === r.run_id && s.representation_cost))
    .filter((s): s is StepRecord => Boolean(s));
  const adaptive = steps.filter((s) => s.variant === "indexed-adaptive" && s.adaptive);
  const adaptiveInitial = initial.filter(
    (s) => s.variant === "indexed-adaptive" && s.adaptive,
  );
  const groups = ["overall", "unique", "local", "structural"];
  const select = (group: string): SummaryRecord[] =>
    runs.filter(
      (r) =>
        group === "overall" || annotation.get(r.task_id)?.ambiguity_class === group,
    );
  const lines = [
    "# Paper Confirmatory Study v1",
    "",
    "## Experimental Setup",
    "",
    `**${audit.complete && audit.valid ? "COMPLETE AND AUDITED" : "INCOMPLETE — descriptive only"}: ${runs.length}/240 unique planned terminal summaries.**`,
    "",
    "Historical ambiguity-initial, adaptive pilot, stale/validation and delayed-modal studies are exploratory evidence. Their raw results, reports, tasks, fixtures and cohort files were preserved; none are pooled here.",
    "",
    `Preregistered 12 new controlled tasks (4 unique, 4 local, 4 structural) × 5 repeats × 4 variants. Model ${frozen.controls.cohort.model}, temperature 0, top_p 1, max_tokens 8192, provider-default reasoning; OpenCode Go; ${frozen.controls.environment.browser.product}; Node ${frozen.controls.node_version}; viewport 1120×780; 8 actions; 240s task deadline; 120s request timeout; up to 2 preregistered HTTP retries, 5 stale retries, 4 concurrent tabs, cohort cap6500 calls. Freeze ${frozen.frozen_at}.`,
    "",
    "Primary causal contrasts: Adaptive versus Local, Adaptive versus Structural. Raw-selector-reference receives extra public locator DOM and generates CSS; it is a descriptive reference arm. Indexed arms share status-only page text and differ in action descriptions. The pilot policy/extractor/formatter/prompts are unchanged.",
    "",
    "Grounding Success scores the first audited target execution independently of later termination. Strict Task Success requires DONE, no runtime error, full final oracle and zero wrong inputs. Correct-click/later-provider-error runs remain grounding successes. Five repeats are matched by task and repetition; 95% CIs resample 12 task clusters (2,000 bootstrap draws, seed1735), and strata resample their 4 task clusters. No non-inferiority margin or equivalence claim.",
    "",
    `Protected historical audit: ${audit.historical.checked} files, ${audit.historical.changed.length} changed. Exact snapshot: ${audit.source_archive.path} (SHA256 ${audit.source_archive.sha256}). Freeze/config/task/source/prompt/fixture controls are verified before execution/resume and each dispatch.`,
    "",
    `Environment drift from pilot: ${JSON.stringify(frozen.environment_drift_from_pilot)}.`,
    "",
    "| Task | Class | Expected minimum | Goal |",
    "|---|---|---|---|",
    ...tasks.map(
      (t) =>
        `| ${t.id} | ${t.preregistered!.ambiguity_class} | ${t.preregistered!.minimum_level} | ${t.goal} |`,
    ),
    "",
    "local-04 intentionally includes unrelated hierarchical Help collisions; its requested Edit target needs only local context. Final level is the maximum across all candidates. This can expose unnecessary policy expansion. Positions are globally balanced; these authored fixtures are not a held-out natural-web sample.",
    "",
    "## RQ1 — Action Representation and Grounding",
    "",
    "| Class | Variant | Grounding Success | Correct Target Rate | Wrong Target Rate | Any wrong run | Semantic ambiguity failure | Invalid Action Rate | Strict Task Success |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const g of groups)
    for (const v of CONFIRMATORY_VARIANTS) {
      const r = select(g).filter((r) => r.variant === v);
      lines.push(
        `| ${g} | ${v} | ${pct(r.filter((r) => r.grounding_success).length, r.length)} | ${pct(sum(r.map((r) => r.correct_target_selections)), sum(r.map((r) => r.scored_target_attempts)))} | ${pct(sum(r.map((r) => r.wrong_target_actions ?? 0)), sum(r.map((r) => r.grounding_observed_actions)))} | ${pct(r.filter((r) => (r.wrong_target_actions ?? 0) > 0).length, r.length)} | ${pct(r.filter((r) => r.failure_type === "SEMANTIC_AMBIGUITY").length, r.length)} | ${pct(sum(r.map((r) => r.invalid_actions)), sum(r.map((r) => r.attempts)))} | ${pct(r.filter((r) => r.strict_task_success).length, r.length)} |`,
      );
    }
  lines.push(
    "",
    "Correct target rates are conditional on scored accepted selections, including stale proposals. Wrong-target rates count executed audited inputs; any-wrong run rate exposes trajectory contamination. Missing oracle coverage is not zero. Primary semantic-failure counts may coexist with later infrastructure events.",
    "",
    "### Per-task results",
    "",
    "Each cell: grounding / strict / runs; W = wrong executed inputs.",
    "",
    "| Task | Local | Structural | Adaptive | Selector reference |",
    "|---|---|---|---|---|",
  );
  for (const t of tasks)
    lines.push(
      `| ${t.id} | ${CONFIRMATORY_VARIANTS.map((v) => {
        const r = runs.filter((r) => r.task_id === t.id && r.variant === v);
        return `${r.filter((r) => r.grounding_success).length}/${r.filter((r) => r.strict_task_success).length}/${r.length}; W=${sum(r.map((r) => r.wrong_target_actions ?? 0))}`;
      }).join(" | ")} |`,
    );
  const comparisonMetrics = {
    grounding: (r: SummaryRecord) => Number(r.grounding_success),
    strict: (r: SummaryRecord) => Number(r.strict_task_success),
    any_wrong: (r: SummaryRecord) => Number((r.wrong_target_actions ?? 0) > 0),
    representation_tokens_per_observation: (r: SummaryRecord) =>
      r.representation_observations
        ? r.representation_estimated_tokens_total / r.representation_observations
        : null,
    initial_representation_tokens: (r: SummaryRecord) =>
      initial.find((s) => s.run_id === r.run_id)?.representation_cost
        ?.estimated_tokens ?? null,
    input_tokens: (r: SummaryRecord) => r.input_tokens,
    output_tokens: (r: SummaryRecord) => r.output_tokens,
    total_tokens: (r: SummaryRecord) => r.total_tokens,
    calls: (r: SummaryRecord) => r.llm_calls,
    retries: (r: SummaryRecord) => r.retries,
    steps: (r: SummaryRecord) => r.steps,
    latency_ms: (r: SummaryRecord) => r.latency_ms,
  };
  const effects: Record<string, ReturnType<typeof pairedEffect>> = {};
  for (const g of groups)
    for (const v of ["indexed-local", "indexed-structural"] as const)
      for (const [metric, fn] of Object.entries(comparisonMetrics))
        effects[`${g}/${v}/${metric}`] = pairedEffect(select(g), v, fn);
  for (const g of groups)
    effects[`${g}/structural-minus-local/grounding`] = pairedEffect(
      select(g),
      "indexed-local",
      (r) => Number(r.grounding_success),
      "indexed-structural",
    );
  const effectText = (e: ReturnType<typeof pairedEffect>, scale = 1): string =>
    e
      ? `${num(e.difference * scale)} [${num(e.interval[0] * scale)}, ${num(e.interval[1] * scale)}]`
      : "n/a (missing pair/usage)";
  lines.push(
    "",
    "### Matched grounding effects",
    "",
    "Adaptive minus comparator, percentage points; 95% task-cluster CI. Positive means higher adaptive grounding rate.",
    "",
    "| Class | Contrast | Grounding difference [95% CI] | Strict difference [95% CI] | Any-wrong difference [95% CI] |",
    "|---|---|---|---|---|",
  );
  for (const g of groups)
    for (const v of ["indexed-local", "indexed-structural"] as const)
      lines.push(
        `| ${g} | Adaptive − ${v} | ${effectText(effects[`${g}/${v}/grounding`]!, 100)} | ${effectText(effects[`${g}/${v}/strict`]!, 100)} | ${effectText(effects[`${g}/${v}/any_wrong`]!, 100)} |`,
      );
  lines.push(
    "",
    `Fixed scope comparison: Structural minus Local Grounding Success, percentage points [95% task-cluster CI]: ${groups.map((g) => `${g}: ${effectText(effects[`${g}/structural-minus-local/grounding`]!, 100)}`).join("; ")}.`,
  );
  lines.push(
    "",
    "Per-task paired effects (all metrics and strata) are retained in paper-confirmatory-v1-analysis.json. A degenerate empirical interval is not proof of zero population uncertainty.",
    "",
    "## RQ2 — Adaptive Context Expansion",
    "",
  );
  const adaptiveRuns = runs.filter((r) => r.variant === "indexed-adaptive");
  const structuralRuns = runs.filter((r) => r.variant === "indexed-structural");
  const gap = effects["overall/indexed-structural/grounding"];
  lines.push(
    `Structural Grounding Success: ${pct(structuralRuns.filter((r) => r.grounding_success).length, structuralRuns.length)}. Adaptive: ${pct(adaptiveRuns.filter((r) => r.grounding_success).length, adaptiveRuns.length)}. Absolute reliability gap (Structural − Adaptive): ${gap ? `${num(-gap.difference * 100)} pp [${num(-gap.interval[1] * 100)}, ${num(-gap.interval[0] * 100)}]` : "n/a"}. No non-inferiority margin was preregistered.`,
    "",
    "### Context cost and paired savings",
    "",
    "Adaptive minus comparator in estimated tokens; negative means less context.",
    "",
    "| Class | Contrast | Initial tokens difference [95% CI] | Tokens/observation difference [95% CI] |",
    "|---|---|---|---|",
  );
  for (const g of groups)
    for (const v of ["indexed-local", "indexed-structural"] as const)
      lines.push(
        `| ${g} | Adaptive − ${v} | ${effectText(effects[`${g}/${v}/initial_representation_tokens`]!)} | ${effectText(effects[`${g}/${v}/representation_tokens_per_observation`]!)} |`,
      );
  lines.push(
    "",
    "### Escalation distribution",
    "",
    "| Observation set | N | Compact | Role | Local | Structural | Any escalation |",
    "|---|---|---|---|---|---|---|",
  );
  for (const [name, set] of [
    ["Initial (primary)", adaptiveInitial],
    [
      "All pre-grounding",
      adaptive.filter((s) => s.adaptive!.task_phase === "pre-grounding"),
    ],
    [
      "Post-grounding",
      adaptive.filter((s) => s.adaptive!.task_phase === "post-grounding"),
    ],
    ["All observations", adaptive],
  ] as const)
    lines.push(
      `| ${name} | ${set.length} | ${ADAPTIVE_LEVELS.map((l) => pct(set.filter((s) => s.adaptive!.final_level === l).length, set.length)).join(" | ")} | ${pct(set.filter((s) => s.adaptive!.final_level !== "compact").length, set.length)} |`,
    );
  lines.push(
    "",
    "### Expected minimum versus Adaptive final level (initial observations)",
    "",
    "| Expected | Compact | Role | Local | Structural |",
    "|---|---|---|---|---|",
  );
  const confusion = Object.fromEntries(
    ADAPTIVE_LEVELS.map((expected) => [
      expected,
      Object.fromEntries(
        ADAPTIVE_LEVELS.map((actual) => [
          actual,
          adaptiveInitial.filter(
            (s) =>
              s.adaptive!.expected_minimum_level === expected &&
              s.adaptive!.final_level === actual,
          ).length,
        ]),
      ),
    ]),
  );
  for (const expected of ADAPTIVE_LEVELS)
    lines.push(
      `| ${expected} | ${ADAPTIVE_LEVELS.map((actual) => confusion[expected]![actual]).join(" | ")} |`,
    );
  const over = adaptiveInitial.filter(
    (s) => policyDiagnostic(s, byRun.get(s.run_id)!).over,
  ).length;
  const under = adaptiveInitial.filter(
    (s) => policyDiagnostic(s, byRun.get(s.run_id)!).under,
  ).length;
  const structuralChosen = adaptiveInitial.filter(
    (s) => s.adaptive!.final_level === "structural",
  );
  const trueStructural = structuralChosen.filter(
    (s) => s.adaptive!.expected_minimum_level === "structural",
  ).length;
  const structuralExpected = adaptiveInitial.filter(
    (s) => s.adaptive!.expected_minimum_level === "structural",
  ).length;
  lines.push(
    "",
    `Minimum match ${pct(adaptiveInitial.filter((s) => s.adaptive!.matches_minimum_level).length, adaptiveInitial.length)}; over-expansion ${pct(over, adaptiveInitial.length)}; under-expansion ${pct(under, adaptiveInitial.length)}. Structural escalation precision ${pct(trueStructural, structuralChosen.length)}; recall ${pct(trueStructural, structuralExpected)}.`,
    "",
    "These primary diagnostics score the requested target's frozen minimum on the initial observation. The all-observation distribution includes cheap terminal turns; terminal levels are not evidence of under-expansion. Every adaptive observation's collisions, phase, candidate levels, expected-level match and cost are saved in the analysis artifact.",
    "",
    "## RQ3 — End-to-End Context Efficiency",
    "",
    "### Representation-level cost",
    "",
    "| Variant | Observations | Chars/obs | Est. tokens/obs | Initial est. tokens | Est. tokens/grounding success | Est. tokens/strict success |",
    "|---|---|---|---|---|---|---|",
  );
  for (const v of CONFIRMATORY_VARIANTS) {
    const r = runs.filter((r) => r.variant === v);
    const observations = sum(r.map((r) => r.representation_observations));
    const tokens = sum(r.map((r) => r.representation_estimated_tokens_total));
    const gs = r.filter((r) => r.grounding_success).length;
    const ss = r.filter((r) => r.strict_task_success).length;
    lines.push(
      `| ${v} | ${observations} | ${num(observations ? sum(r.map((r) => r.representation_chars_total)) / observations : null)} | ${num(observations ? tokens / observations : null)} | ${num(avg(initial.filter((s) => s.variant === v).map((s) => s.representation_cost!.estimated_tokens)))} | ${num(gs ? tokens / gs : null)} | ${num(ss ? tokens / ss : null)} |`,
    );
  }
  lines.push(
    "",
    "Tokens here are ceil(UTF-8 bytes/4), including target-map syntax; selector-reference includes DOM. They are estimates, not GLM tokenizer or billed tokens. Cost per success charges the arm's failed-run overhead. HTTP retransmissions are represented by provider call counts rather than counted as new observations.",
    "",
    "### Provider usage and interaction cost",
    "",
    "Exact totals require usage for every actual HTTP attempt. Observed usage lower bounds remain separate; failed/retry calls may have unreported consumption.",
    "",
    "| Variant | Complete-usage tasks | Usage-bearing calls / actual calls | Input/task | Output/task | Total/task | Observed total lower bound/task | Total/grounding success | Total/strict success | Calls/task | Retries/task | Steps/task | Latency ms/task |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  );
  for (const v of CONFIRMATORY_VARIANTS) {
    const r = runs.filter((r) => r.variant === v);
    const rows = steps.filter((s) => s.variant === v);
    const complete = r.length > 0 && r.every((r) => r.total_tokens !== null);
    const fullMean = (
      key: "input_tokens" | "output_tokens" | "total_tokens",
    ): number | null =>
      r.length && r.every((r) => r[key] !== null) ? avg(r.map((r) => r[key]!)) : null;
    const total = complete ? sum(r.map((r) => r.total_tokens!)) : null;
    const gs = r.filter((r) => r.grounding_success).length;
    const ss = r.filter((r) => r.strict_task_success).length;
    lines.push(
      `| ${v} | ${r.filter((r) => r.total_tokens !== null).length}/${r.length} | ${rows.filter((s) => s.total_tokens !== null).length}/${sum(r.map((r) => r.llm_calls))} | ${num(fullMean("input_tokens"))} | ${num(fullMean("output_tokens"))} | ${num(fullMean("total_tokens"))} | ${num(r.length ? sum(rows.map((s) => s.total_tokens ?? 0)) / r.length : null)} | ${num(total !== null && gs ? total / gs : null)} | ${num(total !== null && ss ? total / ss : null)} | ${num(avg(r.map((r) => r.llm_calls)))} | ${num(avg(r.map((r) => r.retries)))} | ${num(avg(r.map((r) => r.steps)))} | ${num(avg(r.map((r) => r.latency_ms)))} |`,
    );
  }
  lines.push(
    "",
    "### Matched inference-cost effects",
    "",
    "Adaptive minus comparator; 95% task-cluster intervals. Missing usage invalidates the complete paired token estimate.",
    "",
    "| Class | Contrast | Input tokens | Output tokens | Total tokens | Calls | Retries | Steps | Latency ms |",
    "|---|---|---|---|---|---|---|---|---|",
  );
  for (const g of groups)
    for (const v of ["indexed-local", "indexed-structural"] as const)
      lines.push(
        `| ${g} | Adaptive − ${v} | ${["input_tokens", "output_tokens", "total_tokens", "calls", "retries", "steps", "latency_ms"].map((m) => effectText(effects[`${g}/${v}/${m}`]!)).join(" | ")} |`,
      );
  const reprEffect =
    effects["overall/indexed-structural/initial_representation_tokens"];
  const tokenEffect = effects["overall/indexed-structural/total_tokens"];
  const savings = reprEffect && reprEffect.interval[1] < 0;
  const inferenceSavings = tokenEffect && tokenEffect.interval[1] < 0;
  lines.push(
    "",
    `Representation cost and inference cost are distinct: initial Adaptive − Structural representation effect ${effectText(reprEffect!)} estimated tokens; total provider-token effect ${effectText(tokenEffect!)}. ${inferenceSavings ? "The observed paired total-token interval supports reduced inference usage for this cohort." : "Reduced end-to-end inference usage is not established by the paired total-token interval (or usage coverage); smaller context alone is insufficient."}`,
    "",
    "## Failure Analysis",
    "",
    "Counts overlap when a grounding or terminal failure also has infrastructure events. A successful preregistered retry retains its original event. Grounding failures are runs without first-target grounding; strict-only failures grounded correctly but fail the full trajectory.",
    "",
    "| Variant | Grounding failures | Strict-task-only failures | Infrastructure-affected runs | Primary failure distribution |",
    "|---|---|---|---|---|",
  );
  const failureIndex = runs
    .filter((r) => !r.strict_task_success || infra(r))
    .map((r) => ({
      task: r.task_id,
      variant: r.variant,
      repetition: r.repetition,
      run_id: r.run_id,
      grounding_success: r.grounding_success,
      strict_task_success: r.strict_task_success,
      primary: r.failure_type,
      infrastructure: r.infrastructure_failures,
      reason: r.reason,
    }));
  for (const v of CONFIRMATORY_VARIANTS) {
    const r = runs.filter((r) => r.variant === v);
    const counts: Record<string, number> = {};
    for (const x of r.filter((r) => !r.strict_task_success))
      counts[x.failure_type ?? "UNKNOWN"] =
        (counts[x.failure_type ?? "UNKNOWN"] ?? 0) + 1;
    lines.push(
      `| ${v} | ${r.filter((r) => !r.grounding_success).length} | ${r.filter((r) => r.grounding_success && !r.strict_task_success).length} | ${r.filter(infra).length} | ${
        Object.entries(counts)
          .map(([k, n]) => `${k}: ${n}`)
          .join("; ") || "none"
      } |`,
    );
  }
  lines.push(
    "",
    `Adaptive annotation-relative policy labels: OVER_EXPANSION ${over}, UNDER_EXPANSION ${under} initial observations. Over-expansion is not an automatic task failure. Required taxonomy additionally distinguishes SEMANTIC_AMBIGUITY, MODEL_OUTPUT_ERROR, DECISION_ERROR, INVALID_ACTION, EXECUTION_ERROR, BUDGET_EXCEEDED, PROVIDER_TIMEOUT, PROVIDER_HTTP_ERROR, ENDPOINT_FAILURE and UNKNOWN. A wrong target has concrete semantic evidence; label co-occurrence does not identify the causal mechanism. Every failed/infra-affected run is indexed in the analysis JSON with complete traces available by run_id in the raw JSONL.`,
    "",
    "## Threats to Validity",
    "",
    "Twelve authored synthetic/local fixtures, one model, one provider, one prompt, one browser/runtime. The five repeats are not independent tasks. Four task clusters per stratum yield unstable bootstrap tails; zero differences can give degenerate empirical intervals. Provider serving state, time and concurrency may correlate repetitions; balanced ordering mitigates but does not eliminate this. Local/structural formats bundle multiple fields and truncation limits. The target-minimum annotations are designed sufficiency expectations, not natural-web ground truth. Whole-space collisions can exceed target needs. Selector reference has extra DOM and different locator syntax. Static token estimates are heuristic; provider usage can be incomplete. Structured probability-head errors are policy/protocol failures, not proof of inadequate semantic context. No open-web, external benchmark, second-model or universal-superiority inference.",
    "",
    "## Confirmatory Conclusions",
    "",
    `RQ1: compare the class-specific grounding and wrong-input effects above; local labels and section headings are the preregistered information interventions. RQ2: observed Structural − Adaptive grounding gap ${gap ? `${num(-gap.difference * 100)} pp` : "n/a"}; ${savings ? "initial representation savings are supported for these fixtures" : "initial representation savings are not established"}, with ${over} over- and ${under} under-expansions. RQ3: ${inferenceSavings ? "paired provider totals support reduced inference usage relative to Structural in this cohort" : "the data do not establish reduced end-to-end total-token usage relative to Structural"}. No non-inferiority conclusion is licensed.`,
    "",
    "A second-model replication must repeat a separately frozen matched design and test policy/protocol dependence. Open-web/external benchmark replication must test varied DOMs, real multi-step tasks, dynamic pages and independently audited grounding. Neither is run in this milestone.",
    "",
    "### Paper-style claim ledger",
    "",
    "| Status | Claim and scope |",
    "|---|---|",
  );
  const claimReady = audit.complete && audit.valid;
  lines.push(
    `| ${claimReady && savings ? "Supported" : "Unsupported"} | Adaptive reduces initial representation cost relative to Structural on these frozen fixtures (${effectText(reprEffect!)} estimated tokens). |`,
  );
  const adaptiveWrong = sum(adaptiveRuns.map((r) => r.wrong_target_actions ?? 0));
  lines.push(
    `| ${claimReady && adaptiveWrong === 0 ? "Supported" : "Unsupported"} | Adaptive has zero observed wrong-target inputs in this cohort (observed ${adaptiveWrong}; no universal zero-error claim). |`,
  );
  lines.push(
    `| ${claimReady && inferenceSavings ? "Supported" : "Unsupported"} | Adaptive reduces complete end-to-end provider token usage relative to Structural (${effectText(tokenEffect!)} tokens). |`,
  );
  lines.push(
    `| Tentative | Adaptive has similar reliability to Structural only to the extent allowed by the observed gap and task-cluster interval; no preregistered non-inferiority margin. |`,
  );
  lines.push(
    "| Unsupported | Statistical non-inferiority/equivalence, open-web generalization, cross-model generalization, universal superiority and lower monetary cost. |",
    "",
  );
  const analysis = {
    audit,
    effects,
    confusion,
    policy: {
      initial: adaptiveInitial.length,
      over,
      under,
      structural_precision: {
        numerator: trueStructural,
        denominator: structuralChosen.length,
      },
      structural_recall: { numerator: trueStructural, denominator: structuralExpected },
    },
    failure_index: failureIndex,
    adaptive_observations: adaptive.map((s) => ({
      task_id: s.task_id,
      run_id: s.run_id,
      repetition: s.repetition,
      step: s.step,
      ...s.adaptive,
      diagnostic: policyDiagnostic(s, byRun.get(s.run_id)!),
    })),
  };
  return { markdown: lines.join("\n"), analysis };
}

async function main(): Promise<void> {
  const tasks = parseTasks(
    JSON.parse(await readFile("evals/tasks/paper-confirmatory-v1.json", "utf8")),
  );
  const records = await loadRecords(["evals/results/paper-confirmatory-v1.jsonl"]);
  const frozen = JSON.parse(
    await readFile("evals/cohorts/paper-confirmatory-v1.freeze.json", "utf8"),
  );
  const audit = await auditConfirmatory(records, tasks);
  if (!audit.valid)
    throw new Error(`Confirmatory audit failed: ${audit.failures.join("; ")}`);
  const result = generateConfirmatoryReport(records, tasks, audit, frozen);
  await writeFile(`${ROOT}.md`, result.markdown);
  await writeFile(
    `${ROOT}-analysis.json`,
    `${JSON.stringify(result.analysis, null, 2)}\n`,
  );
  await writeFile(`${ROOT}-integrity.json`, `${JSON.stringify(audit, null, 2)}\n`);
  console.log(
    `Saved report: ${records.filter((r) => r.record_type === "summary").length}/240; complete=${audit.complete}; historical changed=${audit.historical.changed.length}`,
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
