# 04 — Capture a brokered Browser Baseline in the dossier

State: closed
Status: ready-for-agent
Assignee: codex
Blocked by: issues/02-create-and-reopen-runs.md

**What to build:** Let a Prism Run open an allowlisted local page through the BrowserExecutor, capture a deterministic pre-mutation Browser Baseline, and present its evidence in the Run dossier. Every browser input must originate as a typed ActionBroker proposal rather than direct model or GUI control.

- [x] The Browser Baseline binds build identity, route, browser version, viewport, device-pixel ratio, target identity, page-state hash, and screenshot hash.
- [x] Playwright captures the screenshot, relevant DOM or accessibility facts, computed style or geometry, console output, network evidence, and an openable trace as broker-owned artifacts.
- [x] Semantic or hybrid targets are preferred; a coordinate target is bound to its exact observation and fails as stale after navigation, resize, scroll, or page-state change.
- [x] The ActionBroker records proposal, policy decision, execution result, and before/after observation references for every browser input.
- [x] The Browser path has no repository-write, patch, shell, arbitrary-script, extension-installation, or unrestricted filesystem capability.
- [x] The dossier localizes the target evidence and clearly distinguishes deterministic facts from supplemental visual judgment.

## Resolution

Implemented a broker-owned, Playwright Browser Baseline for the explicitly configured local HTTP origin. Its page subrequests are read-only (`GET`/`HEAD`); it captures metadata, screenshot, DOM, accessibility, geometry, console, network, and trace artifacts with hash-verified storage.

The dossier now opens the screenshot, trace, and localized target evidence while marking deterministic facts separately from supplemental visual judgment. Scoped artifact access verifies both current Run ownership and hash before returning bytes.

Verified with lint, typecheck, the full serial test suite, and the Next production build.
