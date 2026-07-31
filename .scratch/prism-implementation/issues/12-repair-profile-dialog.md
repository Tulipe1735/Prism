# 12 — Repair the profile Dialog end to end

State: open
Status: ready-for-agent
Assignee: unassigned
Blocked by: issues/09-complete-round-button-tracer-bullet.md

**What to build:** Let a user report that the Edit profile button does nothing, then have Prism reproduce the failure, repair the source, and prove through the GUI that the named Dialog opens correctly.

- [ ] The deterministic Fixture reproduces the failure before mutation and resets to that exact known-bad state between attempts.
- [ ] The Browser Baseline records the button interaction, absent Dialog state, focus state, console evidence, and required artifacts.
- [ ] Pi applies a scoped repair through the WorkspaceExecutor and passes the Fixture build and relevant tests.
- [ ] Final verification proves the same button exposes the named Dialog, moves focus inside it, supports expected keyboard behavior, and adds no console error.
- [ ] The dossier and replay preserve reproduction, patch, test, interaction, focus, screenshot, and terminal evidence.
