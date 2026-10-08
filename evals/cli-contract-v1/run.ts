import type { TargetEvidence } from "../../src/browser/evidence.ts";
import type { BrowserSession } from "../../src/browser/session.ts";
import type { Command, Receipt, Reply } from "../../src/cli/protocol.ts";
import type { SnapshotAction } from "../../src/shared/types.ts";
import type { Cell, Oracle, Page } from "./design.ts";
import { Buffer } from "node:buffer";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { connectBrowser, parseBrowserUrl } from "../../src/browser/connect.ts";
import {
  captureEvidence,
  readTargetEvidence,
  targetEvidence,
} from "../../src/browser/evidence.ts";
import { openBrowserSession } from "../../src/browser/session.ts";
import { commandSchema } from "../../src/cli/protocol.ts";
import { Sessions } from "../../src/cli/sessions.ts";
import { analyze } from "./analyze.ts";
import {
  cells,
  goalCorrect,
  mutation,
  oracleExpression,
  pages,
  scopes,
  score,
  truncationCells,
} from "./design.ts";
import {
  evaluate,
  fixtures,
  freeze,
  historicalFiles,
  inspectOwnedTab,
  invokeCli,
  methodFiles,
} from "./runtime.ts";

interface Target extends TargetEvidence {
  ref: string;
  operation: string;
  label: string;
}
interface View {
  session: string;
  observation: string;
  evidence: string;
  targets: Target[];
}
function data<T>(reply: Reply): T {
  if (!reply.ok) throw new Error(JSON.stringify(reply));
  return reply.data as T;
}
const markOriginal = (target: string): string => `(() => {
  window.__studyOriginal=document.querySelector('button[data-entity="${target}"]');
  return true;
})()`;
async function findTarget(
  view: View,
  call: BrowserSession["call"],
  page: Page,
): Promise<Target> {
  const nodes = await evaluate(
    call,
    `Object.fromEntries([...window.__jevFast.nodes].map(([id,e])=>[id,e.dataset?.entity??null]))`,
  );
  const offered = view.targets.filter(
    (target) => target.operation === "click" && target.label === "Choose",
  );
  if (offered.length !== 3)
    throw new Error(`Offered candidate set is ${offered.length}, expected 3`);
  const target = offered.find(
    (item) => nodes[Number(item.ref.split(":").at(-1)!.slice(1))] === page.target,
  );
  if (!target) throw new Error("Instrument's known target was not offered");
  return target;
}
const actCommand = (view: View, target: Target, request: string): Command =>
  commandSchema.parse({
    command: "act",
    session: view.session,
    observation: view.observation,
    target: target.ref,
    evidence: view.evidence,
    operation: "click",
    request_id: request,
  });
function result(
  cell: Cell,
  before: Oracle,
  after: Oracle,
  reply: Reply,
): Record<string, unknown> {
  const receipt = (reply.data as { receipt?: Receipt } | undefined)?.receipt;
  if (!receipt) throw new Error(`Missing action receipt: ${JSON.stringify(reply)}`);
  if (!before.headings_match_state || !after.headings_match_state)
    throw new Error("Oracle app state differs from full visible headings");
  return {
    kind: "action",
    id: cell.id,
    cohort: cell.cohort,
    page: cell.page,
    goal: cell.goal,
    change: cell.change,
    gate: cell.gate,
    initial_choice_correct: true,
    controller: "privileged fixed instrument, no model",
    before_input: before,
    after,
    receipt,
    ...score(cell.page, cell.goal, before, after, receipt.outcome),
  };
}

