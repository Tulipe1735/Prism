# 13 — Repair form enablement end to end

State: closed
Status: ready-for-agent
Assignee: codex
Blocked by: issues/09-complete-round-button-tracer-bullet.md

**What to build:** Let a user report that Submit remains disabled after a valid email, then have Prism reproduce the state bug, repair it, and prove the complete input-to-state behavior through the GUI.

- [x] The deterministic Fixture reproduces the valid-email failure and resets source, form data, focus, and validation state between attempts.
- [x] The Browser Baseline records empty, invalid, and valid input transitions, disabled state, accessibility state, and console evidence before mutation.
- [x] Pi applies a scoped repair through the WorkspaceExecutor and passes the Fixture build and relevant tests.
- [x] Final verification proves empty and invalid input remain disabled, valid input enables Submit, and the transition is visible and keyboard-operable.
- [x] The dossier and replay preserve the reproduction steps, patch, tests, transition assertions, screenshots, and terminal result.

## Resolution

Added the deterministic `/form-enablement` fixture and reused the existing
approved tracer-bullet path for its one-expression state repair. The Browser
Oracle drives the native email input with real keyboard events, records empty,
invalid, and valid transitions plus accessibility-disabled and console state,
then proves `Tab` reaches the newly enabled Submit button.

The completed Run preserves the known-bad baseline, scoped patch, build/test
evidence, screenshots, transition assertions, terminal result, and replayed
verification report.

Verified with focused contract, Fixture, Oracle, Orchestrator, and ActionBroker
tests; a real-Chromium end-to-end Run through approval, repair, dual Oracles,
completion, and replay; full-workspace typecheck and lint; production builds;
and `git diff --check`.
