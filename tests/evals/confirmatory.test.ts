import type { StepRecord, SummaryRecord } from "../../evals/schema.ts";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { classifyFailure, ProviderFailureError } from "../../evals/failures.ts";
import { pairKey, schedule } from "../../evals/runners/cohort.ts";
import {
  assertControls,
  verifyCompletedCells,
} from "../../evals/runners/confirmatory-controls.ts";
import {
  pairedEffect,
  policyDiagnostic,
} from "../../evals/runners/confirmatory-report.ts";
import { firstGroundingSuccess } from "../../evals/runners/run.ts";
import { cohortSchema, parseTasks, summarySchema } from "../../evals/schema.ts";

const tasks = parseTasks(
  JSON.parse(await readFile("evals/tasks/paper-confirmatory-v1.json", "utf8")),
);
const cohort = cohortSchema.parse(
  JSON.parse(await readFile("evals/cohorts/paper-confirmatory-v1.json", "utf8")),
);
const sample = summarySchema.parse({
  schema_version: 3,
  experiment_id: "00000000-0000-4000-8000-000000000001",
  task_id: "fixture",
  run_id: "00000000-0000-4000-8000-000000000002",
  variant: "indexed-adaptive",
  provider: "model",
  category: "grounding",
  repetition: 0,
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
  evidence: null,
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
});
const run = (
  task_id: string,
  variant: SummaryRecord["variant"],
  repetition: number,
  grounding_success: boolean,
  strict_task_success = grounding_success,
): SummaryRecord => ({
  ...sample,
  task_id,
  variant,
  repetition,
  grounding_success,
  strict_task_success,
  success: strict_task_success,
  metadata: { ...sample.metadata, cohort },
});

it("fixes 240 distinct annotated cells with four tasks in each stratum", () => {
  const plan = schedule(tasks, cohort).map((p) =>
    pairKey({ task_id: p.task.id, ...p }),
  );
  expect(plan).toHaveLength(240);
  expect(new Set(plan).size).toBe(240);
  for (const ambiguity_class of ["unique", "local", "structural"])
    expect(
      tasks.filter((t) => t.preregistered?.ambiguity_class === ambiguity_class),
    ).toHaveLength(4);
  expect(cohort.variants).toEqual([
    "indexed-local",
    "indexed-structural",
    "indexed-adaptive",
    "raw-selector-reference",
  ]);
});
it("rejects frozen source, task annotation, prompt, model and environment drift", () => {
  const frozen = {
    source: "a",
    fixture: "a",
    task: { minimum: "local" },
    prompt: "a",
    model: "glm-5.3-flash",
    environment: { browser: "pinned", node: "v22" },
  };
  expect(() => assertControls(structuredClone(frozen), frozen)).not.toThrow();
  for (const key of Object.keys(frozen))
    expect(() => assertControls({ ...frozen, [key]: "changed" }, frozen)).toThrow(
      "drifted",
    );
});
it("retains failed terminal cells as completed and rejects duplicates/out-of-plan cells", () => {
  const failed = run(tasks[0]!.id, "indexed-adaptive", 0, false);
  const planned = schedule(tasks, cohort).map((p) =>
    pairKey({ task_id: p.task.id, ...p }),
  );
  expect(() => verifyCompletedCells([failed], planned)).not.toThrow();
  expect(() => verifyCompletedCells([failed, failed], planned)).toThrow("duplicate");
  expect(() => verifyCompletedCells([{ ...failed, repetition: 5 }], planned)).toThrow(
    "Invalid",
  );
  expect(() =>
    verifyCompletedCells([{ ...failed, grounding_success: undefined }], planned),
  ).toThrow("Invalid");
});
it("separates executed correct grounding from later terminal/provider failure", () => {
  const correct = {
    executed: true,
    target_assessment: "correct",
    wrong_target: false,
  } as StepRecord;
  const provider = {
    executed: false,
    target_assessment: null,
    wrong_target: null,
    failure_type: "PROVIDER_TIMEOUT",
  } as StepRecord;
  expect(firstGroundingSuccess([correct, provider])).toBe(true);
  expect(firstGroundingSuccess([provider])).toBe(false);
  expect(firstGroundingSuccess([{ ...correct, executed: false }])).toBe(false);
  expect(
    firstGroundingSuccess([
      { ...correct, target_assessment: "wrong", wrong_target: true },
      correct,
    ]),
  ).toBe(false);
  expect(
    classifyFailure({
      task: { category: "grounding" },
      error: new ProviderFailureError("PROVIDER_TIMEOUT", "timeout"),
      stage: "decision",
    }),
  ).toBe("PROVIDER_TIMEOUT");
});
it("averages matched repetitions inside task clusters and refuses missing usage or pairs", () => {
  const runs = [
    run("a", "indexed-adaptive", 0, true),
    run("a", "indexed-structural", 0, false),
    run("a", "indexed-adaptive", 1, false),
    run("a", "indexed-structural", 1, true),
    run("b", "indexed-adaptive", 0, true),
    run("b", "indexed-structural", 0, false),
  ];
  const result = pairedEffect(runs, "indexed-structural", (r) =>
    Number(r.grounding_success),
  )!;
  expect(result.difference).toBe(0.5);
  expect(result.clusters).toBe(2);
  expect(result.pairs).toBe(3);
  expect(result.per_task.map((r) => r.difference)).toEqual([0, 1]);
  expect(
    pairedEffect(runs.slice(0, -1), "indexed-structural", (r) =>
      Number(r.grounding_success),
    ),
  ).toBeNull();
  expect(pairedEffect(runs, "indexed-structural", () => null)).toBeNull();
});
it("labels target-relative expansion without treating wrong sufficient choices as under-expansion", () => {
  const r = run("a", "indexed-adaptive", 0, false);
  const step = {
    adaptive: {
      expected_minimum_level: "local",
      final_level: "structural",
      unresolved_ambiguity: false,
    },
  } as StepRecord;
  expect(policyDiagnostic(step, r)).toEqual({ over: true, under: false });
  expect(
    policyDiagnostic(
      { ...step, adaptive: { ...step.adaptive!, final_level: "compact" } },
      r,
    ),
  ).toEqual({ over: false, under: true });
  expect(
    policyDiagnostic(
      { ...step, adaptive: { ...step.adaptive!, final_level: "local" } },
      r,
    ),
  ).toEqual({ over: false, under: false });
  expect(
    policyDiagnostic(
      { ...step, adaptive: { ...step.adaptive!, final_level: "compact" } },
      { ...r, grounding_success: true },
    ),
  ).toEqual({ over: false, under: false });
});
