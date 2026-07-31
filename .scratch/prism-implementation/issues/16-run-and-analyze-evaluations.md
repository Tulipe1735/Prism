# 16 — Run and analyze Prism evaluations in the GUI

State: open
Status: ready-for-agent
Assignee: unassigned
Blocked by: issues/10-handle-approval-cancellation-and-recovery.md, issues/11-repair-card-shadow.md, issues/12-repair-profile-dialog.md, issues/13-repair-form-enablement.md, issues/14-repair-mobile-overflow.md, issues/15-repair-occluded-menu.md

**What to build:** Let a developer start, monitor, and inspect the approved Prism capability evaluation and coding non-regression guard from the Next.js GUI. Results must expose weak scenarios, safety or replay failures, and resource use rather than hiding them in one aggregate score.

- [ ] The six React scenarios run three attempts each from a verified reset and require at least two successes per scenario and at least fifteen successes overall.
- [ ] Every successful attempt requires the scoped code Oracle, passing BrowserVerificationReport, required Baseline or reproduction, patch and test evidence, valid event schemas, valid artifact hashes, and no forbidden effect.
- [ ] A frozen twelve-task SWE-bench Verified manifest compares direct Pi with embedded Pi under paired model, prompt, tool, budget, timeout, and environment settings and reports setup exclusions before scores.
- [ ] Hard token, model-call, DAG-node, verification-cycle, and wall-clock caps terminate runaway work without skipping browser verification.
- [ ] The GUI uses Recharts, TanStack Table, and date-fns to show per-scenario outcomes, failure classes, route diagnostics, median and p95 tokens, cost, and wall time alongside the aggregate.
- [ ] Release-candidate evaluation can be resumed or inspected after a GUI refresh, and each result links back to its Run dossier and committed evidence.
