import type { CliView } from "./model-input.ts";
import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { connectBrowser, parseBrowserUrl } from "../../src/browser/connect.ts";
import { mutation, oracleExpression, pages, score } from "./design.ts";
import {
  fixtures,
  freeze,
  hash,
  inspectOwnedTab,
  invokeCli,
  methodFiles,
} from "./runtime.ts";

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { out: { type: "string" } } });
  if (!values.out) throw new Error("--out must be a new output directory");
  const out = resolve(values.out);
  await mkdir(out, { recursive: true });
  const extra = [
    "evals/cli-contract-v1/scope-run.ts",
    "evals/cli-contract-v1/scope-protocol.md",
    "evals/cli-contract-v1/model-input.ts",
  ];
  const browserUrl = "http://127.0.0.1:9333";
  const manifest = await freeze(
    out,
    ((await (await fetch(`${browserUrl}/json/version`)).json()) as { Browser: string })
      .Browser,
    extra,
  );
  const pageSet = pages().filter((page) => page.state === 0 && page.skeleton === 0);
  const server = await fixtures(pageSet);
  const directory = await mkdtemp(join(tmpdir(), "prism-scope-"));
  const path = join(out, "scope-records.jsonl");
  await writeFile(path, "", { flag: "wx" });
  const rows: any[] = [];
  try {
    for (const page of pageSet)
      for (const goal of ["group", "entity"] as const)
        for (const policy of ["always-relations", "always-local", "task-type-rule"]) {
          const connection = await connectBrowser(parseBrowserUrl(browserUrl));
          let session: string | undefined;
          const url = server.url(page);
          try {
            const opened = await invokeCli(directory, [
              "session",
              "open",
              "--url",
              url,
              "--browser-url",
              browserUrl,
            ]);
            if (!opened.ok) throw new Error(JSON.stringify(opened));
            session = (opened.data as { session: string }).session;
            const observed = await invokeCli(directory, [
              "observe",
              "--session",
              session,
              "--scope",
              "relations",
            ]);
            if (!observed.ok) throw new Error(JSON.stringify(observed));
            const view = observed.data as CliView;
            const nodes = await inspectOwnedTab(
              connection,
              url,
              "Object.fromEntries([...window.__jevFast.nodes].map(([id,e])=>[id,e.dataset?.entity??null]))",
            );
            const target = view.targets.find(
              (item) =>
                item.operation === "click" &&
                nodes[Number(item.ref.split(":").at(-1)!.slice(1))] === page.target,
            );
            if (!target) throw new Error("Fixed initial target was not offered");
            const scope =
              policy === "always-local" ||
              (policy === "task-type-rule" && goal === "entity")
                ? "local"
                : "relations";
            let evidence = view.evidence;
            let selectedView: unknown = view;
            if (scope === "local") {
              const local = await invokeCli(directory, [
                "context",
                "--session",
                session,
                "--observation",
                view.observation,
                "--target",
                target.ref,
                "--scope",
                "local",
              ]);
              if (!local.ok) throw new Error(JSON.stringify(local));
              evidence = (local.data as { evidence: string }).evidence;
              selectedView = local.data;
            }
            await inspectOwnedTab(
              connection,
              url,
              `window.__studyOriginal=document.querySelector('button[data-entity="${page.target}"]');true`,
            );
            const slot = page.entities.indexOf(page.target);
            await inspectOwnedTab(connection, url, mutation("swap-groups", slot));
            const before = await inspectOwnedTab(
              connection,
              url,
              oracleExpression(slot),
            );
            const command = {
              command: "act",
              session,
              observation: view.observation,
              target: target.ref,
              evidence,
              operation: "click",
              request_id: "scope-choice",
            };
            const reply = await invokeCli(directory, ["act", "--stdin"], command);
            const after = await inspectOwnedTab(
              connection,
              url,
              oracleExpression(slot),
            );
            const receipt = (
              reply.data as { receipt: { outcome: string; code: string } }
            ).receipt;
            if (!receipt || !after.headings_match_state)
              throw new Error("Missing receipt or inconsistent oracle");
            const row = {
              page,
              goal,
              policy,
              selected_scope: scope,
              initial_observation: view,
              selected_view: selectedView,
              command,
              reply,
              before,
              after,
              ...score(page, goal, before, after, receipt.outcome),
            };
            rows.push(row);
            await appendFile(path, `${JSON.stringify(row)}\n`);
          } finally {
            if (session)
              await invokeCli(directory, ["session", "close", "--session", session]);
            await connection.close();
          }
        }
  } finally {
    await invokeCli(directory, ["daemon", "stop"]).catch(() => {});
    await server.close();
    for (const name of ["receipts", "events"])
      await cp(join(directory, name), join(out, "cli-state", name), {
        recursive: true,
      }).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
  const table = ["group", "entity"].flatMap((goal) =>
    ["always-relations", "always-local", "task-type-rule"].map((policy) => {
      const group = rows.filter((row) => row.goal === goal && row.policy === policy);
      return {
        goal,
        policy,
        cells: group.length,
        wrong_inputs: group.filter((row) => row.wrong_clicks > 0).length,
        false_rejections: group.filter((row) => row.false_rejection).length,
        attained: group.filter((row) => row.oracle_attained).length,
      };
    }),
  );
  const result = {
    study: "cli-selected-evidence-v1",
    kind: "prospective follow-up to a post-hoc question; fixed-controller program behavior",
    complete: rows.length === 24,
    model_calls: 0,
    method_unchanged:
      JSON.stringify(await methodFiles(extra)) === JSON.stringify(manifest.files),
    source_sha256: hash(await readFile(path)),
    table,
  };
  await writeFile(join(out, "scope-summary.json"), JSON.stringify(result, null, 2), {
    flag: "wx",
  });
  console.log(JSON.stringify(result));
}
if (process.argv[1]?.endsWith("cli-contract-v1/scope-run.ts"))
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
