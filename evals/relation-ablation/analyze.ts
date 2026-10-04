import type { ExperimentRecord, ExperimentTask } from "./schema.ts";
import { Buffer } from "node:buffer";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { clusterInterval, mean } from "../runners/statistics.ts";
import {
  experimentRecordSchema,
  parseExperimentTasks,
  RELATION_DESIGN_VERSION,
} from "./schema.ts";

export const DESIGN = RELATION_DESIGN_VERSION;

/** Arms in the frozen plan, in report order. */
export const ARMS = [
  "indexed-local",
  "indexed-unbound",
  "indexed-bound",
  "indexed-structural",
] as const;

export interface ArmFile {
  arm: string;
  path: string;
}

/** Task design lookup; the condition and family are never inferred from goal wording. */
export type TaskDesign = Map<string, ExperimentTask["design"]>;

export async function loadTasks(path: string): Promise<TaskDesign> {
  const tasks = parseExperimentTasks(JSON.parse(await readFile(path, "utf8")));
  return new Map(tasks.map((task) => [task.id, task.design]));
}

/**
 * Reads one model's cell files. The arm is part of the file name and re-checked against
 * every record, so a mislabelled file cannot silently change the analysis.
 */
export async function loadRecords(
  directory: string,
  model: string,
): Promise<{ records: ExperimentRecord[]; files: ArmFile[] }> {
  const entries = await readdir(directory).catch(() => [] as string[]);
  const marker = `-${model}-`;
  const files = entries
    .filter((name) => name.includes(marker) && name.endsWith(".jsonl"))
    .sort()
    .map((name) => ({
      arm: name.slice(name.indexOf(marker) + marker.length).replace(/\.jsonl$/, ""),
      path: `${directory}/${name}`,
    }));
  const records: ExperimentRecord[] = [];
  for (const file of files) {
    const text = await readFile(file.path, "utf8");
    for (const [index, line] of text.split("\n").entries()) {
      if (!line.trim()) continue;
      let parsed: ExperimentRecord;
      try {
        parsed = experimentRecordSchema.parse(JSON.parse(line));
      } catch (error) {
        throw new Error(
          `${file.path}:${index + 1} is not a schema-v4 relation-ablation record: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      if (parsed.model !== model)
        throw new Error(
          `${file.path}:${index + 1} model differs from the requested report.`,
        );
      if (parsed.arm !== file.arm)
        throw new Error(
          `${file.path}:${index + 1} records arm ${parsed.arm}, file says ${file.arm}`,
        );
      records.push(parsed);
    }
  }
  const duplicates = records
    .map((record) => `${record.task_id}/${record.arm}`)
    .filter((key, index, all) => all.indexOf(key) !== index);
  if (duplicates.length)
    throw new Error(`Duplicate cells: ${[...new Set(duplicates)].join(", ")}`);
  return { records, files };
}

export interface Contrast {
  label: string;
  treatment: string;
  control: string;
  condition: "all" | "local" | "group";
  /** Page-level treatment-minus-control differences. */
  pages: { page: string; family: string; difference: number }[];
  mean: number;
  ci95: [number, number];
  clusters: number;
}

/**
 * Paired contrast at the page level: the three position states of a page are averaged
 * before the difference, so position states are never counted as independent samples, and
 * the page (within its family) is the clustering unit for the interval.
 */
export function contrast(
  records: ExperimentRecord[],
  design: TaskDesign,
  treatment: string,
  control: string,
  condition: "all" | "local" | "group",
  endpoint: (record: ExperimentRecord) => number,
): Contrast | null {
  const lookup = new Map(
    records.map((record) => [`${record.task_id}/${record.arm}`, record]),
  );
  const pages = new Map<
    string,
    { family: string; treatment: number[]; control: number[] }
  >();
  for (const record of records) {
    if (record.arm !== treatment) continue;
    const row = design.get(record.task_id);
    if (row === undefined)
      throw new Error(`Task ${record.task_id} missing from the design table.`);
    if (condition !== "all" && row.condition !== condition) continue;
    const other = lookup.get(`${record.task_id}/${control}`);
    if (!other) continue;
    const entry = pages.get(row.page) ?? {
      family: row.family,
      treatment: [],
      control: [],
    };
    entry.treatment.push(endpoint(record));
    entry.control.push(endpoint(other));
    pages.set(row.page, entry);
  }
  const rows: Contrast["pages"] = [];
  for (const [page, entry] of [...pages].sort())
    if (entry.treatment.length && entry.control.length)
      rows.push({
        page,
        family: entry.family,
        difference: mean(entry.treatment) - mean(entry.control),
      });
  if (rows.length === 0) return null;
  return {
    label: `${treatment} − ${control} (${condition})`,
    treatment,
    control,
    condition,
    pages: rows,
    mean: mean(rows.map((row) => row.difference)),
    ci95: clusterInterval(rows.map((row) => row.difference)),
    clusters: rows.length,
  };
}

/** Secondary goal-condition interaction with the same page as its clustering unit. */
export function goalInteraction(
  group: Contrast | null,
  local: Contrast | null,
): Contrast | null {
  if (!group || !local) return null;
  const localByPage = new Map(local.pages.map((row) => [row.page, row.difference]));
  const pages = group.pages
    .filter((row) => localByPage.has(row.page))
    .map((row) => ({
      ...row,
      difference: row.difference - localByPage.get(row.page)!,
    }));
  if (!pages.length) return null;
  return {
    ...group,
    label: `${group.treatment} − ${group.control} (group − local interaction)`,
    pages,
    condition: "all",
    mean: mean(pages.map((row) => row.difference)),
    ci95: clusterInterval(pages.map((row) => row.difference)),
    clusters: pages.length,
  };
}

export interface Summary {
  arm: string;
  cells: number;
  grounding: string;
  strict: string;
  success: string;
  wrongRuns: string;
  inputTokens: number | null;
  latencyMean: number;
  payloadCharsMean: number | null;
  statusCounts: Record<string, number>;
}

export function summarize(records: ExperimentRecord[]): Summary[] {
  return ARMS.map((arm) => {
    const cells = records.filter((record) => record.arm === arm);
    const rate = (endpoint: (record: ExperimentRecord) => boolean): string =>
      cells.length ? `${cells.filter(endpoint).length}/${cells.length}` : "0/0";
    const tokens = cells.map((record) => record.input_tokens);
    const payloadChars = cells
      .map((record) => record.first_payload_chars)
      .filter((value): value is number => value !== null);
    const statusCounts: Record<string, number> = {};
    for (const record of cells)
      statusCounts[record.status] = (statusCounts[record.status] ?? 0) + 1;
    return {
      arm,
      cells: cells.length,
      grounding: rate((record) => record.grounding_success),
      strict: rate((record) => record.strict_task_success),
      success: rate((record) => record.success),
      wrongRuns: rate((record) => (record.wrong_targets ?? 0) > 0),
      inputTokens:
        cells.length && tokens.every((value): value is number => value !== null)
          ? tokens.reduce((total, value) => total + value, 0)
          : null,
      latencyMean: cells.length ? mean(cells.map((record) => record.latency_ms)) : 0,
      payloadCharsMean: payloadChars.length ? mean(payloadChars) : null,
      statusCounts,
    };
  });
}

export interface Coverage {
  cells: number;
  expected: number;
  incomplete: string[];
  scoredCoverage: string;
  decisionFailures: number;
  providerFailures: number;
  noAttempt: number;
  browserVersions: string[];
  returnedModels: string[];
  sourceHashes: string[];
  firstPayloadMissing: number;
  wrongTargetInputs: string;
}

/** Coverage and validity report; the planned endpoint is never filtered by these fields. */
export function coverage(
  records: ExperimentRecord[],
  expected: number,
  design?: TaskDesign,
): Coverage {
  const all = records.length;
  const wrongInputs = records.reduce(
    (total, record) => total + (record.wrong_targets ?? 0),
    0,
  );
  return {
    cells: all,
    expected: expected || all,
    incomplete: design
      ? [...design.keys()].flatMap((task) =>
          ARMS.filter(
            (arm) =>
              !records.some((record) => record.task_id === task && record.arm === arm),
          ).map((arm) => `${task}/${arm}`),
        )
      : [],
    scoredCoverage: `${records.filter((record) => record.trace.some((step) => step.executed && ["correct", "wrong"].includes(step.assessment ?? ""))).length}/${all}`,
    decisionFailures: records.filter((record) => record.failure_stage === "decision")
      .length,
    providerFailures: records.filter((record) => record.failure_stage === "provider")
      .length,
    noAttempt: records.filter(
      (record) =>
        !record.trace.some(
          (step) =>
            step.executed && ["correct", "wrong"].includes(step.assessment ?? ""),
        ),
    ).length,
    browserVersions: [
      ...new Set(records.map((record) => record.metadata.browser_version ?? "unknown")),
    ],
    returnedModels: [...new Set(records.flatMap((record) => record.returned_models))],
    sourceHashes: [...new Set(records.map((record) => record.metadata.source_hash))],
    firstPayloadMissing: records.filter((record) => record.first_payload === null)
      .length,
    wrongTargetInputs: `${wrongInputs}/${records.reduce((total, record) => total + record.trace.filter((step) => step.executed && ["correct", "wrong"].includes(step.assessment ?? "")).length, 0)} scored executed inputs`,
  };
}

function contrastRows(contrasts: (Contrast | null)[]): string {
  return contrasts
    .filter((value): value is Contrast => value !== null)
    .map(
      (value) =>
        `| ${value.label} | ${(value.mean * 100).toFixed(1)} pp | [${(value.ci95[0] * 100).toFixed(1)}, ${(value.ci95[1] * 100).toFixed(1)}] pp | ${value.clusters} |`,
    )
    .join("\n");
}

/** Leave-one-family-out sensitivity for one contrast. */
export function leaveOneFamilyOut(value: Contrast): { family: string; mean: number }[] {
  const families = [...new Set(value.pages.map((row) => row.family))].sort();
  return families.map((family) => ({
    family,
    mean: mean(
      value.pages.filter((row) => row.family !== family).map((row) => row.difference),
    ),
  }));
}

export function report(options: {
  model: string;
  records: ExperimentRecord[];
  design: TaskDesign;
  expected: number;
}): string {
  const { model, records, design, expected } = options;
  const summaries = summarize(records);
  const cover = coverage(records, expected, design);
  const grounding = (record: ExperimentRecord): number =>
    record.grounding_success ? 1 : 0;
  const strict = (record: ExperimentRecord): number =>
    record.strict_task_success ? 1 : 0;
  const primary = contrast(
    records,
    design,
    "indexed-bound",
    "indexed-unbound",
    "group",
    grounding,
  );
  const primaryAll = contrast(
    records,
    design,
    "indexed-bound",
    "indexed-unbound",
    "all",
    grounding,
  );
  const localCheck = contrast(
    records,
    design,
    "indexed-bound",
    "indexed-unbound",
    "local",
    grounding,
  );
  const boundary = contrast(
    records,
    design,
    "indexed-bound",
    "indexed-structural",
    "all",
    grounding,
  );
  const scope = contrast(
    records,
    design,
    "indexed-structural",
    "indexed-local",
    "all",
    grounding,
  );
  const strictPrimary = contrast(
    records,
    design,
    "indexed-bound",
    "indexed-unbound",
    "group",
    strict,
  );
  const family = new Map<string, number[]>();
  for (const row of primary?.pages ?? [])
    family.set(row.family, [...(family.get(row.family) ?? []), row.difference]);
  return [
    `# Relation ablation v1 — derived report (${model})`,
    "",
    `Design ${DESIGN}. Generated by \`evals/relation-ablation/analyze.ts\` from the schema-v4`,
    "cell records and the frozen task design table; no record is re-scored or rewritten.",
    "",
    `- cells: ${cover.cells}/${cover.expected}`,
    `- browser: ${cover.browserVersions.join(", ") || "unknown"}`,
    `- returned models: ${cover.returnedModels.join(", ") || "unknown"}`,
    `- source hashes: ${cover.sourceHashes.length === 1 ? `${cover.sourceHashes[0]!.slice(0, 12)}…` : `${cover.sourceHashes.length} distinct`}`,
    `- scored-attempt coverage: ${cover.scoredCoverage}; no-attempt cells: ${cover.noAttempt}`,
    `- decision-stage failures: ${cover.decisionFailures}; provider failures: ${cover.providerFailures}`,
    `- cells with a first payload recorded: ${cover.cells - cover.firstPayloadMissing}/${cover.cells}`,
    `- wrong target inputs: ${cover.wrongTargetInputs}`,
    "",
    "## Arm summary (all cells, no filtering)",
    "",
    "| arm | cells | grounding | strict | success | runs with ≥1 wrong input | mean latency ms | mean first payload chars | input tokens |",
    "|---|---|---|---|---|---|---|---|---|",
    ...summaries.map(
      (summary) =>
        `| ${summary.arm} | ${summary.cells} | ${summary.grounding} | ${summary.strict} | ${summary.success} | ${summary.wrongRuns} | ${summary.latencyMean.toFixed(0)} | ${summary.payloadCharsMean === null ? "n/a" : summary.payloadCharsMean.toFixed(0)} | ${summary.inputTokens ?? "incomplete"} |`,
    ),
    "",
    "## Primary contrast",
    "",
    "| contrast | mean difference | 95% page-cluster CI | pages |",
    "|---|---|---|---|",
    contrastRows([
      primary,
      strictPrimary,
      primaryAll,
      localCheck,
      goalInteraction(primary, localCheck),
      boundary,
      scope,
    ]),
    "",
    "Positive means the treatment arm grounded more often. The primary contrast is",
    "`indexed-bound − indexed-unbound` on the group-required goals; the interval resamples",
    "matched base pages after averaging paired position states; cluster counts are shown above,",
    "seed 1735. The complete plan has eight pages per contrast,",
    "2000 draws. Position states are never counted as independent samples.",
    "",
    "## Per-family primary differences (pp)",
    "",
    "| family | pages | mean | leave-one-family-out mean |",
    "|---|---|---|---|",
    ...(primary
      ? leaveOneFamilyOut(primary).map(
          (row) =>
            `| ${row.family} | ${family.get(row.family)?.length ?? 0} | ${(mean(family.get(row.family) ?? []) * 100).toFixed(1)} | ${(row.mean * 100).toFixed(1)} |`,
        )
      : ["| n/a | 0 | n/a | n/a |"]),
    "",
    "The leave-one-family-out column drops that family from the page-level contrast. A sign",
    "flip on any single family is reported as unstable rather than as a result.",
    "",
    "## Status counts",
    "",
    "| arm | status counts |",
    "|---|---|",
    ...summaries.map(
      (summary) =>
        `| ${summary.arm} | ${Object.entries(summary.statusCounts)
          .map(([status, count]) => `${status}:${count}`)
          .join(", ")} |`,
    ),
    "",
    "## Incomplete cells",
    "",
    cover.incomplete.length
      ? cover.incomplete.map((cell) => `- ${cell}`).join("\n")
      : "None. Completed failed runs are outcomes, not missing cells.",
    "",
    "Partial matched contrasts are diagnostic; no incomplete block supports a confirmatory claim.",
    "## Residual confound",
    "",
    "R and U expose identical group-name occurrences and equal UTF-8 target-map sizes.",
    "Only the belongs_to references change. Equal bytes do not prove equal tokenizer cost;",
    "provider input receipts are reported separately. Reference syntax remains part of the treatment.",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg, index) => index !== 0 || arg !== "--"),
    options: {
      directory: { type: "string", default: "evals/results/relation-ablation-v1" },
      tasks: { type: "string", default: "evals/tasks/relation-ablation-v1.json" },
      model: { type: "string" },
      out: { type: "string" },
    },
  });
  if (!values.model) throw new Error("--model is required (one model per report).");
  const design = await loadTasks(values.tasks!);
  const { records, files } = await loadRecords(values.directory!, values.model);
  if (records.length === 0)
    throw new Error(`No schema-v4 cells for ${values.model} in ${values.directory}.`);
  let expected = records.length;
  try {
    const plan = JSON.parse(
      await readFile(
        `${values.directory}/relation-ablation-v1-${values.model}-cohort-plan.json`,
        "utf8",
      ),
    ) as { expected_cells?: number };
    expected = plan.expected_cells ?? records.length;
  } catch {
    /* A partial ledger has no plan file; the report then states the observed cell count. */
  }
  const text = report({ model: values.model, records, design, expected });
  console.log(text);
  if (values.out) await writeFile(values.out, text);
  console.error(
    `\n${records.length} cells from ${files.length} arm files; ${Buffer.byteLength(text, "utf8")} report bytes.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
