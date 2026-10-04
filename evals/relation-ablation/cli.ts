import process from "node:process";
import { parseArgs } from "node:util";
import { runExperiment } from "./run.ts";
import { parseExperimentTasks } from "./schema.ts";

/**
 * Entry point for the relation ablation block (P0-A/P0-B).
 *
 *   node --experimental-strip-types --disable-warning=ExperimentalWarning \
 *     evals/relation-ablation/cli.ts --plan evals/cohorts/relation-ablation-v1-glm.json [--smoke]
 *
 * `--provider scripted` drives the correct control without any model call, so the whole
 * fixture, oracle, payload and ledger path can be validated offline before a freeze.
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg, index) => index !== 0 || arg !== "--"),
    options: {
      plan: { type: "string", default: "evals/cohorts/relation-ablation-v1-glm.json" },
      tasks: { type: "string", default: "evals/tasks/relation-ablation-v1.json" },
      output: { type: "string", default: "evals/results/relation-ablation-v1" },
      provider: { type: "string", default: "scripted" },
      freeze: { type: "string" },
      "browser-url": { type: "string", default: "http://127.0.0.1:9333" },
      smoke: { type: "boolean", default: false },
      "list-tasks": { type: "boolean", default: false },
    },
  });
  if (values.provider === "model") {
    try {
      process.loadEnvFile(".env");
    } catch {
      /* Use the existing environment. */
    }
  }
  if (values["list-tasks"]) {
    const { readFile } = await import("node:fs/promises");
    const tasks = parseExperimentTasks(
      JSON.parse(await readFile(values.tasks!, "utf8")),
    );
    for (const task of tasks)
      console.log(
        `${task.id}\t${task.design.condition}\tpos=${task.design.position}\t${task.design.family}\t${task.goal}`,
      );
    return;
  }
  if (values.provider !== "scripted" && values.provider !== "model")
    throw new Error("--provider must be scripted or model.");
  if (values.smoke && values.provider === "model")
    throw new Error("Smoke validation never calls a model; use --provider scripted.");
  const result = await runExperiment({
    cohortPath: values.plan!,
    tasksPath: values.tasks!,
    outputDir: values.output!,
    provider: values.provider,
    freezePath: values.freeze,
    browserUrl: values["browser-url"]!,
    limit: values.smoke ? 4 : undefined,
  });
  const grounded = result.records.filter((record) => record.grounding_success).length;
  console.log(
    `${result.records.length} cells; ${grounded} grounded; files: ${result.files
      .map((file) => `${file.arm}(${file.records})`)
      .join(", ")}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
