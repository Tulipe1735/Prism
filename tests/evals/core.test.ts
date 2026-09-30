import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyFailure } from "../../evals/failures.ts";
import { parseOptions } from "../../evals/runners/cli.ts";
import { Collector } from "../../evals/runners/collector.ts";
import { startFixtures } from "../../evals/runners/fixtures.ts";
import { generateReport, loadResults } from "../../evals/runners/report.ts";
import { health, variability } from "../../evals/runners/statistics.ts";
import {
  parseTasks,
  stepSchema,
  summarySchema,
  taskSchema,
} from "../../evals/schema.ts";
import { evaluateSuccess, readEvidence } from "../../evals/success.ts";
import {
  BrowserSession,
  ExecutionError,
  StalePageError,
} from "../../src/browser/session.ts";
import { InvalidActionError, ModelOutputError } from "../../src/shared/errors.ts";

const task = taskSchema.parse({
  id: "grounding-001",
  url: "/grounding/repeated-delete.html",
  goal: "Delete B",
  category: "grounding",
  success: {
    checks: [{ kind: "text", selector: "#result", equals: "Done" }],
    wrongTargetCounter: { selector: "#audit", attribute: "data-wrong" },
  },
});
const evidence = {
  checks: [{ expected: "Done", actual: "Done", passed: true }],
  wrong_targets: 0,
  mutation_count: 0,
};
const identity = {
  schema_version: 3 as const,
  experiment_id: randomUUID(),
  task_id: task.id,
  run_id: randomUUID(),
  variant: "prism-full" as const,
  provider: "scripted" as const,
  category: task.category,
  repetition: 0,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function summary(overrides: Partial<ReturnType<typeof summarySchema.parse>> = {}) {
  return summarySchema.parse({
    ...identity,
    record_type: "summary",
    success: true,
    status: "done",
    reason: "DONE",
    steps: 1,
    attempts: 1,
    invalid_actions: 0,
    invalid_outputs: 0,
    invalid_selectors: 0,
    selector_attempts: 0,
    target_attempts: 1,
    scored_target_attempts: 1,
    correct_target_selections: 1,
    grounding_errors: 0,
    input_tokens: null,
    output_tokens: null,
    total_tokens: null,
    wrong_target_actions: 0,
    grounding_observed_actions: 1,
    decision_calls: 2,
    llm_calls: 0,
    retries: 0,
    http_retries: 0,
    stale_events: 0,
    stale_recoveries: 0,
    latency_ms: 100,
    failure_type: null,
    evidence,
    final_url: "http://localhost/",
    representation_observations: 0,
    representation_candidates_total: 0,
    representation_chars_total: 0,
    representation_estimated_tokens_total: 0,
    metadata: {
      started_at: "2026-09-30T00:00:00Z",
      task_hash: "task",
      fixture_hash: "fixture",
      source_hash: "source",
      git_commit: null,
      git_dirty: null,
      node_version: "v22",
      prism_version: "0.1.4",
      browser_version: null,
      model: "scripted-typesafe",
      text_model: "scripted-text",
      max_steps: 8,
      timeout_ms: 60000,
      cohort: null,
      cohort_hash: null,
      system_prompt_hash: null,
      task_prompt_hash: "test",
      policy: "typesafe-scripted",
      representation: "role",
      returned_models: [],
    },
    ...overrides,
  });
}

describe("evaluation task parser", () => {
  it("loads the actual CLI under Node's strip-only runtime", () => {
    const output = execFileSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--disable-warning=ExperimentalWarning",
        "evals/runners/cli.ts",
        "--list",
      ],
      { encoding: "utf8" },
    );
    expect(output).toContain("grounding-001");
    expect(output).toContain("stale-006");
  });
  it("loads at least five grounding and five stale tasks with unique ids", async () => {
    const tasks = parseTasks(
      JSON.parse(
        await readFile(new URL("../../evals/tasks/core.json", import.meta.url), "utf8"),
      ),
    );
    expect(
      tasks.filter((item) => item.category === "grounding").length,
    ).toBeGreaterThanOrEqual(5);
    expect(
      tasks.filter((item) => item.category === "stale").length,
    ).toBeGreaterThanOrEqual(5);
  });
  it("rejects duplicates, unknown fields, invalid categories, URLs, budgets and empty checks", () => {
    expect(() => parseTasks([task, task])).toThrow(/Duplicate/);
    for (const change of [
      { extra: true },
      { category: "unknown" },
      { url: "javascript:alert(1)" },
      { url: "//external.test" },
      { maxSteps: 0 },
      { success: { checks: [] } },
    ])
      expect(taskSchema.safeParse({ ...task, ...change }).success).toBe(false);
  });
  it("validates CLI filters, variants and positive repeats", () => {
    expect(
      parseOptions(["--category", "stale", "--variant", "all", "--repeat", "2"])
        .variants,
    ).toHaveLength(9);
    expect(parseOptions(["--variant", "raw-selector"]).variants).toEqual([
      "raw-selector",
    ]);
    expect(() => parseOptions(["--repeat", "0"])).toThrow();
    expect(() => parseOptions(["--timeout-ms", "2147483648"])).toThrow();
  });
});

