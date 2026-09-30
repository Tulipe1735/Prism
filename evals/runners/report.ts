import type { ResultRecord, StepRecord, SummaryRecord } from "../schema.ts";
import { readFile } from "node:fs/promises";
import { resultSchema } from "../schema.ts";
import { clusterInterval, mean, taskRates, variability, wilson } from "./statistics.ts";

export async function loadRecords(paths: string[]): Promise<ResultRecord[]> {
  const records: ResultRecord[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const lines = (await readFile(path, "utf8")).split("\n");
    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue;
      let record;
      try {
        record = resultSchema.parse(JSON.parse(line));
      } catch (error) {
        throw new Error(`${path}:${index + 1}: invalid evaluation record`, {
          cause: error,
        });
      }
      const key = `${record.run_id}/${record.record_type}/${record.record_type === "step" ? record.step : "summary"}`;
      if (seen.has(key))
        throw new Error(
          `Duplicate run ${record.run_id}; do not load overlapping result files.`,
        );
      seen.add(key);
      records.push(record);
    }
  }
  if (!records.some((r) => r.record_type === "summary"))
    throw new Error("No completed task summaries in result files.");
  return records;
}
export async function loadResults(paths: string[]): Promise<SummaryRecord[]> {
  return (await loadRecords(paths)).filter((r) => r.record_type === "summary");
}
const rate = (n: number, d: number): string =>
  d ? `${((100 * n) / d).toFixed(1)}% (${n}/${d})` : "n/a";
const interval = (ci: [number, number]): string =>
  `${(100 * ci[0]).toFixed(1)}–${(100 * ci[1]).toFixed(1)}%`;
const avg = (v: number[]): string => (v.length ? mean(v).toFixed(2) : "n/a");
const escape = (s: string): string => s.replaceAll("|", "\\|").replaceAll("\n", " ");

