# 08 — Build the round-button Fixture and dual Oracles

State: closed
Status: ready-for-agent
Assignee: codex
Blocked by: issues/01-establish-field-desk-and-contracts.md

**What to build:** Create the deterministic first React repair Fixture for “Make the primary Save button clearly rounded instead of square,” including its known-bad state, normalized FrontendRepairSpec, reset behavior, scoped code Oracle, and authoritative rendered Oracle.

- [x] The isolated Fixture has fixed local data, no authentication or external network, bundled fonts, disabled nondeterministic animation, and pinned browser and viewport settings.
- [x] A scenario manifest records the prompt, known-bad identity, route, viewport, accepted DAG family, required artifacts, budgets, code Oracle, browser Oracle, and deterministic reset.
- [x] The normalized spec expresses a material increase in rendered corner radius while preserving label, clickability, control size, and declared layout invariants without inventing an exact user-supplied CSS value.
- [x] The browser Oracle uses Playwright observations and a localized before/after target region; it fails on the known-bad state and passes on at least one reasonable repair.
- [x] The code Oracle requires a scoped diff, successful build, and relevant tests without mandating one exact implementation.
- [x] Reset restores the exact known-bad source and page state and proves the original baseline before another attempt begins.

## Resolution

Built the deterministic React repair Fixture and dual Oracles as R8 in the
[Prism developer-ready roadmap](../../docs/prism-roadmap.md):

- **Fixture** — `fixtures/react-repair/` is a Vite + React 19 + TypeScript app
  with a `/round-button` route. Fixed local data, no auth or external network,
  the bundled DejaVu Sans `@font-face`, a global rule disabling all
  animation/transition, and a pinned viewport recorded in the manifest. The
  primary Save button is committed in the known-bad square state
  (`border-radius: 0`); scenario-relevant tests assert the invariants a repair
  must not break (label, enabled, control size).
- **Scenario manifest** — versioned `ScenarioManifest` schema
  (`prism.scenario-manifest/v1`) in `packages/oracle` records the prompt,
  known-bad identity (git revision + per-file SHA-256), route, viewport,
  normalized `FrontendRepairSpec`, accepted DAG family, required artifacts,
  code/browser budgets, code Oracle (scoped paths + build/test commands),
  browser Oracle (base URL + semantic target), and deterministic reset.
- **Normalized spec** — versioned `FrontendRepairSpec`
  (`prism.frontend-repair-spec/v1`) added to `packages/contracts` with
  relational (`metric-increase` on `borderRadius`, materiality thresholds)
  and invariant predicates (`label-preserved`, `clickable`, `size-within`,
  `layout-within`) that do not invent an exact user CSS value.
- **Browser Oracle** — `BrowserOracle` in `packages/oracle` navigates with
  Playwright to the local route, captures computed style/geometry/text/
  clickability plus a localized target-region clip (SHA-256), and evaluates
  the spec against before/after observations. Proven by a real-Chromium
  integration test: fails on the known-bad state and passes on a reasonable
  repair that rounds the button.
- **Code Oracle** — `CodeOracle` requires a scoped diff (every changed file
  inside the allowed `src/` scope), a successful fixture build, and passing
  relevant tests, without mandating one exact implementation.
- **Reset** — `resetFixture` restores the exact known-bad source via
  `git checkout` of the recorded revision, verifies every file hash against
  the known-bad identity, then re-observes the page with the browser Oracle
  and confirms the baseline evaluates to `failed`.

All new packages typecheck, lint, and pass their test suites; the full pnpm
test/build/typecheck runs are green. Unblocks
[09 — Complete the round-button GUI Tracer Bullet](09-complete-round-button-tracer-bullet.md).
