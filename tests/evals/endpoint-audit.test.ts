import type { SummaryRecord } from "../../evals/schema.ts";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { auditCohort, derivedFailure } from "../../evals/endpoint-audit/ledger.ts";
import {
  labelDisagreements,
  report,
  terminalCauseTable,
} from "../../evals/endpoint-audit/report.ts";

/** Frozen trajectories; this suite reads them and never writes to them. */
const CONFIRMATORY = "evals/results/paper-confirmatory-v1.jsonl";
const EXTERNAL_GLM = "evals/results/external-validation-v1-glm-5.3-flash.jsonl";
const EXTERNAL_DEEPSEEK =
  "evals/results/external-validation-v1-deepseek-v4.1-flash.jsonl";

it("derives the same step, call and wrong-input counts as the frozen summaries", async () => {
  const audit = await auditCohort(CONFIRMATORY);
  expect(audit.summaries).toBe(240);
  expect(audit.inconsistencies).toEqual([]);
  const strict = audit.ledger.filter((row) => row.strict_task_success === true).length;
  const grounding = audit.ledger.filter((row) => row.grounding_success === true).length;
  expect(grounding).toBe(206);
  expect(strict).toBe(192);
  // A grounding success that the strict endpoint does not count is a real class, not an error.
  expect(audit.ledger.filter((row) => row.grounded_then_strict_failed).length).toBe(14);
});

it("keeps a provider event ahead of a recorded terminal label and never rewrites the label", async () => {
  const audit = await auditCohort(EXTERNAL_GLM);
  const withTimeout = audit.ledger.filter((row) =>
    row.infrastructure_events.includes("PROVIDER_TIMEOUT"),
  );
  expect(withTimeout.length).toBe(9);
  // Eight of them were recorded as a budget overrun; the derived label reports the one
  // observed cause and the terminal cause stays separate.
  expect(
    withTimeout.filter((row) => row.original_failure === "BUDGET_EXCEEDED").length,
  ).toBe(8);
  expect(withTimeout.every((row) => row.derived_failure === "PROVIDER_TIMEOUT")).toBe(
    true,
  );
  expect(withTimeout.every((row) => row.terminal_cause === "task-deadline")).toBe(true);
});

it("classifies the five external rows that the frozen writer left without a label", async () => {
  const audits = [
    await auditCohort(EXTERNAL_GLM),
    await auditCohort(EXTERNAL_DEEPSEEK),
  ];
  const rows = labelDisagreements(audits.flatMap((audit) => audit.ledger));
  expect(rows).toHaveLength(5);
  expect(rows.map((row) => row.derived_failure).sort()).toEqual([
    "POST_GROUNDING_BLOCKED",
    "POST_GROUNDING_BLOCKED",
    "POST_GROUNDING_BLOCKED",
    "POST_GROUNDING_WRONG_ACTION",
    "POST_GROUNDING_WRONG_ACTION",
  ]);
  // Two of the five executed a wrong input; three stopped on the step budget with a correct
  // grounding already recorded. None of them is a grounding failure.
  expect(rows.filter((row) => row.any_wrong_execution)).toHaveLength(2);
  expect(rows.every((row) => row.grounding_success === true)).toBe(true);
});

it("orders the derived failure label by explicit evidence", () => {
  const base = {
    status: "blocked",
    reason: "Stopped at the 8-action budget.",
    invalid_outputs: 0,
    invalid_actions: 0,
    invalid_selectors: 0,
    stale_events: 0,
    stale_recoveries: 0,
    success: false,
    infrastructure_failures: [],
  } as unknown as SummaryRecord;
  const wrongStep = { executed: true, target_assessment: "wrong" } as never;
  const correctStep = { executed: true, target_assessment: "correct" } as never;
  expect(derivedFailure(base, [wrongStep])).toBe("WRONG_EXECUTED_INPUT");
  expect(derivedFailure(base, [correctStep])).toBe("POST_GROUNDING_BLOCKED");
  expect(
    derivedFailure({ ...base, infrastructure_failures: ["PROVIDER_TIMEOUT"] }, [
      correctStep,
    ]),
  ).toBe("PROVIDER_TIMEOUT");
  expect(derivedFailure({ ...base, invalid_outputs: 2 }, [correctStep])).toBe(
    "INVALID_OUTPUT",
  );
  expect(derivedFailure({ ...base, success: true }, [correctStep])).toBe("NONE");
  expect(derivedFailure(base, [])).toBe("NO_EXECUTED_INPUT");
});

it("builds the report from the derived ledger without model or browser access", async () => {
  const audits = [
    await auditCohort(CONFIRMATORY),
    await auditCohort(EXTERNAL_DEEPSEEK),
  ];
  const text = report(audits);
  expect(text).toContain("P0-C derived endpoint and oracle ledger");
  expect(text).toContain("Rows with a missing recorded failure label");
  expect(text).toContain("Direction of the arm contrasts, grounding versus strict");
  expect(text).not.toContain("undefined");
  const table = terminalCauseTable(audits[0]!.ledger);
  expect(table).toContain("| derived label |");
  expect(table).toContain("task-deadline");
});

it("reads the frozen files as bytes and leaves them unchanged", async () => {
  const before = await readFile(CONFIRMATORY);
  const audit = await auditCohort(CONFIRMATORY);
  const after = await readFile(CONFIRMATORY);
  expect(after.equals(before)).toBe(true);
  expect(audit.sha256).toMatch(/^[0-9a-f]{64}$/);
});
