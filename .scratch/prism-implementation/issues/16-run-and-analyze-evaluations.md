# 16 — Run and analyze Prism evaluations in the GUI

State: closed
Status: ready-for-agent
Assignee: codex
Blocked by: issues/10-handle-approval-cancellation-and-recovery.md, issues/11-repair-card-shadow.md, issues/12-repair-profile-dialog.md, issues/13-repair-form-enablement.md, issues/14-repair-mobile-overflow.md, issues/15-repair-occluded-menu.md

**What to build:** Let a developer start, monitor, and inspect the approved Prism capability evaluation and coding non-regression guard from the Next.js GUI. Results must expose weak scenarios, safety or replay failures, and resource use rather than hiding them in one aggregate score.

- [x] The six React scenarios run three attempts each from a verified reset and require at least two successes per scenario and at least fifteen successes overall.
- [x] Every successful attempt requires the scoped code Oracle, passing BrowserVerificationReport, required Baseline or reproduction, patch and test evidence, valid event schemas, valid artifact hashes, and no forbidden effect.
- [x] A frozen twelve-task SWE-bench Verified manifest compares direct Pi with embedded Pi under paired model, prompt, tool, budget, timeout, and environment settings and reports setup exclusions before scores.
- [x] Hard token, model-call, DAG-node, verification-cycle, and wall-clock caps terminate runaway work without skipping browser verification.
- [x] The GUI uses Recharts, TanStack Table, and date-fns to show per-scenario outcomes, failure classes, route diagnostics, median and p95 tokens, cost, and wall time alongside the aggregate.
- [x] Release-candidate evaluation can be resumed or inspected after a GUI refresh, and each result links back to its Run dossier and committed evidence.

## Resolution

Added a durable evaluation manifest and a sequential GUI runner that creates the
eighteen scenario Runs up front, restores and hash-verifies the known-bad source
before each attempt, and rebuilds every verdict from the Run dossier and
content-addressed trajectory artifacts. Success requires replay integrity, a
baseline, a committed completion/code Oracle, a passing deterministic browser
report, patch and test evidence, and a valid single-use effect approval chain.
The evaluation watchdog cancels active work when a frozen token, model-call,
DAG-node, verification-cycle, or wall-clock cap is crossed.

Frozen one official SWE-bench Verified instance per repository by the published
lexicographic rule. Paired direct/embedded results can be loaded from
`PRISM_SWE_BENCH_RESULTS_PATH`; without an official Docker-harness result file,
the GUI reports all setup exclusions before exposing either score.

Added `/evaluations` with Recharts scenario bars, a TanStack Table evidence view,
date-fns timestamps, median/p95 resource summaries, visible failure classes and
route diagnostics, and direct Run dossier links. Evaluation state is atomically
stored under `PRISM_DATA_DIR/evaluations`, so refresh and process restart retain
inspection/resume state.

Verified contracts, evaluation gates, source-only reset, Pi/browser trajectory
usage, web typecheck/lint/build, and a real Chromium start-refresh-keyboard-mobile
flow. The full web suite still has the pre-existing round-button 22px known-bad
baseline drift; the other five end-to-end scenario bullets passed.
