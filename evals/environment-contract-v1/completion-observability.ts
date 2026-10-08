import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { extname, join, resolve, sep } from "node:path";
import { connectBrowser, parseBrowserUrl } from "../../src/browser/connect.ts";
import { inspectOwnedTab, invokeCli } from "../cli-contract-v1/runtime.ts";

const ROOT = resolve("work/environment-contract-2026-10-05");
const SOURCE = join(ROOT, "sources");
const hash = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
const save = async (p: string, v: unknown) =>
  writeFile(p, JSON.stringify(v, null, 2) + "\n", { flag: "wx" });
const cases = ["correct"];
// Prospectively fixed zero-model completion-observability qualification.
// Include four H1 candidates and one already qualified menu candidate. No agent.
const tasks = JSON.parse(await readFile(join(ROOT, "tasks.json"), "utf8"))
 .filter((t: any) => ["condiment-lettuce","composer-tab","postcard-message","dropdown-two","speed-menu"].includes(t.id));
const browser = "http://127.0.0.1:9333";
const mode: string = "completion-observability";
const study = resolve("work/codex-prism-readiness-2026-10-05");
await mkdir(study);
const out = join(study, "qualification");
await mkdir(out); // Exclusive: no replacing a completed block.
for (const family of ["jquery-ui", "datatables", "docs"]) {
  try {
    await cp(
      join(".scratch/external-validation-v1/sources", family),
      join(SOURCE, family),
      { recursive: true, errorOnExist: true, force: false },
    );
  } catch (e: any) {
    if (e.code !== "ERR_FS_CP_EEXIST") throw e;
  }
}
const files: Record<string, string> = {};
async function inventory(path: string) {
  for (const e of await readdir(path, { withFileTypes: true })) {
    const p = join(path, e.name);
    if (e.isDirectory()) await inventory(p);
    else if (e.isFile()) files[p] = hash(await readFile(p));
  }
}
await inventory("src");
await inventory("evals/environment-contract-v1");
await inventory(SOURCE);
for (const p of [
  "package.json",
  "pnpm-lock.yaml",
  "skills/prism/SKILL.md",
  "evals/cli-contract-v1/runtime.ts",
  join(ROOT, "tasks.json"),
])
  files[p] = hash(await readFile(p));
