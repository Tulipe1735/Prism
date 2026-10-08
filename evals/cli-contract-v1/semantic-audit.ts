import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { hash } from "./runtime.ts";

/** Post-execution construct audit. Keep goals/content, remove only issued IDs and treatment values. */
export function semanticInput(record: any): string {
  const payload = JSON.parse(record.request_body.messages[1].content);
  const observation = payload.observation;
  observation.session = "issued-session";
  observation.observation = "issued-observation";
  observation.evidence = "issued-evidence";
  observation.page.url = "opaque-owned-page";
  for (const [i, target] of observation.targets.entries()) {
    target.ref = `candidate-${i + 1}`;
    target.belongs_to = "treatment-binding";
  }
  return JSON.stringify(payload);
}
async function main(): Promise<void> {
  const { values } = parseArgs({ options: { out: { type: "string" } } });
  if (!values.out)
    throw new Error("--out must point to an existing completed model block");
  const out = resolve(values.out);
  const path = join(out, "model-records.jsonl");
  const raw = await readFile(path);
  const records = raw
    .toString()
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const keys = [...new Set(records.map(semanticInput))];
  const table = [];
  for (const model of [...new Set(records.map((row) => row.model))])
    for (const goal of ["group", "entity"]) {
      const goalKeys = keys.filter((key) =>
        records.some(
          (row) =>
            row.model === model && row.goal === goal && semanticInput(row) === key,
        ),
      );
      const classes = goalKeys.map((key) => {
        const rows = records.filter(
          (row) =>
            row.model === model && row.goal === goal && semanticInput(row) === key,
        );
        const byArm = (
          arm: string,
        ): { trials: number; correct: number; abstained: number; rate: number } => {
          const cells = rows.filter((row) => row.arm === arm);
          return {
            trials: cells.length,
            correct: cells.filter((row) => row.first_choice_correct).length,
            abstained: cells.filter((row) => row.abstained).length,
            rate: cells.filter((row) => row.first_choice_correct).length / cells.length,
          };
        };
        const bound = byArm("bound");
        const unbound = byArm("unbound");
        if (!bound.trials || !unbound.trials)
          throw new Error("Semantic class lacks a paired arm");
        return {
          signature: hash(key),
          input: JSON.parse(key),
          bound,
          unbound,
          effect: bound.rate - unbound.rate,
          underlying_dom_families: [...new Set(rows.map((row) => row.page.family))],
        };
      });
      table.push({
        model,
        goal,
        semantic_conditions: classes.length,
        classes,
        macro_bound_correctness:
          classes.reduce((sum, cell) => sum + cell.bound.rate, 0) / classes.length,
        macro_unbound_correctness:
          classes.reduce((sum, cell) => sum + cell.unbound.rate, 0) / classes.length,
        macro_paired_effect:
          classes.reduce((sum, cell) => sum + cell.effect, 0) / classes.length,
      });
    }
  const usage = records.map((row) => row.usage);
  const tokenTotal = (field: string): number | null =>
    usage.every((entry) => typeof entry?.[field] === "number")
      ? usage.reduce((sum, entry) => sum + entry[field], 0)
      : null;
  const result = {
    kind: "post-hoc experimental-unit audit, not a changed hypothesis or preregistered analysis",
    source: path,
    source_sha256: hash(raw),
    requests: records.length,
    literal_prompt_hashes: new Set(records.map((row) => row.prompt_hash)).size,
    semantic_input_classes: keys.length,
    table,
    bootstrap_interpretation:
      "Do not use the original base-page/family bootstrap as population evidence: DOM differences are erased by this projection and intervals degenerate at ceiling/floor. These 18 controlled semantic conditions are not a random website sample.",
    inferential_interval: null,
    provider_usage: {
      known_receipts: usage.filter((entry) => entry !== null).length,
      prompt_tokens: tokenTotal("prompt_tokens"),
      completion_tokens: tokenTotal("completion_tokens"),
      total_tokens: tokenTotal("total_tokens"),
    },
    raw_unchanged: hash(await readFile(path)) === hash(raw),
  };
  await writeFile(
    join(out, "semantic-audit.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    { flag: "wx" },
  );
  const lines = [
    "# CLI binding v1: semantic input and statistical unit audit",
    "",
    result.kind,
    "",
    `Actual requests: ${records.length}; distinct literal prompt hashes: ${result.literal_prompt_hashes}; semantic task-input classes after removing issued IDs, opaque URLs and treatment values: ${keys.length}.`,
    "",
    "| model | goal | unique semantic conditions | macro Bound correct | macro Unbound correct | effect |",
    "|---|---|---:|---:|---:|---:|",
    ...table.map(
      (row) =>
        `| ${row.model} | ${row.goal} | ${row.semantic_conditions} | ${(row.macro_bound_correctness * 100).toFixed(1)}% | ${(row.macro_unbound_correctness * 100).toFixed(1)}% | ${(row.macro_paired_effect * 100).toFixed(1)} pp |`,
    ),
    "",
    result.bootstrap_interpretation,
    "",
    "No independent-task sample inflation, model performance extrapolation, or equivalence claim. Raw data and the original frozen analysis remain intact. Model-visible relations were extracted from four DOM families, but that is extractor coverage rather than four distinct model-input populations.",
    "",
    `Provider usage: ${JSON.stringify(result.provider_usage)}. Raw source unchanged: ${result.raw_unchanged}.`,
    "",
  ];
  await writeFile(join(out, "semantic-audit.md"), lines.join("\n"), { flag: "wx" });
  console.log(
    JSON.stringify({
      semantic_input_classes: keys.length,
      requests: records.length,
      usage: result.provider_usage,
      raw_unchanged: result.raw_unchanged,
    }),
  );
}
if (process.argv[1]?.endsWith("cli-contract-v1/semantic-audit.ts"))
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
