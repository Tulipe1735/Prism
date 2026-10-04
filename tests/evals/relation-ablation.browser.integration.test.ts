import type { ExperimentTask } from "../../evals/relation-ablation/schema.ts";
import type { BrowserConnection } from "../../src/browser/connect.ts";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { armPayload, observeRelations } from "../../evals/relation-ablation/input.ts";
import { armCost } from "../../evals/relation-ablation/relations.ts";
import { runCell } from "../../evals/relation-ablation/run.ts";
import {
  parseExperimentCohort,
  parseExperimentTasks,
} from "../../evals/relation-ablation/schema.ts";
import { startFixtures } from "../../evals/runners/fixtures.ts";
import { resolveSelector } from "../../evals/runners/model.ts";
import { actionEvidence, formatTarget } from "../../evals/runners/representation.ts";
import { connectBrowser, parseBrowserUrl } from "../../src/browser/connect.ts";
import { openBrowserSession } from "../../src/browser/session.ts";

interface PlanCode {
  code: string;
  url: string;
  entity: string;
  group: string;
  position: number;
  targetPair: number;
  tasks: { condition: "local" | "group"; id: string }[];
}

interface PlanPage {
  page: string;
  family: string;
  codes: PlanCode[];
}

interface PlanRow {
  id: string;
  page: string;
  condition: "local" | "group";
  position: number;
  entity: string;
  group: string;
}

