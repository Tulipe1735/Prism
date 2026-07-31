# 11 — Repair the missing card shadow end to end

State: open
Status: ready-for-agent
Assignee: unassigned
Blocked by: issues/09-complete-round-button-tracer-bullet.md

**What to build:** Let a user ask Prism to restore a subtle but visible shadow to the profile card without moving it, then receive a complete GUI Run with source, test, rendered, and replay evidence.

- [ ] The Fixture, scenario manifest, known-bad state, reset, budgets, accepted DAG family, code Oracle, and browser Oracle are deterministic.
- [ ] A pre-mutation Browser Baseline proves that the rendered shadow is absent and records target and surrounding geometry.
- [ ] Pi applies a scoped repair through the WorkspaceExecutor and passes the Fixture build and relevant tests.
- [ ] Final browser verification proves the rendered shadow is no longer absent, the localized target region changed, and card and surrounding layout remain within tolerance.
- [ ] The Field Desk exposes Baseline, patch, test, after screenshot, assertions, and terminal result, and replay reconstructs the same result.
