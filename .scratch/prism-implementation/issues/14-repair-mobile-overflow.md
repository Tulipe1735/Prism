# 14 — Repair mobile checkout overflow end to end

State: open
Status: ready-for-agent
Assignee: unassigned
Blocked by: issues/09-complete-round-button-tracer-bullet.md

**What to build:** Let a user report that checkout actions run off-screen on mobile, then have Prism reproduce the responsive defect, repair it, and prove usability at the pinned mobile viewport without regressing desktop layout.

- [ ] The deterministic Fixture reproduces the overflow at a pinned mobile viewport and resets to the exact known-bad source and page state.
- [ ] The Browser Baseline records viewport, document and target geometry, clipping, overlap, horizontal overflow, and localized screenshots before mutation.
- [ ] Pi applies a scoped repair through the WorkspaceExecutor and passes the Fixture build and relevant tests.
- [ ] Final verification proves no horizontal page overflow, action overlap, or clipping and keeps every checkout action inside the mobile viewport.
- [ ] A desktop invariant remains within tolerance, and the dossier and replay preserve evidence for both viewport classes.
