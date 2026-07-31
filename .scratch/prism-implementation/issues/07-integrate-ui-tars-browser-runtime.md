# 07 — Integrate the UI-TARS Browser Runtime into a live Run

State: open
Status: ready-for-agent
Assignee: unassigned
Blocked by: issues/05-stream-a-dual-runtime-run-dag.md

**What to build:** Replace the mocked Browser Runtime with an embedded UI-TARS SDK session whose custom Prism Operator observes an allowlisted page, proposes one typed browser action at a time, and returns browser evidence and verification outcomes to the live dossier.

- [ ] The implementation pins and documents the verified UI-TARS SDK package, model interface, coordinate convention, and supported browser configuration.
- [ ] The custom Operator converts every parsed prediction into a Zod-validated ActionBroker proposal and never executes input directly.
- [ ] Screenshot scaling, viewport, device-pixel ratio, coordinate space, tab, page state, and screenshot hash remain bound through proposal and execution.
- [ ] High-level multi-action execution cannot bypass per-action policy, freshness, approval, cancellation, or effect-lease checks.
- [ ] UI-TARS qualitative judgment is labeled supplemental and cannot create a passing BrowserVerificationReport without an intent-linked deterministic predicate.
- [ ] An integration smoke captures a baseline, performs an allowlisted local interaction, rejects a stale proposal, and demonstrates that a source-write request is impossible.