export function generateReport(summaries: SummaryRecord[]): string {
  const groups = new Map<string, SummaryRecord[]>();
  for (const r of summaries) {
    const key = r.experiment_id;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const lines = [
    "# Prism evaluation summary",
    "",
    "Pilot, main, smoke and scripted experiments are reported separately. These local tasks measure this fixed policy and benchmark; they do not establish general browser-agent performance.",
    "",
  ];
  for (const [id, runs] of groups) {
    const first = runs[0]!;
    lines.push(
      `## ${first.metadata.cohort?.id ?? first.provider}: ${id}`,
      "",
      `Model: \`${first.metadata.model}\`; temperature: ${first.metadata.cohort?.temperature ?? "n/a"}; browser: \`${first.metadata.browser_version}\`; viewport: 1120 × 780; max steps: ${first.metadata.max_steps}.`,
      "",
      `Source: \`${first.metadata.source_hash}\`. Fixtures: \`${first.metadata.fixture_hash}\`. System prompt: \`${first.metadata.system_prompt_hash}\`. Cohort: \`${first.metadata.cohort_hash}\`.`,
      "",
    );
    const controls = new Set(
      runs.map((r) =>
        JSON.stringify([
          r.metadata.model,
          r.metadata.text_model,
          r.metadata.returned_models.filter((m) => m !== r.metadata.model),
          r.metadata.cohort_hash,
          r.metadata.source_hash,
          r.metadata.fixture_hash,
          r.metadata.system_prompt_hash,
          r.metadata.task_prompt_hash,
          r.metadata.browser_version,
          r.metadata.max_steps,
        ]),
      ),
    );
    const variants = [...new Set(runs.map((r) => r.variant))].sort();
    const pairs = variants.map((v) =>
      JSON.stringify(
        runs
          .filter((r) => r.variant === v)
          .map((r) => `${r.task_id}/${r.metadata.task_hash}/${r.repetition}`)
          .sort(),
      ),
    );
    const controlled = controls.size === 1 && new Set(pairs).size === 1;
    if (controls.size !== 1)
      lines.push(
        "**Controls differ: do not interpret aggregate differences as reliability effects.**",
        "",
      );
    if (new Set(pairs).size > 1)
      lines.push(
        "**Task/repetition cohorts differ between variants; differences are not a controlled ablation.**",
        "",
      );
    lines.push(
      "| Variant | Tasks | Runs | Success Rate | Task-cluster 95% CI | Per-task SD | Avg Steps | Avg Steps to Success | Retries | LLM Calls | Avg Latency (ms) |",
      "|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|",
    );
    for (const variant of variants) {
      const selected = runs.filter((r) => r.variant === variant);
      const values = [...taskRates(selected).values()];
      const sd =
        values.length > 1
          ? Math.sqrt(
              values.reduce((s, v) => s + (v - mean(values)) ** 2, 0) /
                (values.length - 1),
            )
          : 0;
      lines.push(
        `| ${variant} | ${values.length} | ${selected.length} | ${rate(selected.filter((r) => r.success).length, selected.length)} | ${interval(clusterInterval(values))} | ${(sd * 100).toFixed(1)} pp | ${avg(selected.map((r) => r.steps))} | ${avg(selected.filter((r) => r.success).map((r) => r.steps))} | ${selected.reduce((s, r) => s + r.retries, 0)} | ${selected.reduce((s, r) => s + r.llm_calls, 0)} | ${avg(selected.map((r) => r.latency_ms))} |`,
      );
    }
    lines.push(
      "",
      "| Variant | Invalid Actions | Invalid Action Rate | Invalid Outputs | Invalid Selector Rate | Wrong Target Rate | Correct Target Rate | Grounding Error Rate | Stale Detections | Stale Recovery Rate | Input / Output / Total Tokens |",
      "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    );
    for (const variant of variants) {
      const selected = runs.filter((r) => r.variant === variant);
      const sum = (key: keyof SummaryRecord): number =>
        selected.reduce(
          (s, r) => s + (typeof r[key] === "number" ? (r[key] as number) : 0),
          0,
        );
      const audited = selected.filter((r) => r.wrong_target_actions !== null);
      const wrong = audited.reduce((s, r) => s + r.wrong_target_actions!, 0);
      const tokens = ["input_tokens", "output_tokens", "total_tokens"]
        .map((key) =>
          selected.every((r) => r[key as "total_tokens"] !== null)
            ? sum(key as keyof SummaryRecord).toString()
            : "n/a",
        )
        .join(" / ");
      lines.push(
        `| ${variant} | ${sum("invalid_actions")} | ${rate(sum("invalid_actions"), sum("attempts"))} | ${sum("invalid_outputs")} | ${rate(sum("invalid_selectors"), sum("selector_attempts"))} | ${rate(
          wrong,
          audited.reduce((s, r) => s + r.grounding_observed_actions, 0),
        )} | ${rate(sum("correct_target_selections"), sum("scored_target_attempts"))} | ${rate(sum("grounding_errors"), sum("target_attempts") + sum("invalid_selectors"))} | ${sum("stale_events")} | ${rate(sum("stale_recoveries"), sum("stale_events"))} | ${tokens} |`,
      );
    }
    if (controlled && variants.includes("prism-full")) {
      lines.push(
        "",
        "### Paired success differences versus prism-full",
        "",
        "| Variant | Macro success difference | Paired task-cluster 95% CI |",
        "|---|---:|---|",
      );
      const full = taskRates(runs.filter((r) => r.variant === "prism-full"));
      for (const variant of variants.filter((v) => v !== "prism-full")) {
        const other = taskRates(runs.filter((r) => r.variant === variant));
        const diffs = [...full].map(([task, value]) => other.get(task)! - value);
        lines.push(
          `| ${variant} | ${(mean(diffs) * 100).toFixed(1)} pp | ${interval(clusterInterval(diffs))} |`,
        );
      }
    }
    lines.push(
      "",
      "### Category outcomes",
      "",
      "| Category | Variant | Success Rate |",
      "|---|---|---:|",
    );
    for (const category of [...new Set(runs.map((r) => r.category))].sort())
      for (const variant of variants) {
        const sub = runs.filter(
          (r) => r.category === category && r.variant === variant,
        );
        lines.push(
          `| ${category} | ${variant} | ${rate(sub.filter((r) => r.success).length, sub.length)} |`,
        );
      }
    lines.push(
      "",
      "### Failure distribution",
      "",
      "| Variant | Failure Type | Count |",
      "|---|---|---:|",
    );
    for (const variant of variants) {
      const counts = new Map<string, number>();
      for (const r of runs.filter((r) => r.variant === variant && !r.success))
        counts.set(
          r.failure_type ?? "UNKNOWN",
          (counts.get(r.failure_type ?? "UNKNOWN") ?? 0) + 1,
        );
      for (const [type, count] of [...counts].sort())
        lines.push(`| ${variant} | ${type} | ${count} |`);
      if (!counts.size) lines.push(`| ${variant} | None | 0 |`);
    }
    const varied = variability(runs);
    lines.push(
      "",
      "### Repeat variance",
      "",
      `${varied.filter((v) => v.successMixed).length}/${varied.length} task/variant groups have mixed success outcomes. ${varied.filter((v) => v.behaviorMixed).length}/${varied.length} vary in success, failure, steps, calls, wrong targets, validation or stale events. Temperature 0 did not guarantee identical behavior. Latency differences alone do not flag variance.`,
      "",
      "| Task | Variant | Runs | Mixed success | Mixed behavior |",
      "|---|---|---:|---|---|",
    );
    for (const v of varied.filter((v) => v.behaviorMixed))
      lines.push(
        `| ${v.task} | ${v.variant} | ${v.runs} | ${v.successMixed} | ${v.behaviorMixed} |`,
      );
    lines.push(
      "",
      "### Per-task success rates",
      "",
      "| Task | Variant | Runs | Success Rate | Wilson 95% CI |",
      "|---|---|---:|---:|---|",
    );
    for (const task of [...new Set(runs.map((r) => r.task_id))].sort())
      for (const variant of variants) {
        const sub = runs.filter((r) => r.task_id === task && r.variant === variant);
        const n = sub.filter((r) => r.success).length;
        lines.push(
          `| ${task} | ${variant} | ${sub.length} | ${rate(n, sub.length)} | ${interval(wilson(n, sub.length))} |`,
        );
      }
    lines.push("");
  }
  lines.push(
    "Confidence intervals resample tasks (2,000 draws, fixed seed) and preserve repeated runs within tasks. Per-task SD describes benchmark heterogeneity, not a standard error. Per-task Wilson intervals assume independent repeats; shared provider effects can violate that assumption. Small local convenience samples do not represent the web.",
    "",
    "Invalid Action Rate counts invalid nonterminal proposals; Invalid Outputs counts distribution/argmax failures separately. Wrong Target Rate counts executed click/fill/select actions with known fixture audits. Correct Target Rate counts scored target selections, including abandoned stale selections; neutral controls are excluded. Grounding Error Rate counts wrong scored selections and invalid selectors over mapped target attempts plus invalid selectors. Stale Recovery Rate means a later input executed at the same agent step, not that the task succeeded. Token totals are n/a if any turn lacks reported usage. LLM Calls includes actual HTTP attempts and retries. Latency includes setup and cleanup.",
    "",
    "Validation rejects structural inconsistency; it cannot reject a semantically wrong target with a valid distribution. Confidence is self-reported, not calibrated. The matched DOM supplement is supplied to all four arms. This evaluates a shared generative policy with Prism's parser/loop/executor, not the production TypeSafe model. Raw selectors resolve uniquely to eligible observed nodes before injected mutation, then use the same executor and stale guards. Richer local-context representations remain deferred.",
    "",
  );
  return lines.join("\n");
}

export function failureAnalysis(records: ResultRecord[]): string {
  const summaries = records.filter((r) => r.record_type === "summary");
  const failures = summaries.filter((r) => !r.success);
  const lines = [
    "# Prism failure analysis",
    "",
    "All failed runs remain in the JSONL results; no failure is silently retried or replaced. Categories prioritize concrete wrong-target evidence over later runtime errors.",
    "",
    "| Cohort | Task | Variant | Repeat | Failure | Run id |",
    "|---|---|---|---:|---|---|",
  ];
  for (const r of failures)
    lines.push(
      `| ${r.metadata.cohort?.id ?? r.provider} | ${r.task_id} | ${r.variant} | ${r.repetition} | ${r.failure_type ?? "UNKNOWN"} | ${r.run_id} |`,
    );
  const representatives: SummaryRecord[] = [];
  const groups = new Set<string>();
  for (const r of failures) {
    const key = `${r.metadata.cohort?.id}/${r.variant}/${r.failure_type}`;
    if (!groups.has(key)) {
      representatives.push(r);
      groups.add(key);
    }
    if (representatives.length === 10) break;
  }
  lines.push("", "## Representative traces", "");
  if (!representatives.length) lines.push("No failed runs in these inputs.", "");
  for (const r of representatives) {
    const steps = records.filter(
      (s): s is StepRecord => s.record_type === "step" && s.run_id === r.run_id,
    );
    lines.push(
      `### ${r.task_id} / ${r.variant} / repeat ${r.repetition}`,
      "",
      `Run: \`${r.run_id}\`. Cohort: ${r.metadata.cohort?.id ?? r.provider}. Failure: **${r.failure_type}**. Reason: ${escape(r.reason)}.`,
      "",
      "| Turn | Action | Target / Selector | Valid / Validation | Executed | Stale / Recovered | Confidence | Failure |",
      "|---:|---|---|---|---|---|---|---|",
    );
    for (const s of steps)
      lines.push(
        `| ${s.step} | ${s.action ?? "—"} | ${escape(s.selector ?? s.target ?? "—")} | ${s.valid} / ${s.validation_valid} | ${s.executed} | ${s.stale_events} / ${s.stale_recoveries} | ${s.confidence ?? "n/a"} | ${s.failure_type ?? "—"} |`,
      );
    const decisive =
      steps.find((s) => s.wrong_target || s.status === "failed") ?? steps.at(-1);
    if (decisive)
      lines.push(
        "",
        "Decisive turn (full surrounding evidence, raw output and prompt hash are retained in JSONL):",
        "",
        "```json",
        JSON.stringify(
          {
            goal: decisive.model_input?.goal,
            page_text: decisive.model_input?.page.text,
            targets: decisive.model_input?.targets,
            dom: decisive.model_input?.dom,
            confidence: decisive.target_confidence,
            raw_output: decisive.raw_model_output,
            error: decisive.error,
            provider_error: decisive.provider_error,
          },
          null,
          2,
        ),
        "```",
        "",
      );
  }
  return lines.join("\n");
}
