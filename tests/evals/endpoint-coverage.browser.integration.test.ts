import type { BrowserConnection } from "../../src/browser/connect.ts";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  classifyCoverage,
  inspectTask,
  startAuditSources,
} from "../../evals/endpoint-audit/coverage.ts";
import { externalAudit, type TaskMetadata } from "../../evals/external/audit.ts";
import { parseTasks } from "../../evals/schema.ts";
import { evaluateSuccess, readEvidence } from "../../evals/success.ts";
import { connectBrowser, parseBrowserUrl } from "../../src/browser/connect.ts";
import { openBrowserSession } from "../../src/browser/session.ts";

describe.runIf(process.env.PRISM_EVAL_CHROME === "1")(
  "independent external endpoint controls (no model)",
  () => {
    let connection: BrowserConnection;
    let sources: Awaited<ReturnType<typeof startAuditSources>>;
    const tasks = readFile("evals/tasks/external-validation-v1.json", "utf8").then(
      (s) => parseTasks(JSON.parse(s)),
    );
    const metadata = readFile("evals/external/task-metadata.json", "utf8").then(
      (s) => JSON.parse(s) as Record<string, TaskMetadata>,
    );
    beforeAll(async () => {
      sources = await startAuditSources(0);
      connection = await connectBrowser(
        parseBrowserUrl(process.env.PRISM_IT_BROWSER_URL ?? "http://127.0.0.1:9333"),
      );
    });
    afterAll(async () => {
      await connection?.close();
      await sources?.close();
    });

    it("proves that an offered ancestor activates the intended tab but the frozen audit calls it neutral", async () => {
      const task = (await tasks).find((t) => t.id === "external-tabs")!;
      const contract = (await metadata)[task.id]!;
      const audit = externalAudit(connection.client, contract);
      const session = await openBrowserSession({
        url: `${sources.url}${new URL(task.url).pathname}`,
        client: audit.client,
      });
      try {
        let snapshot = await session.observe();
        let coverage = await inspectTask(session, task, contract, snapshot);
        for (
          let attempt = 0;
          !coverage.legalAncestors.length && attempt < 20;
          attempt++
        ) {
          await new Promise((done) => setTimeout(done, 50));
          snapshot = await session.observe();
          coverage = await inspectTask(session, task, contract, snapshot);
        }
        expect(coverage.legalAncestors).toHaveLength(1);
        expect(
          evaluateSuccess(await readEvidence(session, task.success), task.success),
        ).toBe(false);
        const node = coverage.legalAncestors[0]!.node;
        const action = snapshot.actions.find(
          (a) => a.node === node && a.kind === "click",
        )!;
        const scored = await session.call("Runtime.evaluate", {
          expression: `(() => { const el=window.__jevFast.nodes.get(${node}); if(!el) return null; if(el.hasAttribute('data-correct')) return 'correct'; return 'neutral'; })()`,
          returnByValue: true,
        });
        expect(scored.result.value).toBe("neutral");
        await session.act(action, snapshot);
        const evidence = await readEvidence(session, task.success);
        expect(evaluateSuccess(evidence, task.success)).toBe(true);
        expect(audit.wrong()).toBe(0);
      } finally {
        await session.close();
      }
    });

    it("separates intentional multiple targets from a visible excluded password control", async () => {
      for (const id of ["external-billing-name", "external-signin-fields"]) {
        const task = (await tasks).find((t) => t.id === id)!;
        const contract = (await metadata)[id]!;
        const session = await openBrowserSession({
          url: `${sources.url}${new URL(task.url).pathname}`,
          client: connection.client,
        });
        try {
          let snapshot = await session.observe();
          let coverage = await inspectTask(session, task, contract, snapshot);
          for (let attempt = 0; !coverage.correctOffered && attempt < 20; attempt++) {
            await new Promise((done) => setTimeout(done, 50));
            snapshot = await session.observe();
            coverage = await inspectTask(session, task, contract, snapshot);
          }
          if (id === "external-billing-name") {
            expect(coverage.correct.matches).toBe(2);
            expect(coverage.correct.offered).toBe(2);
            expect(classifyCoverage([coverage])).toContain(
              "multi-target contract; inspect task stage",
            );
          } else {
            expect(coverage.correct.matches).toBe(3);
            expect(coverage.correct.offered).toBe(2);
            const visibility = await session.call("Runtime.evaluate", {
              expression:
                "document.querySelector('#floatingPassword').checkVisibility({checkOpacity:true,checkVisibilityCSS:true})",
              returnByValue: true,
            });
            expect(visibility.result.value).toBe(true);
            const offeredNodes = snapshot.actions.flatMap((a) =>
              a.node === undefined ? [] : [a.node],
            );
            const included = await session.call("Runtime.evaluate", {
              expression: `(${JSON.stringify(offeredNodes)}).some(id => window.__jevFast.nodes.get(id) === document.querySelector('#floatingPassword'))`,
              returnByValue: true,
            });
            expect(included.result.value).toBe(false);
          }
        } finally {
          await session.close();
        }
      }
    });
  },
);