describe("machine success oracle", () => {
  it("requires every check and zero known wrong clicks, including after apparent success", () => {
    expect(evaluateSuccess(evidence, task.success)).toBe(true);
    expect(evaluateSuccess({ ...evidence, wrong_targets: 1 }, task.success)).toBe(
      false,
    );
    expect(evaluateSuccess({ ...evidence, wrong_targets: null }, task.success)).toBe(
      false,
    );
    expect(evaluateSuccess({ ...evidence, checks: [] }, task.success)).toBe(false);
    expect(
      evaluateSuccess(
        { ...evidence, checks: [{ expected: "Done", actual: "Wrong", passed: true }] },
        task.success,
      ),
    ).toBe(false);
    expect(
      evaluateSuccess(
        { ...evidence, checks: [{ expected: "Done", actual: null, passed: false }] },
        task.success,
      ),
    ).toBe(false);
  });
  it("uses the existing session for a read-only DOM oracle and rejects evaluation errors", async () => {
    const send = vi.fn().mockResolvedValue({ result: { value: evidence } });
    const session = new BrowserSession({ send }, "target", "session");
    expect(await readEvidence(session, task.success)).toEqual(evidence);
    expect(send.mock.calls[0]?.[0]).toBe("Runtime.evaluate");
    expect(send.mock.calls[0]?.[1].expression).toContain("document.querySelector");
    send.mockResolvedValueOnce({ exceptionDetails: { text: "navigating" } });
    await expect(readEvidence(session, task.success)).rejects.toThrow(/oracle/);
  });
});

describe("failure classification", () => {
  it("uses concrete evidence and typed errors before generic runtime phases", () => {
    const cases = [
      { error: new InvalidActionError(), expected: "INVALID_ACTION" },
      { error: new ModelOutputError(), expected: "MODEL_OUTPUT_ERROR" },
      {
        error: new Error(
          "TypeSafe decision model returned invalid JSON; no action executed.",
        ),
        expected: "MODEL_OUTPUT_ERROR",
      },
      { error: new StalePageError("Target changed"), expected: "STALE_TARGET" },
      { error: new StalePageError("Document changed"), expected: "NAVIGATION_RACE" },
      { error: new ExecutionError(), expected: "EXECUTION_ERROR" },
    ];
    for (const item of cases)
      expect(classifyFailure({ task, error: item.error })).toBe(item.expected);
    expect(classifyFailure({ task, reason: "Model-call budget reached." })).toBe(
      "BUDGET_EXCEEDED",
    );
    expect(classifyFailure({ task, stage: "observation" })).toBe("OBSERVATION_ERROR");
    expect(classifyFailure({ task, stage: "decision" })).toBe("DECISION_ERROR");
    expect(classifyFailure({ task })).toBe("UNKNOWN");
    expect(
      classifyFailure({
        task,
        evidence: { ...evidence, wrong_targets: 1 },
        error: new ExecutionError(),
      }),
    ).toBe("ACTION_GROUNDING_ERROR");
    expect(
      classifyFailure({
        task: { category: "ambiguity" },
        evidence: { ...evidence, wrong_targets: 1 },
      }),
    ).toBe("SEMANTIC_AMBIGUITY");
  });
});