async function runCase(
  cell: Cell,
  url: string,
  directory: string,
  browserUrl: string,
): Promise<Record<string, unknown>> {
  let browser!: BrowserSession;
  let original!: Awaited<ReturnType<typeof captureEvidence>>;
  let before!: Oracle;
  const slot = cell.page.entities.indexOf(cell.page.target);
  const sessions = new Sessions(directory, {
    connect: connectBrowser,
    open: async (options) => (browser = await openBrowserSession(options)),
    capture: async (session) => (original = await captureEvidence(session)),
    read: async (session, action: SnapshotAction) => {
      // Both arms issue a live read. Only the returned comparison evidence is ablated.
      const current = await readTargetEvidence(session, action);
      if (cell.change === "post-read-swap")
        await evaluate(session.call.bind(session), mutation(cell.change, slot));
      before = await evaluate(session.call.bind(session), oracleExpression(slot));
      return cell.gate === "identity-only"
        ? {
            contexts: original.contexts,
            relations: original.relations,
            status: original.status,
          }
        : current;
    },
  });
  try {
    const opened = data<{ session: string }>(
      await sessions.handle({ command: "open", url, browser_url: browserUrl }),
    );
    const view = data<View>(
      await sessions.handle({
        command: "observe",
        session: opened.session,
        scope: "relations",
      }),
    );
    const call = browser.call.bind(browser);
    const target = await findTarget(view, call, cell.page);
    await evaluate(call, markOriginal(cell.page.target));
    const initially = (await evaluate(call, oracleExpression(slot))) as Oracle;
    if (!goalCorrect(cell.page, cell.goal, initially) || !initially.target_live)
      throw new Error("Initial instrument choice is not valid");
    if (cell.change !== "post-read-swap")
      await evaluate(call, mutation(cell.change, slot));
    // Node rejection can occur before the read dependency; retain its current oracle.
    before = await evaluate(call, oracleExpression(slot));
    const command = actCommand(view, target, "fixed-choice");
    const reply = await sessions.handle(command);
    const after = await evaluate(call, oracleExpression(slot));
    return { ...result(cell, before, after, reply), observation: view, command, reply };
  } finally {
    await sessions.closeAll();
  }
}

async function coverage(
  page: Page,
  url: string,
  scope: (typeof scopes)[number],
  browserUrl: string,
): Promise<Record<string, unknown>> {
  const connection = await connectBrowser(parseBrowserUrl(browserUrl));
  let browser: BrowserSession | undefined;
  try {
    browser = await openBrowserSession({ client: connection.client, url });
    const captured = await captureEvidence(browser);
    const offered = captured.snapshot.actions.filter(
      (action) => action.kind === "click" && action.label === "Choose",
    );
    const fields = [];
    for (const action of offered) {
      const entity = await evaluate(
        browser.call.bind(browser),
        `window.__jevFast.nodes.get(${action.node}).dataset.entity`,
      );
      const slot = page.entities.indexOf(entity);
      if (slot < 0) throw new Error("Unknown candidate entity");
      const evidence = targetEvidence(
        action,
        scope,
        captured.contexts[String(action.node)],
        captured.relations[String(action.node)],
      );
      fields.push({
        entity,
        group: page.groups[slot],
        evidence,
        exposes_entity: JSON.stringify(evidence).includes(entity),
        exposes_group: JSON.stringify(evidence).includes(page.groups[slot]!),
        bytes: Buffer.byteLength(JSON.stringify(evidence)),
      });
    }
    if (offered.length !== 3)
      throw new Error(`Observation only offered ${offered.length} candidates`);
    const publicFields = fields.map((entry) => entry.evidence);
    const serialized = JSON.stringify(publicFields);
    if (/prismStudy|data-entity|data-heading|oracle|correct_target/.test(serialized))
      throw new Error("Private instrument metadata leaked into observation fields");
    return {
      kind: "coverage",
      id: `${page.id}:${scope}`,
      page,
      scope,
      offered: offered.length,
      fields,
      target_fields_bytes: Buffer.byteLength(serialized),
      public_fields: publicFields,
      tokenizer_tokens: null,
      model_calls: 0,
    };
  } finally {
    await browser?.close();
    await connection.close();
  }
}

