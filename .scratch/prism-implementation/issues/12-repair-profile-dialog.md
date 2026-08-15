# 12 — Repair the profile Dialog end to end

State: closed
Status: ready-for-agent
Assignee: codex
Blocked by: issues/09-complete-round-button-tracer-bullet.md

**What to build:** Let a user report that the Edit profile button does nothing, then have Prism reproduce the failure, repair the source, and prove through the GUI that the named Dialog opens correctly.

- [x] The deterministic Fixture reproduces the failure before mutation and resets to that exact known-bad state between attempts.
- [x] The Browser Baseline records the button interaction, absent Dialog state, focus state, console evidence, and required artifacts.
- [x] Pi applies a scoped repair through the WorkspaceExecutor and passes the Fixture build and relevant tests.
- [x] Final verification proves the same button exposes the named Dialog, moves focus inside it, supports expected keyboard behavior, and adds no console error.
- [x] The dossier and replay preserve reproduction, patch, test, interaction, focus, screenshot, and terminal evidence.

## Resolution

Added the deterministic `/profile-dialog` fixture, scoped Pi repair, brokered
keyboard actions, Dialog/focus Oracle, and replayable end-to-end evidence. The
fixture uses the native `<dialog>` focus lifecycle instead of custom focus code.

Ergonomic acceptance is a keyboard-only recovery loop: `Tab` reaches the
44-pixel-high trigger, `Enter` opens the named Dialog and moves focus inside,
then `Escape` closes it and returns focus to the same trigger. The run also
requires zero console errors and retains the interaction, screenshot, focus,
patch, test, and terminal evidence.

Verified with the focused profile-Dialog Chromium test, affected package tests,
workspace typecheck, lint, and production build. The full Oracle suite still has
an unrelated Round Button baseline mismatch (`22px` in the fixture versus the
legacy `0px` expectation).
