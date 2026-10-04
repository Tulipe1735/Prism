import { mkdir, readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { parseArgs } from "node:util";
import { auditCohort, type CohortAudit } from "./ledger.ts";
import { report } from "./report.ts";

/**
 * P0-C CLI: build the derived endpoint ledger and the report for the frozen cohorts.
 *
 *   node --experimental-strip-types --disable-warning=ExperimentalWarning \
 *     evals/endpoint-audit/cli.ts [--out work/endpoint-audit] [--cohorts a.jsonl,b.jsonl]
 *
 * No model call, no browser requirement, no write to the frozen result files.
 */
export const FROZEN_COHORTS = [
  "evals/results/paper-confirmatory-v1.jsonl",
  "evals/results/paper-replication-model2-v1.jsonl",
  "evals/results/external-validation-v1-glm-5.3-flash.jsonl",
  "evals/results/external-validation-v1-deepseek-v4.1-flash.jsonl",
];

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg, index) => index !== 0 || arg !== "--"),
    options: {
      out: { type: "string", default: "work/endpoint-audit" },
      cohorts: { type: "string" },
      tasks: { type: "string" },
    },
  });
  const paths = values.cohorts ? values.cohorts.split(",") : FROZEN_COHORTS;
  const audits: CohortAudit[] = [];
  for (const path of paths) audits.push(await auditCohort(path));
  const text = report(audits);
  await mkdir(values.out!, { recursive: true });
  await writeFile(`${values.out}/endpoint-audit.md`, text);
  await writeFile(
    `${values.out}/ledger.json`,
    `${JSON.stringify(
      {
        design: "endpoint-audit-v1",
        generated_at: new Date().toISOString(),
        cohorts: audits.map((audit) => ({
          cohort: audit.cohort,
          path: audit.path,
          sha256: audit.sha256,
          summaries: audit.summaries,
          steps: audit.steps,
          inconsistencies: audit.inconsistencies,
          rows: audit.ledger,
        })),
      },
      null,
      2,
    )}\n`,
  );
  console.log(text);
  console.error(
    `\n${audits.length} cohorts, ${audits.reduce((total, audit) => total + audit.summaries, 0)} summaries, ` +
      `${audits.reduce((total, audit) => total + audit.inconsistencies.length, 0)} consistency problems; ` +
      `wrote ${values.out}/endpoint-audit.md and ${values.out}/ledger.json`,
  );
}

if (process.argv[1] && process.argv[1].endsWith("endpoint-audit/cli.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

/** Re-export for tests and other tools. */
export { auditCohort, report };
export async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}