async function transportCase(
  cell: Cell,
  url: string,
  directory: string,
  browserUrl: string,
): Promise<Record<string, unknown>> {
  const connection = await connectBrowser(parseBrowserUrl(browserUrl));
  let session: string | undefined;
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
    const view = data<View>(
      await invokeCli(directory, [
        "observe",
        "--session",
        session,
        "--scope",
        "relations",
      ]),
    );
    const call = (method: string, params?: object): Promise<any> => {
      if (method !== "Runtime.evaluate")
        throw new Error("Inspector only supports evaluate");
      return inspectOwnedTab(
        connection,
        url,
        (params as { expression: string }).expression,
      ).then((value) => ({ result: { value } }));
    };
    const target = await findTarget(view, call, cell.page);
    const slot = cell.page.entities.indexOf(cell.page.target);
    await inspectOwnedTab(connection, url, markOriginal(cell.page.target));
    await inspectOwnedTab(connection, url, mutation(cell.change, slot));
    const before = await inspectOwnedTab(connection, url, oracleExpression(slot));
    const command = actCommand(view, target, "cli-choice");
    const reply = await invokeCli(directory, ["act", "--stdin"], command);
    const after = await inspectOwnedTab(connection, url, oracleExpression(slot));
    return {
      ...result(cell, before, after, reply),
      kind: "transport",
      observation: view,
      command,
      reply,
    };
  } finally {
    if (session) await invokeCli(directory, ["session", "close", "--session", session]);
    await connection.close();
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      out: { type: "string" },
      "browser-url": { type: "string", default: "http://127.0.0.1:9333" },
      smoke: { type: "boolean", default: false },
    },
  });
  if (!values.out) throw new Error("--out must name a new output directory");
  const out = resolve(values.out);
  await mkdir(out, { recursive: true });
  const browserUrl = values["browser-url"]!;
  const response = await fetch(`${browserUrl}/json/version`);
  const version = (await response.json()) as { Browser: string };
  const manifest = await freeze(out, version.Browser);
  const ordinary = values.smoke ? pages().slice(0, 1) : pages();
  const boundaryPages = values.smoke
    ? []
    : ["long-heading", "deep-group"].flatMap((boundary) =>
        pages(boundary as "long-heading" | "deep-group").filter(
          (page) => page.state === 0 && page.skeleton === 0,
        ),
      );
  const primary = cells(ordinary);
  const boundary = values.smoke ? [] : truncationCells();
  const transport = (
    values.smoke
      ? primary
      : primary.filter((cell) => cell.page.state === 0 && cell.page.skeleton === 0)
  ).filter(
    (cell) =>
      cell.gate === "evidence-consistency" &&
      ["stable", "unrelated", "swap-groups", "replace-target"].includes(cell.change),
  );
  const planned = {
    coverage: (ordinary.length + boundaryPages.length) * scopes.length,
    primary: primary.length,
    truncation: boundary.length,
    transport: transport.length,
  };
  await writeFile(
    join(out, "plan.json"),
    JSON.stringify(
      {
        study: "cli-contract-v1",
        development_smoke: values.smoke,
        planned,
        primary,
        boundary,
        transport,
      },
      null,
      2,
    ),
    { flag: "wx" },
  );
  const raw = join(out, "records.jsonl");
  await writeFile(raw, "", { flag: "wx" });
  const server = await fixtures([...ordinary, ...boundaryPages]);
  let completed = 0;
  async function save(job: () => Promise<object>, key: object): Promise<void> {
    try {
      await appendFile(
        raw,
        `${JSON.stringify({ recorded_at: new Date().toISOString(), ...(await job()) })}\n`,
      );
    } catch (error) {
      await appendFile(
        raw,
        `${JSON.stringify({ kind: "error", ...key, error: String(error) })}\n`,
      );
    }
    completed++;
    if (completed % 32 === 0) console.log(`Recorded ${completed} cases`);
  }
  try {
    for (const page of [...ordinary, ...boundaryPages])
      for (const scope of scopes)
        await save(() => coverage(page, server.url(page), scope, browserUrl), {
          id: `${page.id}:${scope}`,
          intended: "coverage",
        });
    for (const cell of [...primary, ...boundary])
      await save(
        () => runCase(cell, server.url(cell.page), join(out, "sessions"), browserUrl),
        { id: cell.id, intended: "action" },
      );
    for (const cell of transport)
      await save(
        () =>
          transportCase(
            cell,
            server.url(cell.page),
            join(out, "cli-state"),
            browserUrl,
          ),
        { id: cell.id, intended: "transport" },
      );
  } finally {
    await invokeCli(join(out, "cli-state"), ["daemon", "stop"]).catch(() => {});
    await server.close();
  }
  const integrity = {
    method_unchanged:
      JSON.stringify(await methodFiles()) === JSON.stringify(manifest.files),
    historical_unchanged:
      JSON.stringify(await historicalFiles()) === JSON.stringify(manifest.historical),
    model_calls: 0,
  };
  await writeFile(join(out, "integrity.json"), JSON.stringify(integrity, null, 2), {
    flag: "wx",
  });
  await analyze(out);
  console.log(JSON.stringify({ out, completed, planned, integrity }));
  if (!integrity.method_unchanged || !integrity.historical_unchanged)
    process.exitCode = 1;
}
if (process.argv[1]?.endsWith("cli-contract-v1/run.ts"))
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
