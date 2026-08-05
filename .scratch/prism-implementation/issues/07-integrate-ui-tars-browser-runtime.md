# 07 — Integrate the UI-TARS Browser Runtime into a live Run

State: closed
Status: ready-for-agent
Assignee: codex
Blocked by: issues/05-stream-a-dual-runtime-run-dag.md

**What to build:** Replace the mocked Browser Runtime with an embedded UI-TARS SDK session whose custom Prism Operator observes an allowlisted page, proposes one typed browser action at a time, and returns browser evidence and verification outcomes to the live dossier.

- [x] The implementation pins and documents the verified UI-TARS SDK package, model interface, coordinate convention, and supported browser configuration.
- [x] The custom Operator converts every parsed prediction into a Zod-validated ActionBroker proposal and never executes input directly.
- [x] Screenshot scaling, viewport, device-pixel ratio, coordinate space, tab, page state, and screenshot hash remain bound through proposal and execution.
- [x] High-level multi-action execution cannot bypass per-action policy, freshness, approval, cancellation, or effect-lease checks.
- [x] UI-TARS qualitative judgment is labeled supplemental and cannot create a passing BrowserVerificationReport without an intent-linked deterministic predicate.
- [x] An integration smoke captures a baseline, performs an allowlisted local interaction, rejects a stale proposal, and demonstrates that a source-write request is impossible.

## Resolution

Integrated `@ui-tars/sdk@1.2.3` as an embedded `GUIAgent` session behind
`packages/runtime-ui-tars`. `PrismBrowserOperator` implements the SDK
`screenshot()`/`execute()` primitives and converts every parsed prediction into a
Zod-validated `BrowserActionProposal` routed through the ActionBroker; its action
space exposes only `click` and `finished`, and the browser port has no
source/shell/file capability. Coordinate targets stay bound to the exact
observation (viewport, DPR, screenshot hash, page-state hash), and the ActionBroker
freshness check rejects stale proposals without sending input. The orchestrator
now invokes the real browser runtime for `browser.observe`/`browser.verify` nodes
and journals browser action records and `BrowserVerificationReport`s; the dossier
displays them. UI-TARS qualitative judgment is recorded as a `supplemental`
assertion and can never pass a report without an intent-linked deterministic
predicate, enforced by the contract superRefine. A real-Chromium integration
smoke captures a baseline, executes an allowlisted local click, rejects a stale
coordinate proposal, and proves the port cannot write source.

Verified with `pnpm typecheck`, `pnpm lint`, and `pnpm test`.
