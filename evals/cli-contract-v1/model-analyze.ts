import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MODELS } from "./model-input.ts";

export function clusterInterval(
  values: number[],
  seed = 20261005,
): [number, number] | null {
  if (values.length < 2) return null;
  let state = seed >>> 0;
  const samples: number[] = [];
  for (let b = 0; b < 10000; b++) {
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      sum += values[Math.floor((state / 2 ** 32) * values.length)]!;
    }
    samples.push(sum / values.length);
  }
  samples.sort((a, b) => a - b);
  return [samples[250]!, samples[9749]!];
}
const average = (values: number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;
export async function modelAnalyze(out: string): Promise<Record<string, any>> {
  const records = (await readFile(join(out, "model-records.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const plan = JSON.parse(await readFile(join(out, "model-plan.json"), "utf8"));
  const integrity = JSON.parse(
    await readFile(join(out, "model-integrity.json"), "utf8"),
  );
  const ids = new Set(records.map((row) => row.id));
  const missing = plan.jobs
    .filter((job: { id: string }) => !ids.has(job.id))
    .map((job: { id: string }) => job.id);
  const duplicate = records.length - ids.size;
  const providerErrors = records.filter((row) =>
    [
      "provider_error",
      "model_identity_unresolved",
      "infra_error",
      "not_dispatched",
    ].includes(row.status),
  );
  const complete =
    missing.length === 0 &&
    duplicate === 0 &&
    providerErrors.length === 0 &&
    integrity.method_unchanged &&
    integrity.historical_unchanged &&
    integrity.http_requests <= 192 &&
    (plan.dry_run || integrity.http_requests === plan.planned_cells);
  const table = [];
  for (const model of MODELS)
    for (const goal of ["group", "entity"])
      for (const arm of ["bound", "unbound"]) {
        const rows = records.filter(
          (row) => row.model === model && row.goal === goal && row.arm === arm,
        );
        const promptValues = rows.map(
          (row) => row.usage?.prompt_tokens ?? row.usage?.input_tokens ?? null,
        );
        const totalValues = rows.map((row) => row.usage?.total_tokens ?? null);
        const finiteMean = (values: any[]): number | null => {
          const finite = values.filter((value) => typeof value === "number");
          return finite.length ? average(finite) : null;
        };
        table.push({
          model,
          goal,
          arm,
          recorded: rows.length,
          planned: plan.planned_cells / 8,
          first_choice_correct: rows.filter((row) => row.first_choice_correct).length,
          valid_output: rows.filter((row) => row.valid_output).length,
          abstained: rows.filter((row) => row.abstained).length,
          actual_clicks: rows.reduce((sum, row) => sum + (row.actual_clicks ?? 0), 0),
          wrong_clicks: rows.reduce((sum, row) => sum + (row.wrong_clicks ?? 0), 0),
          correct_executions: rows.filter(
            (row) => row.correct_clicks === 1 && row.wrong_clicks === 0,
          ).length,
          rejected: rows.filter((row) => row.status === "rejected").length,
          status: Object.fromEntries(
            [...new Set(rows.map((row) => row.status))].map((status) => [
              status,
              rows.filter((row) => row.status === status).length,
            ]),
          ),
          prompt_tokens_known: promptValues.filter((value) => typeof value === "number")
            .length,
          mean_prompt_tokens_when_known: finiteMean(promptValues),
          total_tokens_known: totalValues.filter((value) => typeof value === "number")
            .length,
          mean_total_tokens_when_known: finiteMean(totalValues),
          payload_bytes_mean: finiteMean(rows.map((row) => row.payload_bytes)),
        });
      }
  const effects = [];
  if (complete && !plan.dry_run)
    for (const model of MODELS) {
      const perGoal: Record<string, any[]> = {};
      for (const goal of ["group", "entity"]) {
        const jobs = plan.jobs.filter(
          (job: any) => job.model === model && job.goal === goal && job.arm === "bound",
        );
        const pairs = jobs.map((job: any) => {
          const rows = records.filter(
            (row) =>
              row.page.id === job.page.id && row.goal === goal && row.model === model,
          );
          const a = rows.find((row) => row.arm === "bound")!;
          const b = rows.find((row) => row.arm === "unbound")!;
          return {
            page: job.page,
            effect: Number(a.first_choice_correct) - Number(b.first_choice_correct),
          };
        });
        const clusters = [
          ...new Set(
            pairs.map((pair: any) => `${pair.page.family}:${pair.page.skeleton}`),
          ),
        ].map((key) => ({
          key,
          effect: average(
            pairs
              .filter(
                (pair: any) => `${pair.page.family}:${pair.page.skeleton}` === key,
              )
              .map((pair: any) => pair.effect),
          ),
        }));
        const family = [...new Set(pairs.map((pair: any) => pair.page.family))].map(
          (name) => ({
            name,
            effect: average(
              pairs
                .filter((pair: any) => pair.page.family === name)
                .map((pair: any) => pair.effect),
            ),
          }),
        );
        perGoal[goal] = clusters;
        effects.push({
          model,
          goal,
          paired_states: pairs.length,
          paired_difference: average(pairs.map((pair: any) => pair.effect)),
          base_page_clusters: clusters,
          base_page_bootstrap_95: clusterInterval(
            clusters.map((cluster) => cluster.effect),
          ),
          family,
          family_bootstrap_95: clusterInterval(family.map((cluster) => cluster.effect)),
          leave_one_family_out: family.map((entry) => ({
            omitted: entry.name,
            effect: average(
              pairs
                .filter((pair: any) => pair.page.family !== entry.name)
                .map((pair: any) => pair.effect),
            ),
          })),
        });
      }
      const interaction = perGoal.group!.map(
        (group) =>
          group.effect -
          perGoal.entity!.find((entity) => entity.key === group.key)!.effect,
      );
      effects.push({
        model,
        goal: "group-minus-entity interaction",
        paired_difference: average(interaction),
        base_page_bootstrap_95: clusterInterval(interaction),
      });
    }
  const receiptMismatch = records.filter(
    (row) =>
      (row.receipt?.outcome === "executed" && row.actual_clicks !== 1) ||
      (row.receipt?.outcome === "not_executed" && row.actual_clicks !== 0),
  );
  const summary = {
    study: "cli-binding-v1",
    dry_run: plan.dry_run,
    complete,
    planned: plan.planned_cells,
    recorded: records.length,
    missing,
    duplicate,
    http_requests: integrity.http_requests,
    http_retries: 0,
    provider_errors: providerErrors.map((row) => ({
      id: row.id,
      model: row.model,
      status: row.status,
      http_status: row.http_status,
    })),
    receipt_oracle_mismatch: receiptMismatch.length,
    table,
    effects,
    interpretation: plan.dry_run
      ? "Mock instrument checks only; no model inference"
      : "First choice and single execution under a minimal external CLI caller; no strict agent completion",
  };
  await writeFile(
    join(out, "model-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    { flag: "wx" },
  );
  const lines = [
    "# CLI binding v1: model results",
    "",
    summary.interpretation,
    "",
    `Complete: ${complete}; recorded ${records.length}/${plan.planned_cells}; actual HTTP requests ${integrity.http_requests}; retries 0.`,
    "",
    "| model | goal | arm | recorded | first correct | valid | abstain | correct input | wrong input | prompt tokens known | mean prompt tokens |",
    "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...table.map(
      (row) =>
        `| ${row.model} | ${row.goal} | ${row.arm} | ${row.recorded} | ${row.first_choice_correct} | ${row.valid_output} | ${row.abstained} | ${row.correct_executions} | ${row.wrong_clicks} | ${row.prompt_tokens_known} | ${row.mean_prompt_tokens_when_known?.toFixed(1) ?? "unknown"} |`,
    ),
    "",
    "## Paired effects",
    "",
    ...effects.map(
      (effect) =>
        `- ${effect.model}/${effect.goal}: ${(effect.paired_difference * 100).toFixed(1)} pp; base-page bootstrap diagnostic ${JSON.stringify(effect.base_page_bootstrap_95)}; family diagnostic ${JSON.stringify(effect.family_bootstrap_95 ?? null)}.`,
    ),
    "",
    "Constructed templates, one trial per condition and incidental UUID variation limit inference. The bootstrap diagnostics do not establish population generalization or non-inferiority. Usage values come from the provider; absent values remain unknown. See JSON for family sensitivity, errors and missing cells.",
    "",
  ];
  await writeFile(join(out, "model-results.md"), lines.join("\n"), { flag: "wx" });
  return summary;
}
