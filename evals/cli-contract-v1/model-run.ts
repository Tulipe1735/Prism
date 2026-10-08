import type { Receipt, Reply } from "../../src/cli/protocol.ts";
import type { CliView, ModelCell } from "./model-input.ts";
import { appendFile, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { connectBrowser, parseBrowserUrl } from "../../src/browser/connect.ts";
import { commandSchema } from "../../src/cli/protocol.ts";
import { sessionHeaders } from "../runtime/text-helper.ts";
import { oracleExpression, pages } from "./design.ts";
import { modelAnalyze } from "./model-analyze.ts";
import {
  goalText,
  modelCells,
  MODELS,
  pairedProjection,
  parseChoice,
  SYSTEM,
} from "./model-input.ts";
import {
  fixtures,
  freeze,
  hash,
  historicalFiles,
  inspectOwnedTab,
  invokeCli,
  methodFiles,
} from "./runtime.ts";

const EXTRA = [
  "evals/cli-contract-v1/model-input.ts",
  "evals/cli-contract-v1/model-run.ts",
  "evals/cli-contract-v1/model-analyze.ts",
  "evals/cli-contract-v1/model-protocol.md",
  "tests/evals/cli-binding.test.ts",
];
const BASE_URL = "https://opencode.ai/zen/go/v1";
function data<T>(reply: Reply): T {
  if (!reply.ok) throw new Error(JSON.stringify(reply));
  return reply.data as T;
}
export function requestBody(model: string, payload: unknown): Record<string, unknown> {
  return {
    model,
    temperature: 0,
    top_p: 1,
    max_tokens: 8192,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: JSON.stringify(payload) },
    ],
  };
}
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      out: { type: "string" },
      "browser-url": { type: "string", default: "http://127.0.0.1:9333" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  if (!values.out) throw new Error("--out must name a fresh output directory");
  const out = resolve(values.out);
  await mkdir(out, { recursive: true });
  const dry = values["dry-run"]!;
  let key = "";
  if (!dry) {
    try {
      process.loadEnvFile(".env");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    key = process.env.TEXT_MODEL_API_KEY?.trim() ?? "";
    if (!key)
      throw new Error("TEXT_MODEL_API_KEY is unavailable; no requests dispatched");
  }
  const browserUrl = values["browser-url"]!;
  const version = (await (await fetch(`${browserUrl}/json/version`)).json()) as {
    Browser: string;
  };
  const manifest = await freeze(out, version.Browser, EXTRA);
  const pageSet = dry
    ? pages().filter((page) => page.state === 0 && page.skeleton === 0)
    : pages();
  const jobs = modelCells(pageSet);
  if (!dry && jobs.length !== 192)
    throw new Error("Design differs from authorized 192-cell plan");
  const plan = {
    study: "cli-binding-v1",
    dry_run: dry,
    controller: "external one-decision CLI caller",
    provider: BASE_URL,
    models: MODELS,
    max_http_requests: 192,
    retries: 0,
    planned_cells: jobs.length,
    concurrency: 4,
    timeout_ms: 90000,
    seed: null,
    temperature: 0,
    top_p: 1,
    max_tokens: 8192,
    reasoning: "provider-default",
    unit: "eight base pages; three states are repeated counterbalanced conditions",
    jobs,
  };
  await writeFile(join(out, "model-plan.json"), JSON.stringify(plan, null, 2), {
    flag: "wx",
  });
  const raw = join(out, "model-records.jsonl");
  const dispatch = join(out, "dispatch.jsonl");
  await writeFile(raw, "", { flag: "wx" });
  await writeFile(dispatch, "", { flag: "wx" });
  const cellPages = jobs.map((job) => ({ ...job.page, id: hash(job.id).slice(0, 16) }));
  if (new Set(cellPages.map((page) => page.id)).size !== jobs.length)
    throw new Error("Cell URL collision");
  const server = await fixtures(cellPages);
  const directory = await mkdtemp(join(tmpdir(), "prism-binding-"));
  let cursor = 0;
  let calls = 0;
  let completed = 0;
  let stopped: string | null = null;
  async function runCell(job: ModelCell): Promise<Record<string, unknown>> {
    const url = server.url(cellPages[job.index]!);
    const connection = await connectBrowser(parseBrowserUrl(browserUrl));
    let session: string | undefined;
    const started = performance.now();
    const record: Record<string, any> = {
      ...job,
      study: "cli-binding-v1",
      dry_run: dry,
      status: "infra_error",
      http_requests: 0,
      http_retries: 0,
      first_choice_correct: false,
      valid_output: false,
      abstained: false,
      actual_clicks: 0,
      correct_clicks: 0,
      wrong_clicks: 0,
      requested_model: job.model,
      returned_model: null,
      usage: null,
      dispatch_index: job.index,
      started_at: new Date().toISOString(),
    };
    try {
      session = data<{ session: string }>(
        await invokeCli(directory, [
          "session",
          "open",
          "--url",
          url,
          "--browser-url",
          browserUrl,
        ]),
      ).session;
      const view = data<CliView>(
        await invokeCli(directory, [
          "observe",
          "--session",
          session,
          "--scope",
          "relations",
        ]),
      );
      record.cli_observation = view;
      const payloads = pairedProjection(view, goalText(job.page, job.goal));
      record.payload_bytes = payloads.bytes;
      record.counterfactual_bytes_equal = true;
      const body = requestBody(job.model, payloads[job.arm]);
      record.request_body = body;
      record.prompt_hash = hash(JSON.stringify(body.messages));
      let response: any;
      if (dry) {
        response = {
          model: "instrument-mock",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  target: view.targets.find((target) => target.operation === "click")!
                    .ref,
                }),
              },
            },
          ],
        };
        record.response_body = JSON.stringify(response);
      } else {
        if (stopped !== null || calls >= 192) {
          record.status = "not_dispatched";
          return record;
        }
        // Persist the exact request without headers before it can leave this process.
        await appendFile(
          dispatch,
          `${JSON.stringify({ id: job.id, index: job.index, request_body: body, recorded_at: new Date().toISOString() })}\n`,
        );
        if (stopped !== null || calls >= 192) {
          record.status = "not_dispatched";
          return record;
        }
        calls++;
        record.http_requests = 1;
        const httpStart = performance.now();
        try {
          const http = await fetch(`${BASE_URL}/chat/completions`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${key}`,
              "content-type": "application/json",
              ...sessionHeaders(BASE_URL, record.prompt_hash),
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(90_000),
          });
          record.http_status = http.status;
          const text = await http.text();
          record.response_body = text;
          if (!http.ok) {
            record.status = "provider_error";
            if ([401, 402, 403, 429].includes(http.status))
              stopped = `Provider HTTP ${http.status}`;
            return record;
          }
          response = JSON.parse(text);
        } catch (error) {
          record.status = "provider_error";
          record.error = error instanceof Error ? error.name : "Request failure";
          return record;
        } finally {
          record.http_latency_ms = performance.now() - httpStart;
        }
      }
      record.returned_model =
        typeof response?.model === "string" ? response.model : null;
      record.usage = response?.usage ?? null;
      record.raw_content = response?.choices?.[0]?.message?.content ?? null;
      record.finish_reason = response?.choices?.[0]?.finish_reason ?? null;
      if (!dry && record.returned_model !== job.model) {
        record.status = "model_identity_unresolved";
        stopped = "Returned model identity differs from the frozen requested model";
        return record;
      }
      let choice: string | null;
      try {
        if (typeof record.raw_content !== "string") throw new Error("Missing content");
        choice = parseChoice(record.raw_content, view.targets);
        record.valid_output = true;
      } catch (error) {
        record.status = "invalid_output";
        record.error = error instanceof Error ? error.message : "Invalid output";
        return record;
      }
      record.choice = choice;
      if (choice === null) {
        record.status = "abstained";
        record.abstained = true;
        return record;
      }
      const node = Number(choice.split(":").at(-1)!.slice(1));
      const selected = await inspectOwnedTab(
        connection,
        url,
        `(() => {
        const b=window.__jevFast.nodes.get(${node}); const s=window.prismStudy;
        return {entity:b.dataset.entity,group:s.groups[Number(b.dataset.slot)]};
      })()`,
      );
      const expectedGroup = job.page.groups[job.page.entities.indexOf(job.page.target)];
      record.selected = selected;
      record.first_choice_correct =
        job.goal === "entity"
          ? selected.entity === job.page.target
          : selected.group === expectedGroup;
      const command = commandSchema.parse({
        command: "act",
        session,
        observation: view.observation,
        target: choice,
        evidence: view.evidence,
        operation: "click",
        request_id: "model-choice",
      });
      record.command = command;
      const reply = await invokeCli(directory, ["act", "--stdin"], command);
      record.cli_reply = reply;
      const receipt = (reply.data as { receipt?: Receipt } | undefined)?.receipt;
      record.receipt = receipt ?? null;
      const oracle = await inspectOwnedTab(connection, url, oracleExpression(0));
      if (!oracle.headings_match_state)
        throw new Error("App oracle and visible headings differ");
      record.oracle = oracle;
      record.actual_clicks = oracle.clicks.length;
      record.correct_clicks = oracle.clicks.filter(
        (click: { entity: string; group: string }) =>
          job.goal === "entity"
            ? click.entity === job.page.target
            : click.group === expectedGroup,
      ).length;
      record.wrong_clicks = record.actual_clicks - record.correct_clicks;
      record.status =
        receipt?.outcome === "executed"
          ? "executed"
          : receipt?.outcome === "not_executed"
            ? "rejected"
            : "unknown";
      return record;
    } catch (error) {
      record.error = error instanceof Error ? error.message : "Instrument failure";
      return record;
    } finally {
      record.latency_ms = performance.now() - started;
      record.completed_at = new Date().toISOString();
      if (session)
        await invokeCli(directory, ["session", "close", "--session", session]).catch(
          () => {},
        );
      await connection.close();
    }
  }
  async function worker(): Promise<void> {
    while (cursor < jobs.length && stopped === null) {
      const job = jobs[cursor++]!;
      let record: Record<string, unknown>;
      try {
        record = await runCell(job);
      } catch (error) {
        record = {
          ...job,
          status: "infra_error",
          first_choice_correct: false,
          http_requests: 0,
          error: String(error),
        };
      }
      await appendFile(raw, `${JSON.stringify(record)}\n`);
      completed++;
      console.log(
        JSON.stringify({
          completed,
          planned: jobs.length,
          http_requests: calls,
          model: job.model,
          arm: job.arm,
          status: record.status,
          stopped,
        }),
      );
    }
  }
  try {
    await Promise.all(Array.from({ length: 4 }, worker));
  } finally {
    await invokeCli(directory, ["daemon", "stop"]).catch(() => {});
    await server.close();
    for (const name of ["receipts", "events"]) {
      await cp(join(directory, name), join(out, "cli-state", name), {
        recursive: true,
      }).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    await rm(directory, { recursive: true, force: true });
  }
  const integrity = {
    method_unchanged:
      JSON.stringify(await methodFiles(EXTRA)) === JSON.stringify(manifest.files),
    historical_unchanged:
      JSON.stringify(await historicalFiles()) === JSON.stringify(manifest.historical),
    http_requests: calls,
    http_retries: 0,
    completed,
    planned: jobs.length,
    stopped,
  };
  await writeFile(
    join(out, "model-integrity.json"),
    JSON.stringify(integrity, null, 2),
    { flag: "wx" },
  );
  await modelAnalyze(out);
  console.log(JSON.stringify({ out, integrity }));
  if (
    !integrity.method_unchanged ||
    !integrity.historical_unchanged ||
    stopped !== null
  )
    process.exitCode = 1;
}
if (process.argv[1]?.endsWith("cli-contract-v1/model-run.ts"))
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Model run failed");
    process.exitCode = 1;
  });
