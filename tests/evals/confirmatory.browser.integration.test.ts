import type { BrowserConnection } from "../../src/browser/connect.ts";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { normalizeDescription } from "../../evals/runners/adaptive.ts";
import { startFixtures } from "../../evals/runners/fixtures.ts";
import { modelInput, resolveSelector, visibleDom } from "../../evals/runners/model.ts";
import { loadRecords } from "../../evals/runners/report.ts";
import { actionEvidence, formatTarget } from "../../evals/runners/representation.ts";
import { runOne } from "../../evals/runners/run.ts";
import { cohortSchema, parseTasks } from "../../evals/schema.ts";
import { evaluateSuccess, readEvidence } from "../../evals/success.ts";
import { connectBrowser, parseBrowserUrl } from "../../src/browser/connect.ts";
import { openBrowserSession } from "../../src/browser/session.ts";

describe.runIf(process.env.PRISM_EVAL_CHROME === "1")(
  "confirmatory fixture and outcome controls (no live-model calls)",
  () => {
    let connection: BrowserConnection;
    let fixtures: Awaited<ReturnType<typeof startFixtures>>;
    let directory: string;
    const tasks = readFile("evals/tasks/paper-confirmatory-v1.json", "utf8").then((s) =>
      parseTasks(JSON.parse(s)),
    );
    beforeAll(async () => {
      fixtures = await startFixtures();
      directory = await mkdtemp(join(tmpdir(), "prism-confirmatory-test-"));
      connection = await connectBrowser(
        parseBrowserUrl(process.env.PRISM_IT_BROWSER_URL ?? "http://127.0.0.1:9333"),
      );
    });
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });
    afterAll(async () => {
      await connection?.close();
      await fixtures?.close();
      if (directory) await rm(directory, { recursive: true, force: true });
    });
    it("verifies target minima, public context, all twelve correct inputs, and irreversible wrong-input audits", async () => {
      for (const task of await tasks)
        for (const wrong of [false, true]) {
          const session = await openBrowserSession({
            url: new URL(task.url, fixtures.url).href,
            client: connection.client,
          });
          try {
            const snapshot = await session.observe();
            const evidence = await actionEvidence(session, snapshot);
            const correct = await resolveSelector(
              session,
              snapshot,
              "[data-correct]",
              "CLICK",
              null,
            );
            const target = snapshot.actions.find((a) => a.node === correct.node)!;
            const candidates = snapshot.actions.filter((a) => a.kind === "click");
            const level = task.preregistered!.minimum_level;
            const description = (a: typeof target, l: typeof level) =>
              normalizeDescription(
                formatTarget("", a, l, evidence.contexts[String(a.node)]),
              );
            expect(
              candidates.filter(
                (a) => description(a, level) === description(target, level),
              ),
              task.id,
            ).toHaveLength(1);
            if (level === "local")
              expect(
                candidates.filter(
                  (a) => description(a, "compact") === description(target, "compact"),
                ).length,
              ).toBeGreaterThan(1);
            if (level === "structural")
              expect(
                candidates.filter(
                  (a) => description(a, "local") === description(target, "local"),
                ).length,
              ).toBeGreaterThan(1);
            const adaptive = modelInput(
              { goal: task.goal, history: [], snapshot },
              false,
              null,
              "adaptive",
              evidence,
            );
            const dom = await visibleDom(session);
            expect(JSON.stringify([adaptive.targets, evidence, dom.dom])).not.toMatch(
              /data-correct|data-target|data-description|eval-state/,
            );
            // Do not require Adaptive to agree with minimum annotations.
            if (task.id === "paper-local-04")
              expect(adaptive.adaptive!.final_level).toBe("structural");
            const chosen = wrong
              ? candidates.find((a) => a.node !== correct.node)!
              : correct;
            await session.act(chosen, snapshot);
            await session.observe();
            const oracle = await readEvidence(session, task.success);
            expect(evaluateSuccess(oracle, task.success), task.id).toBe(!wrong);
            if (wrong) {
              expect(oracle.wrong_targets).toBe(1);
              const fresh = await session.observe();
              const repair = await resolveSelector(
                session,
                fresh,
                "[data-correct]",
                "CLICK",
                null,
              );
              await session.act(repair, fresh);
              await session.observe();
              expect(
                evaluateSuccess(
                  await readEvidence(session, task.success),
                  task.success,
                ),
              ).toBe(false);
            }
          } finally {
            await session.close();
          }
        }
    }, 60000);
    it("records correct click followed by three preregistered provider timeouts as grounding true/strict false", async () => {
      const cohort = cohortSchema.parse(
        JSON.parse(await readFile("evals/cohorts/paper-confirmatory-v1.json", "utf8")),
      );
      vi.stubEnv(cohort.apiKeyEnv, "unit-test-placeholder");
      let calls = 0;
      vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
        calls++;
        if (calls > 1) throw new DOMException("Simulated timeout", "TimeoutError");
        const request = JSON.parse(String(init.body));
        const input = JSON.parse(request.messages[1].content);
        const target = Object.keys(input.targets.CLICK).find((id) =>
          input.targets.CLICK[id].includes('"Save profile"'),
        )!;
        const head = (choice: string, keys: string[]) => ({
          choice,
          probabilities: Object.fromEntries(keys.map((k) => [k, k === choice ? 1 : 0])),
          confidence: 1,
        });
        return new Response(
          JSON.stringify({
            model: cohort.model,
            usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    operation: head("CLICK", Object.keys(input.operations)),
                    target: head(target, Object.keys(input.targets.CLICK)),
                    text: null,
                  }),
                },
              },
            ],
          }),
        );
      });
      const output = join(directory, "timeout.jsonl");
      const result = await runOne({
        connection,
        fixtureUrl: fixtures.url,
        task: (await tasks)[0]!,
        variant: "indexed-local",
        provider: "model",
        experimentId: randomUUID(),
        repetition: 0,
        output,
        metadata: {
          source_hash: "test",
          fixture_hash: "test",
          browser_version: cohort.browserVersion,
          git_commit: null,
          git_dirty: null,
        },
        timeoutMs: 15000,
        cohort,
      });
      expect(result).toMatchObject({
        grounding_success: true,
        strict_task_success: false,
        success: false,
        steps: 1,
        llm_calls: 4,
        http_retries: 2,
        failure_type: "PROVIDER_TIMEOUT",
        infrastructure_failures: ["PROVIDER_TIMEOUT"],
        total_tokens: null,
      });
      const records = await loadRecords([output]);
      expect(records.filter((r) => r.record_type === "summary")).toHaveLength(1);
      const failures = records
        .filter((r) => r.record_type === "step")
        .flatMap((r) =>
          r.record_type === "step" ? (r.infrastructure_events ?? []) : [],
        );
      expect(failures.map((r) => r.attempt)).toEqual([1, 2, 3]);
    }, 30000);
  },
);
