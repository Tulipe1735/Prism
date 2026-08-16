# 14 — Repair mobile checkout overflow end to end

State: closed
Status: ready-for-agent
Assignee: codex
Blocked by: issues/09-complete-round-button-tracer-bullet.md

**What to build:** Let a user report that checkout actions run off-screen on mobile, then have Prism reproduce the responsive defect, repair it, and prove usability at the pinned mobile viewport without regressing desktop layout.

- [x] The deterministic Fixture reproduces the overflow at a pinned mobile viewport and resets to the exact known-bad source and page state.
- [x] The Browser Baseline records viewport, document and target geometry, clipping, overlap, horizontal overflow, and localized screenshots before mutation.
- [x] Pi applies a scoped repair through the WorkspaceExecutor and passes the Fixture build and relevant tests.
- [x] Final verification proves no horizontal page overflow, action overlap, or clipping and keeps every checkout action inside the mobile viewport.
- [x] A desktop invariant remains within tolerance, and the dossier and replay preserve evidence for both viewport classes.

## Resolution

Added the deterministic `/mobile-overflow` fixture and reused the approved
tracer-bullet path for a one-value CSS repair (`max-width: none` to `100%`).
The pinned 390×844 baseline records document, target, and action geometry,
horizontal overflow, clipping, overlap, screenshots, and the known-bad source.

The Browser Oracle proves every checkout action remains inside the repaired
mobile viewport without overlap or clipping, then repeats the observation at
1280×720 and requires desktop target geometry to stay within 2px. The dossier
and replay preserve both viewport classes, the scoped patch, build/test output,
verification assertions, screenshots, approval, and terminal result.

Verified with focused Fixture, Oracle, Orchestrator, and ActionBroker tests; a
real-Chromium end-to-end Run through approval, repair, dual Oracles, completion,
and replay; full-workspace typecheck and lint; production builds; and
`git diff --check`.
