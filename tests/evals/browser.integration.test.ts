import type { BrowserConnection } from "../../src/browser/connect.ts";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFixtures } from "../../evals/runners/fixtures.ts";
import { modelInput, resolveSelector, visibleDom } from "../../evals/runners/model.ts";
import { loadResults } from "../../evals/runners/report.ts";
import {
  actionEvidence,
  filterModalObservation,
} from "../../evals/runners/representation.ts";
import { runOne } from "../../evals/runners/run.ts";
import { parseTasks } from "../../evals/schema.ts";
import { evaluateSuccess, readEvidence } from "../../evals/success.ts";
import { connectBrowser, parseBrowserUrl } from "../../src/browser/connect.ts";
import { openBrowserSession } from "../../src/browser/session.ts";

describe.runIf(process.env.PRISM_EVAL_CHROME === "1")("eval browser mechanisms", () => {
  let connection: BrowserConnection;
  let fixtures: Awaited<ReturnType<typeof startFixtures>>;
  let directory: string;
  const definitions = readFile(
    new URL("../../evals/tasks/core.json", import.meta.url),
    "utf8",
  ).then((value) => parseTasks(JSON.parse(value)));
  const metadata = {
    git_commit: null,
    git_dirty: null,
    fixture_hash: "test",
    source_hash: "test",
    browser_version: "integration-test",
  };
  beforeAll(async () => {
    fixtures = await startFixtures();
    directory = await mkdtemp(join(tmpdir(), "prism-evals-"));
    connection = await connectBrowser(
      parseBrowserUrl(process.env.PRISM_IT_BROWSER_URL ?? "http://127.0.0.1:9222"),
    );
  });
  afterAll(async () => {
    await connection?.close();
    await fixtures?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("verifies all 24 primary fixtures with independent correct inputs and hides oracle annotations", async () => {
    const tasks = parseTasks(
      JSON.parse(await readFile("evals/tasks/primary.json", "utf8")),
    );
    for (const task of tasks) {
      const session = await openBrowserSession({
        url: new URL(task.url, fixtures.url).href,
        client: connection.client,
      });
      try {
        await session.observe();
        const dom = await visibleDom(session);
        expect(dom.dom).not.toMatch(
          /data-correct|data-target|data-success|eval-state|<script/,
        );
        if (task.fixture?.mutateAfterDecision)
          await session.call("Runtime.evaluate", {
            expression: "window.__prismEval.mutate()",
          });
        if (task.category === "form") {
          const snapshot = await session.observe();
          const field = snapshot.actions.find((a) => a.kind === "fill")!;
          await session.act(field, snapshot, "Ada");
        }
        await session.call("Runtime.evaluate", {
          expression:
            "document.querySelector('#notice')?.open && document.querySelector('#notice').close()",
        });
        const snapshot = await session.observe();
        const correct = await resolveSelector(
          session,
          snapshot,
          "button[data-correct], a[data-correct]",
          "CLICK",
          null,
        );
        await session.act(correct, snapshot);
        await session.observe();
        expect(
          evaluateSuccess(await readEvidence(session, task.success), task.success),
          task.id,
        ).toBe(true);
        await expect(
          resolveSelector(session, await session.observe(), "[", "CLICK", null),
        ).rejects.toThrow("syntax");
      } finally {
        await session.close();
      }
    }
  }, 60000);

  it("extracts bounded public context and verifies all 16 ambiguity-study fixtures independently", async () => {
    const tasks = parseTasks(
      JSON.parse(await readFile("evals/tasks/ambiguity-study.json", "utf8")),
    );
    for (const task of tasks) {
      const session = await openBrowserSession({
        url: new URL(task.url, fixtures.url).href,
        client: connection.client,
      });
      try {
        const snapshot = await session.observe();
        const evidence = await actionEvidence(session, snapshot);
        expect(evidence.status).toBe("Pending");
        expect(JSON.stringify(evidence)).not.toMatch(
          /data-correct|data-target|data-wrong|eval-state/,
        );
        for (const ctx of Object.values(evidence.contexts)) {
          expect(ctx.context.length).toBeLessThanOrEqual(80);
          expect(ctx.nearby_text.length).toBeLessThanOrEqual(120);
          expect(ctx.section.length).toBeLessThanOrEqual(48);
        }
        const correct = await resolveSelector(
          session,
          snapshot,
          "[data-correct]",
          "CLICK",
          null,
        );
        const ctx = evidence.contexts[String(correct.node)]!;
        if (task.id === "grounding-study-001")
          expect(ctx).toMatchObject({
            context: "Item B | $29.99",
            container: "row",
            section: "Cart",
          });
        if (task.id === "grounding-study-007")
          expect(ctx).toMatchObject({ context: "Draft", section: "Team Beta" });
        if (task.id === "grounding-study-008")
          expect(snapshot.actions.filter((a) => a.node !== undefined)).toHaveLength(2);
        if (task.id === "grounding-study-009")
          expect(snapshot.actions.filter((a) => a.node !== undefined)).toHaveLength(2);
        await session.act(correct, snapshot);
        await session.observe();
        expect(
          evaluateSuccess(await readEvidence(session, task.success), task.success),
          task.id,
        ).toBe(true);
      } finally {
        await session.close();
      }
    }
  }, 60000);

  it("validates adaptive fixtures, eligibility and the independent oracle without model calls", async () => {
    const tasks = parseTasks(
      JSON.parse(await readFile("evals/tasks/ambiguity-adaptive-v1.json", "utf8")),
    );
    const expected: Record<string, string> = {
      "adaptive-001": "local",
      "adaptive-005": "local",
      "adaptive-007": "structural",
      "adaptive-008": "local",
      "adaptive-009": "local",
      "adaptive-012": "structural",
      "adaptive-013": "role",
      "adaptive-015": "local",
      "adaptive-016": "structural",
      "adaptive-101": "compact",
      "adaptive-102": "compact",
      "adaptive-103": "compact",
    };
    for (const task of tasks) {
      const session = await openBrowserSession({
        url: new URL(task.url, fixtures.url).href,
        client: connection.client,
      });
      try {
        const snapshot = await session.observe();
        const evidence = await actionEvidence(session, snapshot);
        const adaptive = modelInput(
          { goal: task.goal, history: [], snapshot },
          false,
          null,
          "adaptive",
          evidence,
        );
        expect(adaptive.adaptive!.final_level, task.id).toBe(expected[task.id]);
        expect(adaptive.adaptive!.unresolved_ambiguity, task.id).toBe(false);
        if (["adaptive-008", "adaptive-009"].includes(task.id))
          expect(adaptive.adaptive!.number_of_candidates).toBe(2);
        const dom = await visibleDom(session);
        expect(JSON.stringify([adaptive.targets, dom.dom])).not.toMatch(
          /data-correct|data-target|data-description|eval-state/,
        );
        const correct = await resolveSelector(
          session,
          snapshot,
          "[data-correct]",
          "CLICK",
          null,
        );
        await session.act(correct, snapshot);
        await session.observe();
        expect(
          evaluateSuccess(await readEvidence(session, task.success), task.success),
          task.id,
        ).toBe(true);
      } finally {
        await session.close();
      }
    }
  }, 60000);

  it("filters native-modal background controls while leaving the fixture and executor unchanged", async () => {
    const session = await openBrowserSession({
      url: `${fixtures.url}/stale/delayed-modal.html`,
      client: connection.client,
    });
    try {
      const before = await session.observe();
      expect(await filterModalObservation(session, before)).toBe(before);
      await session.call("Runtime.evaluate", {
        expression: "window.__prismEval.mutate()",
      });
      const observed = await session.observe();
      const filtered = await filterModalObservation(session, observed);
      expect(observed.actions.some((a) => a.label === "Save draft")).toBe(true);
      expect(
        filtered.actions.filter((a) => a.node !== undefined).map((a) => a.label),
      ).toEqual(["Dismiss update notice"]);
      await session.act(
        filtered.actions.find((a) => a.label === "Dismiss update notice")!,
        filtered,
      );
      const after = await session.observe();
      expect(
        (await filterModalObservation(session, after)).actions.some(
          (a) => a.label === "Save draft",
        ),
      ).toBe(true);
    } finally {
      await session.close();
    }
  });

  it("executes all core fixtures and distinguishes stale recovery and validation ablations", async () => {
    const tasks = await definitions;
    const output = join(directory, "results.jsonl");
    for (const task of tasks) {
      const run = (
        variant: "prism-full" | "prism-no-stale-recovery" | "prism-no-validation",
      ) =>
        runOne({
          task,
          variant,
          provider: "scripted",
          connection,
          fixtureUrl: fixtures.url,
          experimentId: randomUUID(),
          repetition: 0,
          output,
          metadata,
          timeoutMs: 10000,
        });
      const full = await run("prism-full");
      expect(full.llm_calls).toBe(0);
      if (task.fault) {
        expect(full).toMatchObject({
          success: false,
          steps: 0,
          invalid_outputs: 1,
          failure_type: "MODEL_OUTPUT_ERROR",
        });
        const disabled = await run("prism-no-validation");
        expect(disabled).toMatchObject({
          success: false,
          steps: 1,
          invalid_outputs: 1,
          wrong_target_actions: 1,
          failure_type: "ACTION_GROUNDING_ERROR",
        });
      } else if (task.id === "ambiguity-001") {
        expect(full).toMatchObject({
          success: false,
          wrong_target_actions: 1,
          failure_type: "SEMANTIC_AMBIGUITY",
        });
      } else {
        expect(full.success, `${task.id}: ${full.reason}`).toBe(true);
        if (task.category === "stale") {
          const noRecovery = await run("prism-no-stale-recovery");
          if (task.url.includes("reordering")) {
            expect(full.stale_events).toBe(0);
            expect(noRecovery.success).toBe(true);
          } else {
            expect(full.stale_events).toBeGreaterThan(0);
            expect(full.stale_recoveries).toBe(full.stale_events);
            expect(noRecovery).toMatchObject({
              success: false,
              steps: 0,
              retries: 0,
              stale_recoveries: 0,
              failure_type: "STALE_TARGET",
            });
          }
        }
      }
    }
    expect((await loadResults([output])).length).toBeGreaterThan(tasks.length);
  }, 60000);

  it("rejects false DONE and records an exhausted wall-clock budget", async () => {
    const task = (await definitions)[0]!;
    const options = {
      task,
      variant: "prism-full" as const,
      provider: "scripted" as const,
      connection,
      fixtureUrl: fixtures.url,
      experimentId: randomUUID(),
      repetition: 0,
      output: join(directory, "negative-controls.jsonl"),
      metadata,
      timeoutMs: 10000,
    };
    const falseDone = await runOne({
      ...options,
      task: {
        ...task,
        success: {
          ...task.success,
          checks: [{ kind: "text", selector: "#result", equals: "Never achieved" }],
        },
      },
    });
    expect(falseDone).toMatchObject({
      success: false,
      status: "done",
      failure_type: "DECISION_ERROR",
    });
    const timeout = await runOne({ ...options, timeoutMs: 1 });
    expect(timeout).toMatchObject({ success: false, failure_type: "BUDGET_EXCEEDED" });
    expect(await loadResults([options.output])).toHaveLength(2);
  });
});
