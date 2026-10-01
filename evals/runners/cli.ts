import type { EvalTask, Provider, Variant } from "../schema.ts";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { connectBrowser, parseBrowserUrl } from "../../src/browser/connect.ts";
import {
  categorySchema,
  cohortSchema,
  parseTasks,
  providerSchema,
  variantSchema,
} from "../schema.ts";
import { fixtureRoot, hashTree, startFixtures } from "./fixtures.ts";
import { gitMetadata, hash, runOne } from "./run.ts";

export interface EvalCliOptions {
  category?: EvalTask["category"];
  task?: string;
  variant?: string;
  provider: Provider;
  repeat: number;
  timeoutMs: number;
  "browser-url"?: string;
  "timeout-ms"?: string;
  tasks?: string;
  cohort?: string;
  output?: string;
  list?: boolean;
  help?: boolean;
  variants: Variant[];
}

export function parseOptions(args: string[]): EvalCliOptions {
  const { values } = parseArgs({
    args: args[0] === "--" ? args.slice(1) : args,
    options: {
      category: { type: "string" },
      task: { type: "string" },
      variant: { type: "string", default: "prism-full" },
      provider: { type: "string", default: "scripted" },
      repeat: { type: "string", default: "1" },
      "timeout-ms": { type: "string", default: "60000" },
      "browser-url": { type: "string", default: "http://127.0.0.1:9222" },
      tasks: { type: "string" },
      cohort: { type: "string" },
      output: { type: "string" },
      list: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  const repeat = Number(values.repeat);
  const timeoutMs = Number(values["timeout-ms"]);
  if (!Number.isSafeInteger(repeat) || repeat < 1)
    throw new Error("--repeat must be a positive integer.");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
    throw new Error(
      "--timeout-ms must be a positive integer no greater than 2147483647.",
    );
  return {
    ...values,
    repeat,
    timeoutMs,
    category:
      values.category === undefined ? undefined : categorySchema.parse(values.category),
    provider: providerSchema.parse(values.provider),
    variants:
      values.variant === "all"
        ? variantSchema.options
        : [variantSchema.parse(values.variant)],
  };
}

export async function main(args: string[]): Promise<void> {
  const options = parseOptions(args);
  if (options.help) {
    console.log(
      "pnpm eval [--task ID] [--category grounding|stale|ambiguity] [--variant prism-full|prism-no-stale-recovery|prism-no-validation|all] [--provider scripted|model] [--repeat N] [--browser-url URL] [--timeout-ms N] [--tasks FILE] [--output FILE] [--list]",
    );
    return;
  }
  try {
    process.loadEnvFile(".env");
  } catch {
    /* Optional, matching runBrowserTask. */
  }
  const definitions =
    options.tasks ?? fileURLToPath(new URL("../tasks/core.json", import.meta.url));
  const tasks = parseTasks(JSON.parse(await readFile(definitions, "utf8"))).filter(
    (task) =>
      (options.task === undefined || task.id === options.task) &&
      (options.category === undefined || task.category === options.category) &&
      (options.provider === "scripted" || task.fault === undefined),
  );
  if (tasks.length === 0)
    throw new Error(
      "No matching tasks (controlled validation faults require --provider scripted).",
    );
  if (options.list) {
    for (const task of tasks) console.log(`${task.id}\t${task.category}\t${task.goal}`);
    return;
  }
  const cohort = options.cohort
    ? cohortSchema.parse(JSON.parse(await readFile(options.cohort, "utf8")))
    : undefined;
  if (
    options.provider === "model" &&
    (!cohort || !process.env[cohort.apiKeyEnv]?.trim())
  )
    throw new Error("Real-model runs require --cohort FILE and its configured key.");
  if (
    options.provider === "scripted" &&
    options.variants.some((v) => v.startsWith("raw-selector"))
  )
    throw new Error(
      "raw-selector requires --provider model and --cohort FILE; select indexed variants for scripted runs.",
    );
  const experimentId = randomUUID();
  const output = resolve(
    options.output ?? `evals/results/${Date.now()}-${experimentId}.jsonl`,
  );
  const fixtures = await startFixtures();
  let connection: Awaited<ReturnType<typeof connectBrowser>> | undefined;
  try {
    connection = await connectBrowser(parseBrowserUrl(options["browser-url"]!));
    const browser = await connection.client.send("Browser.getVersion");
    const metadata = {
      ...gitMetadata(),
      browser_version: typeof browser.product === "string" ? browser.product : null,
      fixture_hash: await hashTree(fixtureRoot),
      source_hash: hash(
        [
          await hashTree(fileURLToPath(new URL("../../src/", import.meta.url))),
          await hashTree(fileURLToPath(new URL("./", import.meta.url))),
          ...(await Promise.all(
            ["schema.ts", "success.ts", "failures.ts"].map((name) =>
              readFile(new URL(`../${name}`, import.meta.url), "utf8"),
            ),
          )),
          await readFile(new URL("../../package.json", import.meta.url), "utf8"),
          await readFile(new URL("../../pnpm-lock.yaml", import.meta.url), "utf8"),
        ].join("\n"),
      ),
    };
    console.log(
      `Experiment ${experimentId}; ${tasks.length} tasks × ${options.variants.length} variants × ${options.repeat} repeats; provider=${options.provider}`,
    );
    for (let repetition = 0; repetition < options.repeat; repetition += 1) {
      for (const task of tasks) {
        for (const variant of options.variants) {
          const result = await runOne({
            cohort,
            connection,
            fixtureUrl: fixtures.url,
            task: cohort ? { ...task, maxSteps: cohort.maxSteps } : task,
            variant,
            provider: options.provider,
            experimentId,
            repetition,
            output,
            metadata,
            timeoutMs: options.timeoutMs,
          });
          console.log(
            `${result.success ? "PASS" : "FAIL"} ${task.id} ${variant} repeat=${repetition} steps=${result.steps} stale=${result.stale_events} ${result.failure_type ?? ""}`,
          );
        }
      }
    }
    // Sidecar contains no keys or model prompts; the JSONL summaries also carry provenance.
    await writeFile(
      `${output}.meta.json`,
      `${JSON.stringify({ experiment_id: experimentId, tasks: tasks.map((task) => task.id), variants: options.variants, provider: options.provider, repeat: options.repeat, metadata }, null, 2)}\n`,
    );
    console.log(`Results saved to ${output}`);
  } finally {
    try {
      await connection?.close();
    } finally {
      await fixtures.close();
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