describe.runIf(process.env.PRISM_EVAL_CHROME === "1")(
  "relation ablation fixture controls (no live-model calls)",
  () => {
    let connection: BrowserConnection;
    let fixtures: Awaited<ReturnType<typeof startFixtures>>;
    const tasks = readFile("evals/tasks/relation-ablation-v1.json", "utf8").then(
      (value) => parseExperimentTasks(JSON.parse(value)),
    );
    const plan = readFile("evals/relation-ablation/plan.json", "utf8").then(
      (value) => JSON.parse(value) as { pages: PlanPage[]; tasks: PlanRow[] },
    );
    beforeAll(async () => {
      fixtures = await startFixtures();
      connection = await connectBrowser(
        parseBrowserUrl(process.env.PRISM_IT_BROWSER_URL ?? "http://127.0.0.1:9333"),
      );
    });
    afterAll(async () => {
      await connection?.close();
      await fixtures?.close();
    });
    it("verifies the frozen position table, group binding and oracle on all 24 pages", async () => {
      const { pages } = await plan;
      const baseSignatures = new Set<string>();
      const all = await tasks;
      const byId = new Map(all.map((task) => [task.id, task] as const));
      for (const page of pages) {
        for (const code of page.codes) {
          for (const task of code.tasks)
            expect(byId.get(task.id), task.id).toBeDefined();
          const session = await openBrowserSession({
            url: new URL(code.url, fixtures.url).href,
            client: connection.client,
          });
          try {
            const snapshot = await session.observe();
            if (code.code === "a") {
              const signature = await session.call("Runtime.evaluate", {
                expression:
                  "[...document.querySelector('#controls').querySelectorAll('*')].map(el => el.tagName + ':' + (el.getAttribute('role') || '')).join('|')",
                returnByValue: true,
              });
              baseSignatures.add(signature.result.value);
            }
            const controls = snapshot.actions.filter((a) => a.kind === "click");
            const target = await resolveSelector(
              session,
              snapshot,
              "[data-correct]",
              "CLICK",
              null,
            );
            // The offered candidate order in the snapshot equals the frozen position table.
            expect(controls.length, code.url).toBe(3);
            expect(
              controls.findIndex((a) => a.node === target.node) + 1,
              code.url,
            ).toBe(code.position);
            expect(controls.find((a) => a.node === target.node)!.label, code.url).toBe(
              code.entity,
            );
            const context = await actionEvidence(session, snapshot);
            const relations = await observeRelations(session, snapshot);
            // Local evidence never names a group; the relation rule attaches exactly one
            // group identity per candidate and all three tags are distinct.
            for (const action of controls) {
              expect(
                context.contexts[String(action.node)]?.context,
                code.url,
              ).not.toMatch(/Alpha|Beta|Gamma/);
              expect(relations[String(action.node)]?.length ?? 0, code.url).toBe(1);
            }
            const tags = new Set(
              controls.flatMap((a) =>
                (relations[String(a.node)] ?? []).map((r) => r.tag),
              ),
            );
            expect([...tags].sort(), code.url).toEqual([1, 2, 3]);
            const payloads = Object.fromEntries(
              [
                "indexed-local",
                "indexed-structural",
                "indexed-unbound",
                "indexed-bound",
              ].map((arm) => [
                arm,
                armPayload({
                  arm,
                  goal: byId.get(code.tasks[0]!.id)!.goal,
                  snapshot,
                  evidence: context,
                  relations,
                  history: [],
                }),
              ]),
            );
            expect(armCost(payloads["indexed-bound"]!)).toEqual(
              armCost(payloads["indexed-unbound"]!),
            );
            for (const arm of ["indexed-local", "indexed-structural"]) {
              for (const [id, value] of Object.entries(payloads[arm]!.targets.CLICK!)) {
                const action = controls[Number(id) - 1]!;
                expect(value, code.url).toBe(
                  formatTarget(
                    id,
                    action,
                    arm === "indexed-local" ? "local" : "structural",
                    context.contexts[String(action.node)],
                  ),
                );
              }
            }
            // Canonical group identifiers have no relation to candidate order.
            for (const action of controls) {
              const relation = relations[String(action.node)]![0]!;
              expect(relation.tag, code.url).toBe(
                ["Alpha", "Beta", "Gamma"].indexOf(relation.text) + 1,
              );
            }
            // The requested group's binding must sit on the control the oracle accepts.
            const boundText = relations[String(target.node)]![0]!.text;
            expect(boundText, code.url).toBe(code.group);
            // No oracle annotation is readable from the observation payload.
            expect(
              JSON.stringify([context, relations, snapshot.actions]),
              `${code.url} leaks an oracle marker`,
            ).not.toMatch(/data-correct|data-description|data-region/);
            // A wrong click is recorded irreversibly by the same oracle.
            const wrong = controls.find((a) => a.node !== target.node)!;
            await session.act(wrong, snapshot);
            await session.observe();
          } finally {
            await session.close();
          }
        }
      }
      expect(baseSignatures.size).toBe(8);
    }, 600_000);
    it("keeps the offered candidate set identical for both goal conditions of a page", async () => {
      const all = await tasks;
      const byUrl = new Map<string, ExperimentTask[]>();
      for (const task of all)
        byUrl.set(task.url, [...(byUrl.get(task.url) ?? []), task]);
      expect(byUrl.size).toBe(24);
      for (const [url, group] of byUrl) {
        expect(group.length, url).toBe(2);
        expect(new Set(group.map((task) => task.goal)).size, url).toBe(2);
        const session = await openBrowserSession({
          url: new URL(url, fixtures.url).href,
          client: connection.client,
        });
        try {
          const snapshot = await session.observe();
          const controls = snapshot.actions.filter((a) => a.kind === "click");
          expect(controls.map((a) => a.label).sort(), url).toEqual([
            "Item 12",
            "Item 31",
            "Item 7",
          ]);
          const relations = await observeRelations(session, snapshot);
          const union = new Set(
            Object.values(relations)
              .flat()
              .map((entry) => entry.text),
          );
          expect([...union].sort(), url).toEqual(["Alpha", "Beta", "Gamma"]);
        } finally {
          await session.close();
        }
      }
    }, 600_000);
    it("balances position, entity and group across the frozen design table", async () => {
      const { tasks: rows } = await plan;
      const all = await tasks;
      expect(all.length).toBe(48);
      expect(rows.length).toBe(all.length);
      expect(new Set(rows.map((row) => row.id))).toEqual(
        new Set(all.map((task) => task.id)),
      );
      for (const condition of ["local", "group"] as const) {
        const selected = rows.filter((row) => row.condition === condition);
        expect(selected.length, condition).toBe(24);
        for (const position of [1, 2, 3])
          expect(
            selected.filter((row) => row.position === position).length,
            condition,
          ).toBe(8);
        for (const entity of ["Item 7", "Item 12", "Item 31"])
          expect(
            selected.filter((row) => row.entity === entity).length,
            condition,
          ).toBe(entity === "Item 31" ? 6 : 9);
        for (const group of ["Alpha", "Beta", "Gamma"])
          expect(selected.filter((row) => row.group === group).length, condition).toBe(
            8,
          );
      }
      // Within a page each position is requested once under each condition, so the
      // position table is balanced per page; the code letter is shared across pages.
      for (const page of new Set(rows.map((row) => row.page))) {
        const selected = rows.filter((row) => row.page === page);
        for (const condition of ["local", "group"] as const) {
          const strict = selected.filter((row) => row.condition === condition);
          expect(
            new Set(strict.map((row) => row.position)),
            `${page}/${condition}`,
          ).toEqual(new Set([1, 2, 3]));
          expect(strict.length, `${page}/${condition}`).toBe(3);
        }
      }
    });
    it("executes mock model choices and distinguishes grounding from strict completion", async () => {
      const task = (await tasks)[0]!;
      const configured = JSON.parse(
        await readFile("evals/cohorts/relation-ablation-v1-glm.json", "utf8"),
      );
      const browser = await connection.client.send("Browser.getVersion");
      const plan = parseExperimentCohort({
        ...configured,
        model: "offline-test",
        apiKeyEnv: "PRISM_OFFLINE_TEST_KEY",
        browserVersion: browser.product,
      });
      vi.stubEnv("PRISM_OFFLINE_TEST_KEY", "offline-not-a-service-key");
      try {
        for (const wrongAfterCorrect of [false, true]) {
          let calls = 0;
          const result = await runCell({
            connection,
            fixturesUrl: fixtures.url,
            plan,
            task,
            arm: "indexed-bound",
            provider: "model",
            experimentId: "00000000-0000-4000-8000-000000000001",
            fixtureHash: "offline",
            sourceHash: "offline",
            fetchImpl: async (_url, init) => {
              const request = JSON.parse(String(init?.body));
              const payload = JSON.parse(request.messages[1].content);
              const operation =
                calls === 0 || (wrongAfterCorrect && calls === 1) ? "CLICK" : "DONE";
              const offered = Object.entries(payload.targets.CLICK ?? {}) as [
                string,
                string,
              ][];
              const correct = offered.find(([, line]) =>
                line.includes(JSON.stringify(task.design.entity)),
              );
              const target = calls === 0 ? correct?.[0] : offered[0]?.[0];
              const head = (choice: string, keys: string[]) => ({
                choice,
                confidence: 1,
                probabilities: Object.fromEntries(
                  keys.map((key) => [key, Number(key === choice)]),
                ),
              });
              calls++;
              return Response.json({
                model: "offline-test",
                usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        operation: head(operation, Object.keys(payload.operations)),
                        target:
                          operation === "CLICK"
                            ? head(target!, Object.keys(payload.targets.CLICK))
                            : null,
                        text: null,
                      }),
                    },
                  },
                ],
              });
            },
          });
          expect(result.grounding_success).toBe(true);
          expect(result.strict_task_success).toBe(!wrongAfterCorrect);
          expect(result.success).toBe(!wrongAfterCorrect);
          expect(result.wrong_targets).toBe(Number(wrongAfterCorrect));
          expect(result.llm_calls).toBe(wrongAfterCorrect ? 3 : 2);
          expect(result.trace.filter((step) => step.executed)).toHaveLength(
            wrongAfterCorrect ? 2 : 1,
          );
        }
      } finally {
        vi.unstubAllEnvs();
      }
    }, 60_000);
  },
);
