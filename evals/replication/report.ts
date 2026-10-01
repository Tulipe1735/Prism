import type { EvalTask, ResultRecord, StepRecord, SummaryRecord } from "../schema.ts";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { connectBrowser, parseBrowserUrl } from "../../src/browser/connect.ts";
import { pairKey, sourceHash } from "../runners/cohort.ts";
import { fileHash } from "../runners/confirmatory-controls.ts";
import {
  type ConfirmatoryAudit,
  generateConfirmatoryReport,
  type pairedEffect,
} from "../runners/confirmatory-report.ts";
import { loadRecords } from "../runners/report.ts";
import { representationCost } from "../runners/representation.ts";
import { firstGroundingSuccess, hash } from "../runners/run.ts";
import { parseTasks } from "../schema.ts";
import {
  auditHistorical,
  BROWSER_URL,
  DEFERRED,
  ID,
  PREFIX,
  verifyCompletedCells,
  verifyConfirmatoryFreeze,
} from "./controls.ts";

const ROOT = `evals/reports/${ID}`;
const sum = (numbers: number[]): number => numbers.reduce((a, b) => a + b, 0);
export async function auditConfirmatory(
  records: ResultRecord[],
  tasks: EvalTask[],
): Promise<ConfirmatoryAudit> {
  const freeze = JSON.parse(
    await readFile("evals/cohorts/paper-replication-model2-v1.freeze.json", "utf8"),
  );
  const plan = JSON.parse(
    await readFile("evals/results/paper-replication-model2-v1.jsonl.meta.json", "utf8"),
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
    (await fileHash("evals/cohorts/paper-replication-model2-v1.json")) !==
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

const pct = (n: number, d: number): string =>
  d ? `${((100 * n) / d).toFixed(1)}% (${n}/${d})` : "n/a";
const textEffect = (e: ReturnType<typeof pairedEffect>, scale = 1): string =>
  e
    ? `${(e.difference * scale).toFixed(2)} [${(e.interval[0] * scale).toFixed(2)}, ${(e.interval[1] * scale).toFixed(2)}]`
    : "n/a (incomplete usage/pairs)";
const failureCounts = (runs: SummaryRecord[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const r of runs.filter((r) => !r.strict_task_success))
    counts[r.failure_type ?? "UNKNOWN"] =
      (counts[r.failure_type ?? "UNKNOWN"] ?? 0) + 1;
  return counts;
};
export function responseDiagnostic(
  step: StepRecord,
  previous: StepRecord[],
  responses: any[],
  maxTokens: number,
): any {
  const matching = responses.filter(
    (r) => r.run_id === step.run_id && r.prompt_hash === step.prompt_hash,
  );
  const returned = [...matching].reverse().find((r) => r.status === 200);
  let structured: any = null;
  try {
    structured = JSON.parse(step.raw_model_output ?? "null");
  } catch {
    /* Partial/invalid content remains an error. */
  }
  const reasoning =
    returned?.usage?.completion_tokens_details?.reasoning_tokens ??
    (
      step.usage.find(
        (u) => (u.completion_tokens_details as any)?.reasoning_tokens !== undefined,
      )?.completion_tokens_details as any
    )?.reasoning_tokens;
  const output = step.output_tokens;
  return {
    run_id: step.run_id,
    task_id: step.task_id,
    variant: step.variant,
    repetition: step.repetition,
    step: step.step,
    failure_type: step.failure_type,
    error: step.error,
    output_tokens: output,
    final_content_emitted:
      typeof step.raw_model_output === "string" && step.raw_model_output.length > 0,
    final_structured_content_emitted:
      structured !== null &&
      typeof structured === "object" &&
      !Array.isArray(structured),
    finish_reason: returned?.finish_reason ?? null,
    reasoning_tokens: reasoning ?? null,
    reasoning_consumed_entire_output_budget:
      reasoning === undefined || output === null
        ? null
        : reasoning >= maxTokens && output >= maxTokens,
    full_output_budget: output === null ? null : output >= maxTokens,
    target_decision_recoverable:
      typeof structured?.target?.choice === "string"
        ? true
        : step.raw_model_output === null
          ? false
          : null,
    recovered_target:
      typeof structured?.target?.choice === "string" ? structured.target.choice : null,
    partial_reasoning_available:
      typeof returned?.reasoning_content === "string" &&
      returned.reasoning_content.length > 0,
    target_recoverable_from_partial_reasoning:
      "Not inferred automatically; full preserved response can be inspected. No reasoning intention is substituted for an executable choice.",
    grounding_phase: firstGroundingSuccess(previous)
      ? "after-correct-grounding"
      : "before-correct-grounding",
    response_attempts: matching.length,
  };
}
async function main(): Promise<void> {
  const frozen = JSON.parse(await readFile(`${PREFIX}.freeze.json`, "utf8"));
  const connection = await connectBrowser(parseBrowserUrl(BROWSER_URL));
  try {
    await verifyConfirmatoryFreeze(
      frozen.controls.cohort,
      await connection.client.send("Browser.getVersion"),
      BROWSER_URL,
    );
  } finally {
    await connection.close();
  }
  const tasks = parseTasks(
    JSON.parse(await readFile(frozen.controls.cohort.tasks, "utf8")),
  );
  const records = await loadRecords([`evals/results/${ID}.jsonl`]);
  const audit = await auditConfirmatory(records, tasks);
  if (!audit.valid || !audit.complete)
    throw new Error(`Replication not complete/valid: ${JSON.stringify(audit)}`);
  const runs = records.filter((r): r is SummaryRecord => r.record_type === "summary");
  const steps = records.filter((r): r is StepRecord => r.record_type === "step");
  const responses: any[] = (
    await readFile(`evals/results/${ID}-responses.jsonl`, "utf8")
  )
    .split("\n")
    .filter(Boolean)
    .map((s) => JSON.parse(s));
  if (
    responses.length !== sum(runs.map((r) => r.llm_calls)) ||
    responses.some((r) => !runs.some((run) => run.run_id === r.run_id))
  )
    throw new Error("Response log coverage/run identity audit failed.");
  const diagnostics = steps
    .filter((s) => s.error)
    .map((s) =>
      responseDiagnostic(
        s,
        steps.filter((p) => p.run_id === s.run_id && p.step < s.step),
        responses,
        frozen.controls.cohort.maxTokens,
      ),
    );
  const generated = generateConfirmatoryReport(records, tasks, audit, frozen);
  const analysis: any = generated.analysis;
  const effects = analysis.effects;
  const parent: any = JSON.parse(
    await readFile("evals/reports/paper-confirmatory-v1-analysis.json", "utf8"),
  );
  const parentRecords = await loadRecords([
    "evals/results/paper-confirmatory-v1.jsonl",
  ]);
  const parentRuns = parentRecords.filter(
    (r): r is SummaryRecord => r.record_type === "summary",
  );
  const annotation = new Map(
    tasks.map((t) => [t.id, t.preregistered!.ambiguity_class]),
  );
  const arm = (rs: SummaryRecord[], v: string, group = "overall"): SummaryRecord[] =>
    rs.filter(
      (r) =>
        r.variant === v && (group === "overall" || annotation.get(r.task_id) === group),
    );
  const rate = (rs: SummaryRecord[], v: string, group = "overall"): string => {
    const r = arm(rs, v, group);
    return pct(r.filter((r) => r.grounding_success).length, r.length);
  };
  const meanTokens = (rs: SummaryRecord[], v: string): number | null => {
    const r = arm(rs, v);
    return r.every((r) => r.total_tokens !== null)
      ? sum(r.map((r) => r.total_tokens!)) / r.length
      : null;
  };
  const wrong = (rs: SummaryRecord[]): number =>
    sum(arm(rs, "indexed-adaptive").map((r) => r.wrong_target_actions ?? 0));
  const cost = (v: string): number => {
    const rows = arm(runs, v).map((r) =>
      steps.find((s) => s.run_id === r.run_id && s.representation_cost),
    );
    return sum(rows.map((s) => s!.representation_cost!.estimated_tokens)) / rows.length;
  };
  const reprSaving = 100 * (1 - cost("indexed-adaptive") / cost("indexed-structural"));
  const structural = effects["structural/structural-minus-local/grounding"];
  const local = effects["local/structural-minus-local/grounding"];
  const rel = effects["overall/indexed-structural/grounding"];
  const localTokens = effects["overall/indexed-local/total_tokens"];
  const structuralTokens = effects["overall/indexed-structural/total_tokens"];
  const structuralStatus =
    structural?.interval[0] > 0
      ? "Replicated"
      : structural?.difference <= 0
        ? "Not replicated"
        : "Inconclusive";
  const localRuns = arm(runs, "indexed-local", "local");
  const localSemanticFailures = localRuns.some(
    (r) =>
      (r.wrong_target_actions ?? 0) > 0 ||
      ["SEMANTIC_AMBIGUITY", "UNDER_EXPANSION", "DECISION_ERROR"].includes(
        r.failure_type ?? "",
      ),
  );
  const localTasksGrounded = tasks
    .filter((t) => t.preregistered?.ambiguity_class === "local")
    .every((t) => localRuns.some((r) => r.task_id === t.id && r.grounding_success));
  const localStatus =
    local?.interval[0] > 0
      ? "Not replicated"
      : !localSemanticFailures && localTasksGrounded
        ? "Replicated"
        : "Inconclusive";
  const reliabilityStatus =
    wrong(runs) === 0 && rel?.difference >= 0 ? "Replicated" : "Inconclusive";
  const localCostStatus =
    localTokens?.interval[1] < 0
      ? "Replicated"
      : localTokens?.interval[0] > 0
        ? "Not replicated"
        : "Inconclusive";
  const structuralCostStatus =
    structuralTokens?.interval[1] < 0
      ? "Partially replicated"
      : structuralTokens?.interval[0] > 0
        ? "Not replicated"
        : "Inconclusive";
  const claims = [
    [
      structuralStatus,
      "Structural context improves grounding over Local on the structural-ambiguity tasks.",
      `${textEffect(structural, 100)} pp`,
    ],
    [
      localStatus,
      "Local context is sufficient on the locally distinguishable tasks.",
      `Local ${rate(runs, "indexed-local", "local")}; Structural ${rate(runs, "indexed-structural", "local")}; paired gap ${textEffect(local, 100)} pp. Requires qualitative task-level interpretation; no absolute sufficiency threshold invented.`,
    ],
    [
      effects["overall/indexed-structural/initial_representation_tokens"]?.interval[1] <
      0
        ? "Replicated"
        : "Inconclusive",
      "Adaptive reduces initial representation cost relative to Structural.",
      `${reprSaving.toFixed(1)}% reduction`,
    ],
    [
      reliabilityStatus,
      "Adaptive preserves descriptively Structural-like grounding reliability.",
      `${textEffect(rel, 100)} pp; ${wrong(runs)} wrong executed inputs; descriptive only, no non-inferiority.`,
    ],
    [
      localCostStatus,
      "Adaptive reduces total inference tokens relative to Local.",
      `${textEffect(localTokens)} tokens/task`,
    ],
    [
      structuralCostStatus,
      "Adaptive reduces total inference tokens relative to Structural.",
      `${textEffect(
        structuralTokens,
      )} tokens/task; parent claim was unresolved, so new evidence does not retroactively establish cross-model savings.`,
    ],
  ];
  const cross = [
    "# Cross-Model Summary",
    "",
    "Two separately frozen cohorts; no pooled estimates. Parent glm-5.3-flash; replication deepseek-v4.1-flash. Same twelve synthetic tasks and method.",
    "",
    "| Finding | glm-5.3-flash | deepseek-v4.1-flash | Replication status |",
    "|---|---|---|---|",
  ];
  cross.push(
    `| Structural > Local on structural ambiguity | Structural ${rate(parentRuns, "indexed-structural", "structural")}; Local ${rate(parentRuns, "indexed-local", "structural")} | Structural ${rate(runs, "indexed-structural", "structural")}; Local ${rate(runs, "indexed-local", "structural")} | ${structuralStatus} |`,
  );
  cross.push(
    `| Local sufficient on local ambiguity | ${rate(parentRuns, "indexed-local", "local")} | ${rate(runs, "indexed-local", "local")} | ${localStatus}; assess per-task evidence |`,
  );
  cross.push(
    `| Adaptive zero/low wrong-target inputs | ${wrong(parentRuns)} | ${wrong(runs)} | ${wrong(runs) === 0 ? "Replicated (observed zero only)" : "Requires qualitative failure analysis"} |`,
  );
  cross.push(
    `| Adaptive initial representation cost < Structural | ${parent.post_cohort_interpretation.initial_representation_savings_percent_vs_structural.toFixed(1)}% less | ${reprSaving.toFixed(1)}% less | ${claims[2]![0]} |`,
  );
  cross.push(
    `| Adaptive total tokens < Local | ${meanTokens(parentRuns, "indexed-adaptive")?.toFixed(0)} vs ${meanTokens(parentRuns, "indexed-local")?.toFixed(0)} | ${meanTokens(runs, "indexed-adaptive")?.toFixed(0) ?? "unknown"} vs ${meanTokens(runs, "indexed-local")?.toFixed(0) ?? "unknown"} | ${localCostStatus} |`,
  );
  cross.push(
    `| Adaptive total tokens < Structural | ${meanTokens(parentRuns, "indexed-adaptive")?.toFixed(0)} vs ${meanTokens(parentRuns, "indexed-structural")?.toFixed(0)}; unresolved | ${meanTokens(runs, "indexed-adaptive")?.toFixed(0) ?? "unknown"} vs ${meanTokens(runs, "indexed-structural")?.toFixed(0) ?? "unknown"} | ${structuralCostStatus}; cross-model savings unsupported |`,
  );
  cross.push(
    "",
    "## Effect directions and magnitudes",
    "",
    "Difference [95% task-cluster CI]. Each model analyzed independently.",
    "",
    "| Contrast | GLM | DeepSeek |",
    "|---|---|---|",
  );
  for (const [label, key, scale] of [
    [
      "Structural − Local grounding (structural), pp",
      "structural/structural-minus-local/grounding",
      100,
    ],
    [
      "Adaptive − Structural grounding, pp",
      "overall/indexed-structural/grounding",
      100,
    ],
    ["Adaptive − Local total tokens/task", "overall/indexed-local/total_tokens", 1],
    [
      "Adaptive − Structural total tokens/task",
      "overall/indexed-structural/total_tokens",
      1,
    ],
  ] as const)
    cross.push(
      `| ${label} | ${textEffect(parent.effects[key], scale)} | ${textEffect(effects[key], scale)} |`,
    );
  const oldCounts = failureCounts(parentRuns);
  const newCounts = failureCounts(runs);
  const taxonomy = [
    "SEMANTIC_AMBIGUITY",
    "UNDER_EXPANSION",
    "OVER_EXPANSION",
    "MODEL_OUTPUT_ERROR",
    "DECISION_ERROR",
    "INVALID_ACTION",
    "EXECUTION_ERROR",
    "BUDGET_EXCEEDED",
    "PROVIDER_TIMEOUT",
    "PROVIDER_HTTP_ERROR",
    "ENDPOINT_FAILURE",
    "UNKNOWN",
  ];
  const failureTable = [
    "| Primary failure label | GLM / 240 | DeepSeek / 240 |",
    "|---|---|---|",
    ...taxonomy.map((k) => `| ${k} | ${oldCounts[k] ?? 0} | ${newCounts[k] ?? 0} |`),
  ];
  cross.push(
    "",
    "## Failure distribution",
    "",
    ...failureTable,
    "",
    "OVER_EXPANSION and UNDER_EXPANSION are also independent policy labels; do not interpret zero primary counts as zero policy events.",
    `Initial Adaptive expansion labels: GLM over ${parent.policy.over}/60, under ${parent.policy.under}/60; DeepSeek over ${analysis.policy.over}/60, under ${analysis.policy.under}/60.`,
    "",
    `Strict-only failures after correct grounding: GLM ${parentRuns.filter((r) => r.grounding_success && !r.strict_task_success).length}; DeepSeek ${runs.filter((r) => r.grounding_success && !r.strict_task_success).length}. Full reasoning-budget missing-content cases: GLM ${parent.post_cohort_interpretation.missing_content_at_full_reasoning_budget}; DeepSeek ${diagnostics.filter((d: any) => d.reasoning_consumed_entire_output_budget && !d.final_content_emitted).length}; unknown reasoning attribution ${diagnostics.filter((d: any) => d.full_output_budget && d.reasoning_tokens === null).length}.`,
    "",
    DEFERRED,
    "",
    "Cross-model conclusions remain confined to these shared authored fixtures, provider, prompt and executor. Effective sampling and reasoning defaults can differ by model. External/open-web validity and universal necessity are unsupported.",
  );
  let markdown = generated.markdown.replaceAll(
    "paper-confirmatory-v1-analysis.json",
    `${ID}-analysis.json`,
  );
  const rqStart = markdown.indexOf("## RQ1");
  const threatStart = markdown.indexOf("## Threats to Validity");
  const threatEnd = markdown.indexOf("## Confirmatory Conclusions");
  const rqBody = markdown.slice(rqStart, threatStart);
  const threats = markdown
    .slice(threatStart, threatEnd)
    .replace("one model, one provider", "one replication model, one provider")
    .replace(
      "No open-web, external benchmark, second-model or universal-superiority inference.",
      "No open-web, external benchmark or universal-superiority inference; two-model evidence uses the same synthetic tasks.",
    );
  const intro = [
    "# Second-Model Replication",
    "",
    "## 1. Replication Protocol",
    "",
    `COMPLETE AND AUDITED: ${runs.length}/240 unique planned terminal summaries. Parent paper-confirmatory-v1; independent cross-model replication using ${frozen.controls.cohort.model}, OpenCode Go.`,
    "",
    `Same 12 tasks, five repeats, four variants; matching Node/Chrome/viewport/fixtures/prompts/method and budgets. Frozen ${frozen.frozen_at}. ${DEFERRED}`,
    "",
    "Matched task-repeat analysis reuses the parent functions: task averages, seed1735, 2000-draw cluster bootstrap and 95% percentile CIs, independently by task stratum. Selector reference has extra DOM and is not an equivalent causal arm.",
    "",
    `Model configuration: ${JSON.stringify(frozen.controls.model_settings)}`,
    "",
    "## 2. Control-Diff Audit",
    "",
    `Protected files ${audit.historical.checked}; changed ${audit.historical.changed.length}. Parent method source hash ${frozen.controls.source_hash}; separate orchestration hash ${frozen.controls.replication_source_hash}. Task/fixture/source/prompt/policy/config/archive hashes verified. No unexpected control drift.`,
    "",
    `${JSON.stringify(frozen.controls.control_diff)}`,
    "",
    `Frozen qualitative criteria: ${JSON.stringify(frozen.controls.qualitative_criteria)}`,
    "",
    `Passive response record coverage: ${responses.length}/${sum(
      runs.map((r) => r.llm_calls),
    )} actual HTTP attempts. Potential small host/latency overhead is disclosed; no method changes.`,
    "",
  ];
  markdown =
    intro.join("\n") +
    rqBody
      .replace("## RQ1", "## 3. RQ1")
      .replace("## RQ2", "## 4. RQ2")
      .replace("## RQ3", "## 5. RQ3")
      .replace("## Failure Analysis", "## 6. Failure Analysis");
  markdown += [
    "",
    "### Output-Budget Diagnostic",
    "",
    `Every failed step is indexed in ${ID}-failure-diagnostics.json and its full provider response in the separate response log. ${diagnostics.filter((d: any) => d.reasoning_consumed_entire_output_budget).length} responses demonstrably consumed the full budget as reasoning; ${diagnostics.filter((d: any) => d.full_output_budget && d.reasoning_tokens === null).length} full-budget responses lack a reasoning-token split (unknown, not asserted zero). No max_tokens increase or failure rerun.`,
    "",
    ...failureTable,
    "",
    "## 7. Cross-Model Comparison",
    "",
    ...cross.slice(4),
    "",
    "## 8. Replication Status",
    "",
    `Structural class contrast: ${structuralStatus}. Adaptive descriptive grounding: ${reliabilityStatus}; representation saving ${reprSaving.toFixed(1)}%. Total usage versus Local: ${localCostStatus}; versus Structural: ${structuralCostStatus}. Local sufficiency requires qualitative per-task interpretation; rates and matched effects are above. No non-inferiority claim.`,
    "",
    "## 9. Threats to Validity",
    "",
    threats.replace("## Threats to Validity\n\n", ""),
    "",
    "Additional cross-model limitation: same tasks/fixtures/provider/prompt make this a model replication, not an independent benchmark/task replication. Provider defaults and unexposed effective sampling differ; two models do not establish universal generalization. No automatic source tuning or additional trials. Any suggested improvements are future method revisions.",
    "",
    "## 10. Claim Ledger",
    "",
    "| Status | Claim | Evidence / limit |",
    "|---|---|---|",
    ...claims.map((c) => `| ${c[0]} | ${c[1]} | ${c[2]} |`),
    "",
    "Statistical non-inferiority/equivalence, universally required structural context, universal zero error, total savings over Structural across models, monetary savings and external/open-web validity remain unsupported.",
    "",
  ].join("\n");
  analysis.cross_model = {
    effects_parent: parent.effects,
    claims,
    primary_failure_counts: { parent: oldCounts, replication: newCounts },
    initial_representation_savings_percent: reprSaving,
  };
  analysis.response_diagnostics = diagnostics;
  analysis.raw_result_sha256 = await fileHash(`evals/results/${ID}.jsonl`);
  analysis.response_log_sha256 = await fileHash(`evals/results/${ID}-responses.jsonl`);
  await writeFile(`${ROOT}.md`, markdown);
  await writeFile(`${ROOT}-analysis.json`, `${JSON.stringify(analysis, null, 2)}\n`);
  await writeFile(
    `${ROOT}-failure-diagnostics.json`,
    `${JSON.stringify(diagnostics, null, 2)}\n`,
  );
  await writeFile(`${ROOT}-integrity.json`, `${JSON.stringify(audit, null, 2)}\n`);
  await writeFile("evals/reports/cross-model-summary.md", `${cross.join("\n")}\n`);
  const historical = await auditHistorical();
  if (historical.changed.length)
    throw new Error("Historical evidence changed during reporting.");
  console.log(
    JSON.stringify(
      { audit, claims, failures: newCounts, representation_saving_percent: reprSaving },
      null,
      2,
    ),
  );
}
// Importing diagnostic helpers in tests must not write reports or make browser calls.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
