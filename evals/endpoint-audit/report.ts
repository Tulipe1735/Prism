import type { CohortAudit, LedgerRow } from "./ledger.ts";

/** Reporting helpers for the P0-C endpoint audit. Pure functions over the derived ledger. */
export function markdownTable(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `|${headers.map(() => "---").join("|")}|`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function percent(value: number, total: number): string {
  return total === 0 ? "n/a" : `${((value / total) * 100).toFixed(1)}%`;
}

export function cohortSummary(audit: CohortAudit): string {
  const rows = audit.ledger;
  const total = rows.length;
  const grounding = rows.filter((row) => row.grounding_success === true).length;
  const strict = rows.filter((row) => row.strict_task_success === true).length;
  const success = rows.filter((row) => row.success).length;
  const noScored = rows.filter((row) => row.no_scored_attempt).length;
  const groundedThenFailed = rows.filter(
    (row) => row.grounded_then_strict_failed,
  ).length;
  const anyWrong = rows.filter((row) => row.any_wrong_execution).length;
  const incompleteEvidence = rows.filter((row) => !row.evidence_complete).length;
  const lines = [
    `## ${audit.cohort}`,
    "",
    `- source: \`${audit.path}\` (sha256 ${audit.sha256.slice(0, 12)}…)`,
    `- frozen records: ${audit.summaries} summaries, ${audit.steps} steps`,
    `- consistency problems in the frozen records: ${audit.inconsistencies.length}`,
    "",
    markdownTable(
      ["endpoint", "count", "share"],
      [
        ["success (summary)", String(success), percent(success, total)],
        [
          "grounding (first scored execution)",
          String(grounding),
          percent(grounding, total),
        ],
        ["strict task success", String(strict), percent(strict, total)],
        ["no scored attempt", String(noScored), percent(noScored, total)],
        [
          "grounded then not strict",
          String(groundedThenFailed),
          percent(groundedThenFailed, total),
        ],
        ["at least one wrong execution", String(anyWrong), percent(anyWrong, total)],
        [
          "incomplete oracle evidence",
          String(incompleteEvidence),
          percent(incompleteEvidence, total),
        ],
      ],
    ),
    "",
  ];
  if (audit.inconsistencies.length) {
    lines.push("### Consistency problems", "");
    lines.push(...audit.inconsistencies.slice(0, 20).map((item) => `- ${item}`));
    if (audit.inconsistencies.length > 20)
      lines.push(`- …and ${audit.inconsistencies.length - 20} more`);
    lines.push("");
  }
  return lines.join("\n");
}

export function coverageTable(rows: LedgerRow[]): string {
  const groups = new Map<string, LedgerRow[]>();
  for (const row of rows)
    groups.set(row.variant, [...(groups.get(row.variant) ?? []), row]);
  return markdownTable(
    [
      "variant",
      "cells",
      "no scored attempt",
      "invalid output",
      "invalid action",
      "executed steps",
      "scored steps",
    ],
    [...groups]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([variant, group]) => [
        variant,
        String(group.length),
        String(group.filter((row) => row.no_scored_attempt).length),
        String(group.reduce((total, row) => total + row.invalid_outputs, 0)),
        String(group.reduce((total, row) => total + row.invalid_actions, 0)),
        String(group.reduce((total, row) => total + row.executed_steps, 0)),
        String(group.reduce((total, row) => total + row.scored_steps, 0)),
      ]),
  );
}

/** Derived label against the recorded terminal cause, to keep cause and label separate. */
export function terminalCauseTable(rows: LedgerRow[]): string {
  const keys = [...new Set(rows.map((row) => row.derived_failure))].sort();
  const causes: LedgerRow["terminal_cause"][] = [
    "done",
    "model-blocked",
    "step-budget",
    "task-deadline",
    "error",
  ];
  return markdownTable(
    ["derived label", ...causes, "total"],
    keys.map((key) => {
      const group = rows.filter((row) => row.derived_failure === key);
      return [
        key,
        ...causes.map((cause) =>
          String(group.filter((row) => row.terminal_cause === cause).length),
        ),
        String(group.length),
      ];
    }),
  );
}

export function failureTable(rows: LedgerRow[]): string {
  const keys = [
    ...new Set(
      rows.map((row) => `${row.original_failure ?? "null"} → ${row.derived_failure}`),
    ),
  ].sort();
  return markdownTable(
    ["recorded → derived", "cells"],
    keys.map((key) => [
      key,
      String(
        rows.filter(
          (row) => `${row.original_failure ?? "null"} → ${row.derived_failure}` === key,
        ).length,
      ),
    ]),
  );
}

/** Rows whose recorded failure label disagrees with the derived one. */
export function labelDisagreements(rows: LedgerRow[]): LedgerRow[] {
  return rows.filter(
    (row) => row.original_failure === null && row.derived_failure !== "NONE",
  );
}

