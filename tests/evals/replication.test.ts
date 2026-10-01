import type { StepRecord, SummaryRecord } from "../../evals/schema.ts";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import {
  controlDiff,
  ID,
  verifyCompletedCells,
} from "../../evals/replication/controls.ts";
import { responseDiagnostic } from "../../evals/replication/report.ts";
import { pairKey, schedule } from "../../evals/runners/cohort.ts";
import { cohortSchema, parseTasks } from "../../evals/schema.ts";

const parent = cohortSchema.parse(
  JSON.parse(await readFile("evals/cohorts/paper-confirmatory-v1.json", "utf8")),
);
const replication = cohortSchema.parse(
  JSON.parse(await readFile(`evals/cohorts/${ID}.json`, "utf8")),
);
const tasks = parseTasks(JSON.parse(await readFile(parent.tasks, "utf8")));
it("accepts only the preregistered model and artifact identity differences", () => {
  expect(controlDiff(parent, replication)).toEqual({
    expected: ["id", "model"],
    unexpected: [],
  });
  expect(controlDiff(parent, { ...replication, maxTokens: 16384 }).unexpected).toEqual([
    "maxTokens",
  ]);
  expect(controlDiff(parent, { ...replication, topP: 0.95 }).unexpected).toEqual([
    "topP",
  ]);
});
it("keeps the parent matched order and rejects duplicates, foreign cohorts and expanded plans", () => {
  const planned = schedule(tasks, replication).map((p) =>
    pairKey({ task_id: p.task.id, ...p }),
  );
  expect(planned).toHaveLength(240);
  expect(planned).toEqual(
    schedule(tasks, parent).map((p) => pairKey({ task_id: p.task.id, ...p })),
  );
  const run = {
    task_id: tasks[0]!.id,
    variant: "indexed-adaptive",
    repetition: 0,
    provider: "model",
    metadata: { cohort: replication },
    grounding_success: false,
    strict_task_success: false,
  } as SummaryRecord;
  expect(() => verifyCompletedCells([run], planned)).not.toThrow();
  expect(() => verifyCompletedCells([run, run], planned)).toThrow("duplicate");
  expect(() => verifyCompletedCells([{ ...run, repetition: 5 }], planned)).toThrow(
    "Invalid",
  );
  expect(() =>
    verifyCompletedCells(
      [{ ...run, metadata: { ...run.metadata, cohort: parent } }],
      planned,
    ),
  ).toThrow("Invalid");
});
it("distinguishes known reasoning exhaustion from unknown split and separates post-grounding failure", () => {
  const step = {
    run_id: "a",
    prompt_hash: "hash",
    raw_model_output: null,
    output_tokens: 8192,
    usage: [],
  } as unknown as StepRecord;
  const known = [
    {
      run_id: "a",
      prompt_hash: "hash",
      status: 200,
      usage: { completion_tokens_details: { reasoning_tokens: 8192 } },
      finish_reason: "length",
    },
  ];
  const diagnostic = responseDiagnostic(step, [], known, 8192);
  expect(diagnostic.reasoning_consumed_entire_output_budget).toBe(true);
  expect(diagnostic.target_decision_recoverable).toBe(false);
  expect(diagnostic.grounding_phase).toBe("before-correct-grounding");
  expect(
    responseDiagnostic(step, [], [], 8192).reasoning_consumed_entire_output_budget,
  ).toBeNull();
  const previous = {
    executed: true,
    target_assessment: "correct",
    wrong_target: false,
  } as StepRecord;
  expect(responseDiagnostic(step, [previous], known, 8192).grounding_phase).toBe(
    "after-correct-grounding",
  );
  const partial = {
    ...step,
    raw_model_output: JSON.stringify({
      operation: { choice: "CLICK" },
      target: { choice: "2" },
    }),
  };
  expect(responseDiagnostic(partial, [], known, 8192).target_decision_recoverable).toBe(
    true,
  );
});
