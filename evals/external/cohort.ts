import type { Cohort, StepRecord, SummaryRecord } from "../schema.ts";
import type { TaskMetadata } from "./audit.ts";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import process from "node:process";
import { connectBrowser, parseBrowserUrl } from "../../src/browser/connect.ts";
import { installResponseRecorder } from "../replication/responses.ts";
import { resultWriter, schedule, sourceHash } from "../runners/cohort.ts";
import { loadRecords } from "../runners/report.ts";
import { firstGroundingSuccess, gitMetadata, runOne } from "../runners/run.ts";
import { summarySchema } from "../schema.ts";
import { adaptiveTrace, externalAudit, externalFailure } from "./audit.ts";
import { design, ID, verifyFreeze } from "./controls.ts";
import { startExternalSources } from "./server.ts";

export const cellKey = (
  model: string,
  run: { task_id: string; variant: string; repetition: number },
): string => `${model}/${run.task_id}/${run.variant}/${run.repetition}`;
const outputFor = (model: string): string => `evals/results/${ID}-${model}.jsonl`;

async function main(): Promise<void> {
  try {
    process.loadEnvFile(".env");
  } catch {
    /* Existing environment can provide credentials. */
  }
  const { config, models, tasks } = await design();
  if (models.some((m: Cohort) => !process.env[m.apiKeyEnv]?.trim()))
    throw new Error("Existing model credential unavailable; no dispatch");
  const metadata: Record<string, TaskMetadata> = JSON.parse(
    await readFile("evals/external/task-metadata.json", "utf8"),
  );
  const connection = await connectBrowser(parseBrowserUrl(config.browser_url));
  let server: Awaited<ReturnType<typeof startExternalSources>> | undefined;
  try {
    const browser = await connection.client.send("Browser.getVersion");
    const frozen = await verifyFreeze(browser);
    const source = await sourceHash();
    const sidecarPath = `evals/results/${ID}.meta.json`;
    const auditPath = `evals/results/${ID}-audit.jsonl`;
    const existing = new Map<string, SummaryRecord>();
    const previous = await readFile(sidecarPath, "utf8").then(JSON.parse, () => null);
    const resume = process.argv.includes("--resume");
    if (previous && !resume) throw new Error("Plan exists; resume missing cells only");
    if (previous && previous.freeze_sha256 !== frozen.controls.config_hash)
      throw new Error("Resume control hash differs");
    for (const model of models as Cohort[]) {
      const path = outputFor(model.model);
      const records = await readFile(path, "utf8").then(
        () => loadRecords([path]),
        (error) => {
          if (error.code !== "ENOENT") throw error;
          return [];
        },
      );
      if (records.length && !previous) throw new Error("Results exist without plan");
      for (const record of records)
        if (record.record_type === "summary") {
          const key = cellKey(model.model, record);
          if (
            existing.has(key) ||
            !frozen.controls.planned_cells.includes(key) ||
            record.metadata.model !== model.model ||
            record.metadata.cohort?.id !== ID
          )
            throw new Error(`Invalid historical external cell ${key}`);
          existing.set(key, record);
        }
    }
    const audits = await readFile(auditPath, "utf8").then(
      (data) =>
        data
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((s) => JSON.parse(s)),
      () => [],
    );
    if (
      new Set(audits.map((a) => a.key)).size !== audits.length ||
      audits.length !== existing.size ||
      audits.some((a) => !existing.has(a.key))
    )
      throw new Error(
        "Audit coverage differs; preserve interrupted artifacts for manual audit",
      );
    const planned = schedule(tasks, models[0]!);
    const plan = planned
      .flatMap((item) => (models as Cohort[]).map((model) => ({ ...item, model })))
      .filter(
        (item) =>
          !existing.has(cellKey(item.model.model, { task_id: item.task.id, ...item })),
      );
    const experiment = previous?.experiment_id ?? randomUUID();
    const writers = new Map(
      (models as Cohort[]).map((m) => [m.model, resultWriter(outputFor(m.model))]),
    );
    let auditPending = Promise.resolve();
    const calls = Object.fromEntries(
      (models as Cohort[]).map((m) => [
        m.model,
        [...existing.values()]
          .filter((r) => r.metadata.model === m.model)
          .reduce((n, r) => n + r.llm_calls, 0),
      ]),
    );
    let cursor = 0;
    let finished = existing.size;
    let stopped: string | null = null;
    let checkpointPending = Promise.resolve();
    const checkpoint = (): Promise<void> => {
      checkpointPending = checkpointPending.then(async () => {
        const data = {
          study_id: ID,
          experiment_id: experiment,
          freeze_sha256: frozen.controls.config_hash,
          expected_runs: 360,
          completed_runs: finished,
          calls_by_model: calls,
          planned_cells: frozen.controls.planned_cells,
          status: stopped ? "incomplete" : finished === 360 ? "complete" : "running",
          stop_reason: stopped,
        };
        await writeFile(`${sidecarPath}.tmp`, `${JSON.stringify(data, null, 2)}\n`);
        await rename(`${sidecarPath}.tmp`, sidecarPath);
      });
      return checkpointPending;
    };
    await mkdir("evals/results", { recursive: true });
    await checkpoint();
    server = await startExternalSources();
    const recorder = installResponseRecorder(`evals/results/${ID}-responses.jsonl`);
    const worker = async (): Promise<void> => {
      while (cursor < plan.length && !stopped) {
        const item = plan[cursor++]!;
        try {
          await verifyFreeze(browser);
        } catch (error) {
          stopped = String(error);
          break;
        }
        const audit = externalAudit(connection.client, metadata[item.task.id]!);
        let rows: StepRecord[] = [];
        let stored: SummaryRecord | undefined;
        const beforeCall = (): void => {
          if (calls[item.model.model]! >= item.model.maxLlmCalls) {
            stopped = "Frozen model call cap reached";
            throw new Error(stopped);
          }
          calls[item.model.model]!++;
        };
        await runOne({
          connection: { ...connection, client: audit.client },
          fixtureUrl: server!.url,
          task: { ...item.task, maxSteps: item.model.maxSteps },
          variant: item.variant,
          repetition: item.repetition,
          provider: "model",
          experimentId: experiment,
          output: outputFor(item.model.model),
          metadata: {
            ...gitMetadata(),
            source_hash: source,
            fixture_hash: frozen.controls.external_source_hash,
            browser_version: browser.product,
          },
          timeoutMs: item.model.timeoutMs,
          cohort: item.model,
          beforeCall,
          writeRecords: async (data) => {
            const records = data
              .trim()
              .split("\n")
              .map((s) => JSON.parse(s));
            rows = records.filter((r) => r.record_type === "step");
            const result = records.find((r) => r.record_type === "summary");
            result.grounding_success = firstGroundingSuccess(rows);
            result.strict_task_success =
              result.success && result.status === "done" && audit.wrong() === 0;
            result.success = result.strict_task_success;
            result.infrastructure_failures = [
              ...new Set(
                rows.flatMap((r) =>
                  (r.infrastructure_events ?? []).map((e) => e.label),
                ),
              ),
            ];
            stored = summarySchema.parse(result);
            await writers.get(item.model.model)!(
              `${[...rows, stored].map((r) => JSON.stringify(r)).join("\n")}\n`,
            );
          },
        });
        if (!stored) throw new Error("No terminal summary was written");
        const final = stored;
        const key = cellKey(item.model.model, final);
        const observations = audit.observations;
        const external = {
          key,
          run_id: final.run_id,
          model: item.model.model,
          task_id: item.task.id,
          variant: final.variant,
          repetition: final.repetition,
          task_properties: metadata[item.task.id],
          observations,
          dynamic_structure_changes: observations
            .slice(1)
            .filter((o, i) => o.public_structure !== observations[i]?.public_structure)
            .length,
          grounding_observable: rows.some(
            (r) =>
              r.executed && ["correct", "wrong"].includes(r.target_assessment ?? ""),
          ),
          failure: externalFailure(rows, final, observations, audit.labels),
          external_events: audit.labels,
          adaptive: rows
            .map((r) => ({ step: r.step, trace: adaptiveTrace(r) }))
            .filter((r) => r.trace),
        };
        auditPending = auditPending.then(() =>
          appendFile(auditPath, `${JSON.stringify(external)}\n`),
        );
        await auditPending;
        existing.set(key, final);
        finished++;
        await checkpoint();
        console.log(
          `${finished}/360 ${item.model.model} ${final.success ? "PASS" : "FAIL"} ${final.task_id} ${final.variant} r${final.repetition} calls=${final.llm_calls} ${final.failure_type ?? ""}`,
        );
        if (final.metadata.returned_models.some((m) => m !== item.model.model))
          stopped = "Returned model mismatch";
        if (
          /HTTP (?:400|401|402|403|429)|connection failed|HTTP 5\d\d/.test(final.reason)
        )
          stopped = `Endpoint failure: ${final.reason}`;
      }
    };
    try {
      await Promise.all(Array.from({ length: models[0]!.concurrency }, worker));
    } finally {
      await recorder.close();
      await auditPending;
      await checkpoint();
    }
    if (stopped || finished !== 360)
      throw new Error(stopped ?? `Incomplete ${finished}/360`);
    await verifyFreeze(browser);
  } finally {
    await server?.close();
    await connection.close();
  }
}
if (process.argv[1]?.endsWith("/external/cohort.ts"))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
