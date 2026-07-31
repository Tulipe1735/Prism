# 13 — Repair form enablement end to end

State: open
Status: ready-for-agent
Assignee: unassigned
Blocked by: issues/09-complete-round-button-tracer-bullet.md

**What to build:** Let a user report that Submit remains disabled after a valid email, then have Prism reproduce the state bug, repair it, and prove the complete input-to-state behavior through the GUI.

- [ ] The deterministic Fixture reproduces the valid-email failure and resets source, form data, focus, and validation state between attempts.
- [ ] The Browser Baseline records empty, invalid, and valid input transitions, disabled state, accessibility state, and console evidence before mutation.
- [ ] Pi applies a scoped repair through the WorkspaceExecutor and passes the Fixture build and relevant tests.
- [ ] Final verification proves empty and invalid input remain disabled, valid input enables Submit, and the transition is visible and keyboard-operable.
- [ ] The dossier and replay preserve the reproduction steps, patch, tests, transition assertions, screenshots, and terminal result.