describe("attempt metrics", () => {
  it("records abandoned decisions, retries, and recovery without conflating model output and target validity", () => {
    const collector = new Collector(identity, evidence);
    collector.begin(1);
    collector.response(
      {
        questions: {
          operation: { criteria: { CLICK: "click" } },
          click_target: { criteria: { "1": {}, "2": {} } },
        },
      },
      {
        model: "test",
        answers: {
          operation: { choice: "CLICK", confidence: 1, probabilities: { CLICK: 1 } },
          click_target: {
            choice: "2",
            confidence: 1,
            probabilities: { "1": 1, "2": 0 },
          },
        },
      },
    );
    collector.stale({ step: 1, stage: "execution", reason: "Target changed" }, true);
    collector.begin(1);
    collector.executed(evidence);
    collector.finish();
    const rows = collector.rows.map((row) => stepSchema.parse(row));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      valid: true,
      validation_valid: false,
      executed: false,
      retry_count: 1,
      stale_events: 1,
      stale_recoveries: 1,
    });
    expect(rows[1]).toMatchObject({
      executed: true,
      wrong_target: false,
      llm_calls: 0,
    });
  });
});

describe("fixture server", () => {
  it("serves fixtures and support script, refusing unknown files and traversal", async () => {
    const server = await startFixtures();
    try {
      expect((await fetch(`${server.url}/grounding/repeated-delete.html`)).status).toBe(
        200,
      );
      expect(await (await fetch(`${server.url}/support.js`)).text()).toContain(
        "__prismEval",
      );
      expect((await fetch(`${server.url}/missing.html`)).status).toBe(404);
      expect((await fetch(`${server.url}/%2e%2e%2fschema.ts`)).status).toBe(404);
    } finally {
      await server.close();
    }
  });
});

describe("report generation", () => {
  it("reports repeat variance and separates infrastructure health from model task failure", () => {
    const repeated = [
      summary(),
      summary({
        run_id: randomUUID(),
        repetition: 1,
        success: false,
        failure_type: "MODEL_OUTPUT_ERROR",
        reason: "Invalid model output",
      }),
    ];
    expect(variability(repeated)).toEqual([
      {
        task: task.id,
        variant: "prism-full",
        runs: 2,
        successMixed: true,
        behaviorMixed: true,
      },
    ]);
    expect(health(repeated, 2).healthy).toBe(true);
    expect(health(repeated, 3).healthy).toBe(false);
    expect(
      health([summary({ reason: "Eval model returned HTTP 400" })], 1).healthy,
    ).toBe(false);
    const report = generateReport(repeated);
    expect(report).toContain("1/1 task/variant groups have mixed success");
    expect(report).toContain("Wilson 95% CI");
    expect(report).toContain("Task-cluster 95% CI");
  });
  it("computes success rates and only averages steps for successful runs", () => {
    const failed = summary({
      run_id: randomUUID(),
      task_id: "grounding-002",
      success: false,
      steps: 8,
      failure_type: "BUDGET_EXCEEDED",
    });
    const report = generateReport([summary(), failed]);
    expect(report).toContain("50.0% (1/2)");
    expect(report).toContain("BUDGET_EXCEEDED | 1");
    expect(report).toContain("n/a");
    expect(report).toContain("| 1.00 |");
    expect(
      generateReport([
        summary(),
        summary({
          run_id: randomUUID(),
          variant: "prism-no-validation",
          task_id: "other",
        }),
      ]),
    ).toContain("cohorts differ");
  });
  it("identifies invalid records by line and refuses overlapping inputs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "prism-eval-report-"));
    try {
      const path = join(directory, "result.jsonl");
      await writeFile(path, `${JSON.stringify(summary())}\n`);
      expect(await loadResults([path])).toHaveLength(1);
      await expect(loadResults([path, path])).rejects.toThrow(/Duplicate run/);
      await writeFile(path, "{broken}\n");
      await expect(loadResults([path])).rejects.toThrow(/:1:/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
