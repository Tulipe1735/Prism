# 04 — Capture a brokered Browser Baseline in the dossier

State: open
Status: ready-for-agent
Assignee: codex
Blocked by: issues/02-create-and-reopen-runs.md

**What to build:** Let a Prism Run open an allowlisted local page through the BrowserExecutor, capture a deterministic pre-mutation Browser Baseline, and present its evidence in the Run dossier. Every browser input must originate as a typed ActionBroker proposal rather than direct model or GUI control.

- [ ] The Browser Baseline binds build identity, route, browser version, viewport, device-pixel ratio, target identity, page-state hash, and screenshot hash.
- [ ] Playwright captures the screenshot, relevant DOM or accessibility facts, computed style or geometry, console output, network evidence, and an openable trace as broker-owned artifacts.
- [ ] Semantic or hybrid targets are preferred; a coordinate target is bound to its exact observation and fails as stale after navigation, resize, scroll, or page-state change.
- [ ] The ActionBroker records proposal, policy decision, execution result, and before/after observation references for every browser input.
- [ ] The Browser path has no repository-write, patch, shell, arbitrary-script, extension-installation, or unrestricted filesystem capability.
- [ ] The dossier localizes the target evidence and clearly distinguishes deterministic facts from supplemental visual judgment.
