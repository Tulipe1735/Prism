# 15 — Repair the occluded account menu end to end

State: closed
Status: ready-for-agent
Assignee: codex
Blocked by: issues/09-complete-round-button-tracer-bullet.md

**What to build:** Let a user report that the account menu opens behind the header and cannot be clicked, then have Prism reproduce the occlusion, repair it, and prove that the visible menu can receive input.

- [x] The deterministic Fixture reproduces the occluded menu and resets source, open state, scroll position, focus, and stacking context between attempts.
- [x] The Browser Baseline records the trigger, menu geometry, clipping, stacking or hit-test evidence, screenshot, and failed interaction.
- [x] Pi applies a scoped repair through the WorkspaceExecutor and passes the Fixture build and relevant tests.
- [x] Final verification proves the menu is visible, unclipped, unoccluded at its hit-test point, and that the Fixture item receives the intended click.
- [x] The dossier and replay preserve reproduction, patch, test, hit-test, interaction, screenshot, and terminal evidence.

## Resolution

Added the deterministic `/occluded-menu` Fixture and manifest, then reused the
existing approved tracer-bullet path for the scoped `z-index: 1` to `z-index: 3`
CSS repair. The known-bad baseline starts from the already-open reproduction
state and records trigger, menu, and item geometry; viewport and ancestor
clipping; the menu stacking value; the element at the 44px item's center; the
failed pointer click; and the screenshot.

The authoritative Browser Oracle requires that the complete menu remain
unclipped, the same item geometry stay within 2px, `elementFromPoint` return the
Profile item at its center, the real pointer click produce `Profile selected`,
and no console error occur. The Run persists the brokered click, bounded patch,
build/test evidence, screenshots, Oracle evaluation, terminal completion, and
the same replayed result.

Verified with the focused real-Chromium Run, affected package tests, full
workspace typecheck, lint, production build, formatting, and `git diff --check`.
