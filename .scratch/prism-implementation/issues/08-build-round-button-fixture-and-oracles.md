# 08 — Build the round-button Fixture and dual Oracles

State: open
Status: ready-for-agent
Assignee: unassigned
Blocked by: issues/01-establish-field-desk-and-contracts.md

**What to build:** Create the deterministic first React repair Fixture for “Make the primary Save button clearly rounded instead of square,” including its known-bad state, normalized FrontendRepairSpec, reset behavior, scoped code Oracle, and authoritative rendered Oracle.

- [ ] The isolated Fixture has fixed local data, no authentication or external network, bundled fonts, disabled nondeterministic animation, and pinned browser and viewport settings.
- [ ] A scenario manifest records the prompt, known-bad identity, route, viewport, accepted DAG family, required artifacts, budgets, code Oracle, browser Oracle, and deterministic reset.
- [ ] The normalized spec expresses a material increase in rendered corner radius while preserving label, clickability, control size, and declared layout invariants without inventing an exact user-supplied CSS value.
- [ ] The browser Oracle uses Playwright observations and a localized before/after target region; it fails on the known-bad state and passes on at least one reasonable repair.
- [ ] The code Oracle requires a scoped diff, successful build, and relevant tests without mandating one exact implementation.
- [ ] Reset restores the exact known-bad source and page state and proves the original baseline before another attempt begins.
