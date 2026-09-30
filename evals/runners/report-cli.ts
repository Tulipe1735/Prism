import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { format, resolveConfig } from "prettier";
import { failureAnalysis, generateReport, loadRecords } from "./report.ts";

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2).filter((arg, index) => index !== 0 || arg !== "--"),
    allowPositionals: true,
    options: { output: { type: "string", default: "evals/reports/summary.md" } },
  });
  if (!positionals.length)
    throw new Error(
      "Specify result files explicitly; do not mix archived schemas or cohorts.",
    );
  const paths = positionals;
  const records = await loadRecords(paths);
  const report = generateReport(records.filter((r) => r.record_type === "summary"));
  const output = resolve(values.output!);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    await format(report, { ...(await resolveConfig(output)), parser: "markdown" }),
  );
  const failureOutput = resolve(dirname(output), "failure-analysis.md");
  await writeFile(
    failureOutput,
    await format(failureAnalysis(records), {
      ...(await resolveConfig(failureOutput)),
      parser: "markdown",
    }),
  );
  console.log(`Reports saved to ${output} and ${failureOutput}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
