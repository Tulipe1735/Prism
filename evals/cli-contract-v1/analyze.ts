import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

export async function analyze(out: string): Promise<Record<string, any>> {
  const records = (await readFile(join(out, "records.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const plan = JSON.parse(await readFile(join(out, "plan.json"), "utf8"));
  const errors = records.filter((row) => row.kind === "error");
  const actions = records.filter((row) => row.kind === "action");
  const coverage = records.filter((row) => row.kind === "coverage");
  const transport = records.filter((row) => row.kind === "transport");
  const duplicates =
    records.length -
    new Set(
      records.map(
        (row) => `${row.kind === "error" ? row.intended : row.kind}:${row.id}`,
      ),
    ).size;
  const primary = actions.filter((row) => row.cohort === "primary");
  const truncation = actions.filter((row) => row.cohort === "truncation");
  const receiptMismatch = actions
    .concat(transport)
    .filter(
      (row) =>
        (row.receipt.outcome === "executed" && row.clicks !== 1) ||
        (row.receipt.outcome === "not_executed" && row.clicks !== 0),
    );
  const summarize = (
    rows: any[],
  ): {
    cells: number;
    acknowledged: number;
    rejected: number;
    unknown: number;
    wrong_executions: number;
    false_rejections: number;
    eligible_correct_choices: number;
    oracle_attained: number;
    codes: Record<string, number>;
  } => ({
    cells: rows.length,
    acknowledged: rows.filter((row) => row.receipt.outcome === "executed").length,
    rejected: rows.filter((row) => row.rejected).length,
    unknown: rows.filter((row) => row.receipt.outcome === "unknown").length,
    wrong_executions: rows.filter((row) => row.wrong_clicks > 0).length,
    false_rejections: rows.filter((row) => row.false_rejection).length,
    eligible_correct_choices: rows.filter(
      (row) => row.input_eligible && row.choice_currently_correct,
    ).length,
    oracle_attained: rows.filter((row) => row.oracle_attained).length,
    codes: Object.fromEntries(
      [...new Set(rows.map((row) => row.receipt.code))].map((code) => [
        code,
        rows.filter((row) => row.receipt.code === code).length,
      ]),
    ),
  });
  const table = [];
  for (const change of [...new Set(primary.map((row) => row.change))])
    for (const goal of ["group", "entity"])
      for (const gate of ["identity-only", "evidence-consistency"])
        table.push({
          change,
          goal,
          gate,
          ...summarize(
            primary.filter(
              (row) => row.change === change && row.goal === goal && row.gate === gate,
            ),
          ),
        });
  const byFamily = [];
  for (const family of [...new Set(primary.map((row) => row.page.family))])
    for (const gate of ["identity-only", "evidence-consistency"])
      byFamily.push({
        family,
        gate,
        ...summarize(
          primary.filter((row) => row.page.family === family && row.gate === gate),
        ),
      });
  const coverageTable = [];
  for (const boundary of [...new Set(coverage.map((row) => row.page.boundary))])
    for (const family of [...new Set(coverage.map((row) => row.page.family))])
      for (const scope of ["local", "structural", "relations"]) {
        const rows = coverage.filter(
          (row) =>
            row.page.boundary === boundary &&
            row.page.family === family &&
            row.scope === scope,
        );
        const fields = rows.flatMap((row) => row.fields);
        coverageTable.push({
          boundary,
          family,
          scope,
          captures: rows.length,
          candidates: fields.length,
          entity_exposed: fields.filter((entry) => entry.exposes_entity).length,
          group_exposed: fields.filter((entry) => entry.exposes_group).length,
          mean_target_fields_bytes: rows.length
            ? rows.reduce((sum, row) => sum + row.target_fields_bytes, 0) / rows.length
            : null,
        });
      }
  const parity = transport.map((row) => {
    const expected = primary.find((item) => item.id === row.id);
    const keys = [
      "clicks",
      "wrong_clicks",
      "false_rejection",
      "rejected",
      "oracle_attained",
    ];
    return {
      id: row.id,
      matched:
        !!expected &&
        keys.every((key) => row[key] === expected[key]) &&
        row.receipt.code === expected.receipt.code,
    };
  });
  const actual = {
    coverage: coverage.length,
    primary: primary.length,
    truncation: truncation.length,
    transport: transport.length,
  };
  const complete =
    Object.entries(plan.planned).every(
      ([key, count]) => actual[key as keyof typeof actual] === count,
    ) &&
    errors.length === 0 &&
    duplicates === 0 &&
    receiptMismatch.length === 0 &&
    parity.every((row) => row.matched);
  const summary = {
    study: "cli-contract-v1",
    development_smoke: plan.development_smoke,
    complete,
    planned: plan.planned,
    actual,
    errors,
    duplicates,
    receipt_oracle_mismatch: receiptMismatch.length,
    table,
    byFamily,
    coverage: coverageTable,
    truncation: ["group", "entity"].flatMap((goal) =>
      ["identity-only", "evidence-consistency"].map((gate) => ({
        goal,
        gate,
        ...summarize(
          truncation.filter((row) => row.goal === goal && row.gate === gate),
        ),
      })),
    ),
    parity,
    model_calls: 0,
    inferential_intervals: null,
  };
  await writeFile(join(out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, {
    flag: "wx",
  });
  const lines = [
    "# CLI contract v1: enumerated mechanism results",
    "",
    "No model calls. These are conditional program effects under a privileged instrument controller, not agent success rates.",
    "",
    `Complete: ${complete}. Counts: ${JSON.stringify(actual)}. Errors: ${errors.length}. Duplicate records: ${duplicates}.`,
    "",
    "## Action outcomes (primary block)",
    "",
    "| mutation | goal | gate | cells | wrong input | false refusal | eligible correct | oracle attained | codes |",
    "|---|---|---|---:|---:|---:|---:|---:|---|",
    ...table.map(
      (row) =>
        `| ${row.change} | ${row.goal} | ${row.gate} | ${row.cells} | ${row.wrong_executions} | ${row.false_rejections} | ${row.eligible_correct_choices} | ${row.oracle_attained} | ${JSON.stringify(row.codes)} |`,
    ),
    "",
    "## Displayed-field coverage",
    "",
    "Full group identity must appear in the candidate's own displayed fields. This is an exposure proxy, not proof of model identifiability.",
    "",
    "| boundary | family | scope | captures | candidates | entity exposed | full group exposed | mean target-field bytes |",
    "|---|---|---|---:|---:|---:|---:|---:|",
    ...coverageTable.map(
      (row) =>
        `| ${row.boundary} | ${row.family} | ${row.scope} | ${row.captures} | ${row.candidates} | ${row.entity_exposed} | ${row.group_exposed} | ${row.mean_target_fields_bytes?.toFixed(1) ?? "NA"} |`,
    ),
    "",
    "## Supplemental prefix boundary",
    "",
    ...summary.truncation.map(
      (row) =>
        `- ${row.goal}/${row.gate}: ${row.wrong_executions}/${row.cells} wrong inputs; ${row.false_rejections} false refusals; ${JSON.stringify(row.codes)}.`,
    ),
    "",
    "## Transport parity and limits",
    "",
    `Actual production short-process CLI matches Sessions outcomes in ${parity.filter((row) => row.matched).length}/${parity.length} cases.`,
    "",
    "Eight constructed base pages and three states do not form an independent population sample. No confidence interval or population p-value is reported. Race and truncation cases are deliberate interventions, not natural prevalence estimates. Refusal is not successful completion. UTF-8 bytes are not token or inference cost.",
    "",
  ];
  await writeFile(join(out, "results.md"), lines.join("\n"), { flag: "wx" });
  if (!complete) process.exitCode = 1;
  return summary;
}
