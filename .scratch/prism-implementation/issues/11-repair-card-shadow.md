# 11 — Repair the missing card shadow end to end

State: closed
Status: ready-for-agent
Assignee: codex
Blocked by: issues/09-complete-round-button-tracer-bullet.md

**What to build:** Let a user ask Prism to restore a subtle but visible shadow to the profile card without moving it, then receive a complete GUI Run with source, test, rendered, and replay evidence.

- [x] The Fixture, scenario manifest, known-bad state, reset, budgets, accepted DAG family, code Oracle, and browser Oracle are deterministic.
- [x] A pre-mutation Browser Baseline proves that the rendered shadow is absent and records target and surrounding geometry.
- [x] Pi applies a scoped repair through the WorkspaceExecutor and passes the Fixture build and relevant tests.
- [x] Final browser verification proves the rendered shadow is no longer absent, the localized target region changed, and card and surrounding layout remain within tolerance.
- [x] The Field Desk exposes Baseline, patch, test, after screenshot, assertions, and terminal result, and replay reconstructs the same result.

## Resolution

Added the deterministic `/card-shadow` fixture and manifest, then reused the
existing approved tracer-bullet path for its scoped CSS repair. Browser evidence
now records the computed shadow plus parent and sibling rectangles, while the
localized clip includes the area outside the target border where shadows render.
The authoritative Oracle requires a previously absent shadow to become visible,
the clip to change, and target and surrounding geometry to stay within tolerance.

The Field Desk Run persists and exposes the baseline, source patch, build/test
evidence, after screenshot, deterministic assertions, completion record, and the
same replayed terminal result.

Verified with affected-package lint, the full workspace typecheck and production
build, contracts/broker/fixture and targeted Oracle tests, and a real-Chromium
card-shadow end-to-end Run through approval, repair, dual Oracles, completion,
and journal replay.