export function groundingReversalTable(audits: CohortAudit[]): string {
  const treatments = ["indexed-structural", "raw-selector-reference"];
  const lines: string[] = [];
  for (const audit of audits) {
    const rows = audit.ledger;
    for (const treatment of treatments) {
      const control = "indexed-local";
      const lookup = new Map(
        rows.map((row) => [`${row.task_id}/${row.repetition}/${row.variant}`, row]),
      );
      const pairs = rows.flatMap((row) => {
        if (row.variant !== treatment) return [];
        const other = lookup.get(`${row.task_id}/${row.repetition}/${control}`);
        return other === undefined ? [] : [[row, other] as const];
      });
      if (!pairs.length) continue;
      const grounding = pairs.filter(
        ([a, b]) => a.grounding_success && !b.grounding_success,
      ).length;
      const strict = pairs.filter(
        ([a, b]) => a.strict_task_success === true && b.strict_task_success !== true,
      ).length;
      const reverseGrounding = pairs.filter(
        ([a, b]) => !a.grounding_success && b.grounding_success,
      ).length;
      const reverseStrict = pairs.filter(
        ([a, b]) => a.strict_task_success !== true && b.strict_task_success === true,
      ).length;
      lines.push(
        `| ${audit.cohort} | ${treatment} − ${control} | ${grounding} − ${reverseGrounding} | ${strict} − ${reverseStrict} | ${pairs.length} |`,
      );
    }
  }
  if (!lines.length) return "No paired cells.";
  return [
    "| cohort | contrast | grounding wins − losses | strict wins − losses | pairs |",
    "|---|---|---|---|---|",
    ...lines,
  ].join("\n");
}

export function report(audits: CohortAudit[]): string {
  const all = audits.flatMap((audit) => audit.ledger);
  const disagreements = labelDisagreements(all);
  const groundedTerminal = all.filter((row) => row.grounded_then_terminal_failure);
  const lines = [
    "# P0-C derived endpoint and oracle ledger",
    "",
    "Zero model calls. This report reads the frozen confirmatory, replication and external",
    "JSONL records and derives endpoints from the recorded steps. It does not re-score, edit",
    "or replace any frozen record, and it does not treat a missing scored attempt as a wrong",
    "selection. The original failure labels are always kept next to the derived ones.",
    "",
    "| cohort | summaries | steps | consistency problems |",
    "|---|---|---|---|",
    ...audits.map(
      (audit) =>
        `| ${audit.cohort} | ${audit.summaries} | ${audit.steps} | ${audit.inconsistencies.length} |`,
    ),
    "",
    ...audits.map((audit) => cohortSummary(audit)),
    "## Endpoint coverage by variant",
    "",
    ...audits.map((audit) => `### ${audit.cohort}\n\n${coverageTable(audit.ledger)}\n`),
    "## Recorded versus derived failure labels",
    "",
    ...audits.map((audit) => `### ${audit.cohort}\n\n${failureTable(audit.ledger)}\n`),
    "## Rows with a missing recorded failure label",
    "",
    disagreements.length
      ? markdownTable(
          [
            "cohort",
            "run",
            "task",
            "variant",
            "status",
            "terminal cause",
            "derived label",
            "reason",
          ],
          disagreements.map((row) => [
            row.cohort,
            row.run_id.slice(0, 8),
            row.task_id,
            row.variant,
            row.status,
            row.terminal_cause,
            row.derived_failure,
            row.reason.slice(0, 44),
          ]),
        )
      : "None.",
    "",
    "The frozen external writer adds a strict/DONE condition after its own failure",
    "classification and does not re-derive the failure label, so these rows keep `null`.",
    "The derived label above is deterministic and leaves the frozen record unchanged.",
    "",
    "## Terminal cause versus derived label",
    "",
    ...audits.map(
      (audit) => `### ${audit.cohort}\n\n${terminalCauseTable(audit.ledger)}\n`,
    ),
    "## Receipt completeness",
    "",
    ...audits.map(
      (audit) =>
        `- ${audit.cohort}: ${audit.ledger.filter((row) => row.receipt_complete).length}/${audit.ledger.length} cells carry a complete receipt (tokens recorded for every call).`,
    ),
    "",
    "## Grounding success followed by a terminal failure",
    "",
    groundedTerminal.length
      ? markdownTable(
          [
            "cohort",
            "run",
            "task",
            "variant",
            "status",
            "derived label",
            "grounding",
            "strict",
          ],
          groundedTerminal.map((row) => [
            row.cohort,
            row.run_id.slice(0, 8),
            row.task_id,
            row.variant,
            row.status,
            row.derived_failure,
            String(row.grounding_success),
            String(row.strict_task_success),
          ]),
        )
      : "None.",
    "",
    "## Direction of the arm contrasts, grounding versus strict",
    "",
    groundingReversalTable(audits),
    "",
    "A positive difference means the treatment arm wins on that endpoint. A sign change",
    "between the two endpoint columns shows that the two endpoints do not rank the arms the",
    "same way. This table shows the observed direction only; it is not a significance test.",
    "",
  ];
  return lines.join("\n");
}