const archive = join(out, "source.tar.gz");
execFileSync("tar", ["-czf", archive, "--", ...Object.keys(files)]);
await save(join(out, "freeze.json"), {
  kind: "local pre-execution freeze; no model requests",
  at: new Date().toISOString(),
  node: process.version,
  browser: await (await fetch(browser + "/json/version")).json(),
  git_revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  files,
  archive_sha256: hash(await readFile(archive)),
});
const selected = tasks;
await save(join(out, "plan.json"), {
  tasks: selected,
  cases,
  planned: selected.length * cases.length,
  model_requests: 0,
  retries: 0,
  controller: "researcher-known selectors; not an autonomous host",
});
const directory = await mkdtemp("/tmp/prism-contract-");
const resourceErrors: any[] = [];
const server = createServer((req, res) => {
  void (async () => {
    try {
      const path = resolve(SOURCE, "." + new URL(req.url!, "http://local").pathname);
      if (!path.startsWith(SOURCE + sep)) throw new Error("path outside replay");
      const data = await readFile(path);
      const mime: any = {
        ".html": "text/html",
        ".erb": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
      };
      res.writeHead(200, {
        "content-type": mime[extname(path)] ?? "application/octet-stream",
        "content-security-policy":
          "default-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; form-action 'none'",
      });
      res.end(data);
    } catch {
      resourceErrors.push({ url: req.url, status: 404 });
      res.writeHead(404);
      res.end();
    }
  })();
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const origin = "http://127.0.0.1:" + (server.address() as any).port;
const connection = await connectBrowser(parseBrowserUrl(browser));
const records: any[] = [];
function data(reply: any) {
  if (!reply.ok) throw new Error(JSON.stringify(reply));
  return reply.data;
}
try {
  for (const task of selected)
    for (const condition of cases) {
      const url = origin + "/" + task.path;
      const row: any = {
        task_id: task.id,
        condition,
        goal: task.goal,
        source_family: task.family,
        model_requests: 0,
        commands: [],
        controller: "privileged instrument",
      };
      let session: string | undefined;
      const cli = async (args: string[], input?: any) => {
        const reply = await invokeCli(directory, args, input);
        row.commands.push({ args, input, reply });
        return reply;
      };
      const inspect = async (expression: string) =>
        inspectOwnedTab(connection, url, expression);
      try {
        session = data(
          await cli(["session", "open", "--url", url, "--browser-url", browser]),
        ).session;
        // Wait for independently specified source widget readiness; never redo a failed case.
        const deadline = Date.now() + 5000;
        while (
          Date.now() < deadline &&
          !(await inspect(
            `Boolean(document.querySelector(${JSON.stringify(task.correct)}))`,
          ))
        )
          await new Promise((done) => setTimeout(done, 100));
        const sourceReady = await inspect(
          `Boolean(document.querySelector(${JSON.stringify(task.correct)}))`,
        );
        row.source_ready = sourceReady;
        if (!sourceReady) throw new Error("SOURCE_CONTROL_MISSING");
        const initial = data(
          await cli(["observe", "--session", session!, "--scope", "local"]),
        );
        const lookup = async (view: any, selector: string, option?: string) => {
          const binding = await inspect(
            `(() => { const e=document.querySelector(${JSON.stringify(selector)}); const s=(${await readFile("src/browser/snapshot.js", "utf8")}); const a=s.actions.find(a=>window.__jevFast.nodes.get(a.node)===e && a.kind===${JSON.stringify(task.operation)} ${option !== undefined ? "&& a.value===" + JSON.stringify(option) : ""}); if(!a)return null; const peers=s.actions.filter(x=>x.kind===a.kind && x.role===a.role && x.label===a.label && x.value===a.value); return {label:a.label,role:a.role,kind:a.kind,index:peers.indexOf(a),count:peers.length}; })()`,
          );
          if (!binding) return undefined;
          const peers = view.targets.filter(
            (t: any) =>
              t.operation === binding.kind &&
              t.role === binding.role &&
              t.label === binding.label &&
              (option === undefined || t.option_value === option),
          );
          if (peers.length !== binding.count)
            throw new Error("INSTRUMENT_MAPPING_DRIFT");
          return peers[binding.index];
        };
        row.initial_viewport_offered = Boolean(
          await lookup(initial, task.correct, task.option ?? undefined),
        );
        await inspect(
          `document.querySelector(${JSON.stringify(task.correct)}).scrollIntoView({block:'center'})`,
        );
        await inspect(
          `(() => { window.__qualificationEvents=[]; window.__qualificationErrors=[]; window.addEventListener('error',e=>window.__qualificationErrors.push(e.message)); window.addEventListener('unhandledrejection',e=>window.__qualificationErrors.push(String(e.reason))); for(const type of ['click','input','change']) document.addEventListener(type,e=>window.__qualificationEvents.push({type,correct:document.querySelector(${JSON.stringify(task.correct)}).contains(e.target),wrong:document.querySelector(${JSON.stringify(task.wrong)}).contains(e.target),value:e.target.value,checked:e.target.checked}),true); })()`,
        );
        const mutate = async (kind: string) =>
          inspect(
            `(() => { const e=document.querySelector(${JSON.stringify(task.correct)}); if(${JSON.stringify(kind)}==='hidden')e.hidden=true; else { e.setAttribute('aria-disabled','true'); if('disabled' in e)e.disabled=true; } })()`,
          );
        if (condition === "hidden-before") await mutate("hidden");
        if (condition === "disabled-before") await mutate("disabled");
        const view = data(
          await cli(["observe", "--session", session!, "--scope", "relations"]),
        );
        row.observation = view;
        const correct = await lookup(view, task.correct, task.option ?? undefined);
        row.offered = Boolean(correct);
        row.target = correct ?? null;
        row.contexts = { local: correct ?? null };
        if (correct)
          for (const scope of ["structural", "relations"])
            row.contexts[scope] = data(
              await cli([
                "context",
                "--session",
                session!,
                "--observation",
                view.observation,
                "--target",
                correct.ref,
                "--scope",
                scope,
              ]),
            );
        row.relation_exposure = Object.fromEntries(
          Object.entries(row.contexts).map(([scope, v]) => [
            scope,
            JSON.stringify(v ?? {}).includes(task.relation_text),
          ]),
        );
        row.before_goal = await inspect(task.oracle);
        if (condition === "hidden-after") await mutate("hidden");
        if (condition === "disabled-after") await mutate("disabled");
        if (condition === "relation-after") {
          row.relation_mutated = await inspect(
            `(() => { const e=document.querySelector(${JSON.stringify(task.relation_selector)}); if(!e)return false; if(!e.textContent.includes(${JSON.stringify(task.relation_text)}))return false; e.textContent=e.textContent.replace(${JSON.stringify(task.relation_text)},'Changed source identity'); return true; })()`,
          );
        }
        const chosen =
          condition === "wrong"
            ? await lookup(view, task.wrong, task.wrong_option ?? undefined)
            : correct;
        if (
          !["neutral", "hidden-before", "disabled-before"].includes(condition) &&
          chosen
        ) {
          // Evidence belongs to the chosen ref. Wrong target gets its own context.
          const evidence =
            chosen === correct
              ? row.contexts.relations
              : data(
                  await cli([
                    "context",
                    "--session",
                    session!,
                    "--observation",
                    view.observation,
                    "--target",
                    chosen.ref,
                    "--scope",
                    "relations",
                  ]),
                );
          const command = {
            command: "act",
            session,
            observation: view.observation,
            target: chosen.ref,
            evidence: evidence.evidence,
            operation: task.operation,
            request_id: "qualified-input",
            ...(task.operation === "fill" ? { value: task.value } : {}),
          };
          row.command = command;
          row.reply = await cli(["act", "--stdin"], command);
          row.queried_receipt = data(
            await cli([
              "receipt",
              "--session",
              session!,
              "--request-id",
              command.request_id,
            ]),
          ).receipt;
          if (condition === "replay") {
            row.before_replay = await inspect("window.__qualificationEvents");
            row.replay_reply = await cli(["act", "--stdin"], command);
            row.after_replay = await inspect("window.__qualificationEvents");
          }
        } else
          row.no_input_reason = [
            "neutral",
            "hidden-before",
            "disabled-before",
          ].includes(condition)
            ? condition
            : "TARGET_NOT_OFFERED";
        row.after_goal = await inspect(task.oracle);
        row.after_observation = data(await cli(["observe", "--session", session!, "--scope", "relations"]));
        const normalize = (view: any) => {
          const result=JSON.parse(JSON.stringify(view));
          delete result.session; delete result.observation; delete result.evidence;
          result.page.url="owned-source-page";
          for(const [i,t] of result.targets.entries())t.ref=`target-${i+1}`;
          return result;
        };
        row.public_before=normalize(row.observation);
        row.public_after=normalize(row.after_observation);
        row.public_reply_changed=JSON.stringify(row.public_before)!==JSON.stringify(row.public_after);
        row.completion_observability_note="A public difference is necessary but not sufficient; inspect its semantics separately. Native goal oracle is private instrument data.";
        row.events = await inspect("window.__qualificationEvents");
        row.page_errors = await inspect("window.__qualificationErrors");
        const relevant = row.events.filter(
          (e: any) =>
            (e.correct || e.wrong) &&
            (task.operation === "fill" || task.operation === "select"
              ? e.type === "input" || e.type === "change"
              : e.type === "click"),
        );
        row.actual_input = relevant.length > 0;
        row.correct_target_input = relevant.some(
          (e: any) =>
            e.correct && (task.operation !== "select" || e.value === task.option),
        );
        row.wrong_target_input = relevant.some(
          (e: any) =>
            condition === "wrong" &&
            (e.wrong || task.operation === "select") &&
            !row.correct_target_input,
        );
        row.goal_attained = row.after_goal && row.correct_target_input;
        row.receipt_consistent = row.queried_receipt
          ? row.queried_receipt.outcome === "executed"
            ? row.actual_input
            : row.queried_receipt.outcome === "not_executed"
              ? !row.actual_input
              : null
          : null;
        row.receipt_query_matches = row.queried_receipt
          ? JSON.stringify(row.queried_receipt) ===
            JSON.stringify(row.reply.data.receipt)
          : null;
        row.status =
          row.no_input_reason === "TARGET_NOT_OFFERED" ? "unsupported" : "recorded";
      } catch (error: any) {
        row.status = "infra_error";
        row.error = error.message;
      } finally {
        if (session) await cli(["session", "close", "--session", session]);
      }
      await appendFile(join(out, "records.jsonl"), JSON.stringify(row) + "\n");
      records.push(row);
      console.log(
        JSON.stringify({
          task: row.task_id,
          condition,
          status: row.status,
          offered: row.offered,
          actual: row.actual_input,
          goal: row.goal_attained,
          receipt: row.queried_receipt?.outcome,
        }),
      );
    }
} finally {
  await invokeCli(directory, ["daemon", "stop"]).catch(() => {});
  await connection.close();
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
  await cp(directory, join(out, "cli-state"), { recursive: true });
}
const mismatch = [];
for (const [p, h] of Object.entries(files))
  if (hash(await readFile(p)) !== h) mismatch.push(p);
const summary = {
  planned: selected.length * cases.length,
  records: records.length,
  model_requests: 0,
  source_drift: mismatch,
  statuses: Object.fromEntries(
    [...new Set(records.map((r) => r.status))].map((status) => [
      status,
      records.filter((r) => r.status === status).length,
    ]),
  ),
  receipt_mismatches: records
    .filter((r) => r.receipt_consistent === false || r.receipt_query_matches === false)
    .map((r) => [r.task_id, r.condition]),
  tasks: selected.map((t: any) => ({
    id: t.id,
    family: t.family,
    reused_source: t.reused_source,
    rows: records
      .filter((r) => r.task_id === t.id)
      .map((r) => ({
        condition: r.condition,
        status: r.status,
        initial_offered: r.initial_viewport_offered,
        offered: r.offered,
        relation_exposure: r.relation_exposure,
        actual_input: r.actual_input,
        wrong_input: r.wrong_target_input,
        goal_attained: r.goal_attained,
        receipt: r.queried_receipt?.outcome,
        code: r.queried_receipt?.code,
        error: r.error,
        relation_mutated: r.relation_mutated,
        replay_no_extra_events: r.before_replay
          ? JSON.stringify(r.before_replay) === JSON.stringify(r.after_replay)
          : undefined,
      })),
  })),
};
await save(join(out, "summary.json"), summary);
await save(join(out, "resource-errors.json"), resourceErrors);
