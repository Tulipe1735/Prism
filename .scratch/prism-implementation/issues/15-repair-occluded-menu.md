# 15 — Repair the occluded account menu end to end

State: open
Status: ready-for-agent
Assignee: unassigned
Blocked by: issues/09-complete-round-button-tracer-bullet.md

**What to build:** Let a user report that the account menu opens behind the header and cannot be clicked, then have Prism reproduce the occlusion, repair it, and prove that the visible menu can receive input.

- [ ] The deterministic Fixture reproduces the occluded menu and resets source, open state, scroll position, focus, and stacking context between attempts.
- [ ] The Browser Baseline records the trigger, menu geometry, clipping, stacking or hit-test evidence, screenshot, and failed interaction.
- [ ] Pi applies a scoped repair through the WorkspaceExecutor and passes the Fixture build and relevant tests.
- [ ] Final verification proves the menu is visible, unclipped, unoccluded at its hit-test point, and that the Fixture item receives the intended click.
- [ ] The dossier and replay preserve reproduction, patch, test, hit-test, interaction, screenshot, and terminal evidence.
