# 09 — Complete the round-button GUI Tracer Bullet

State: open
Status: ready-for-agent
Assignee: unassigned
Blocked by: issues/06-integrate-pi-coding-runtime.md, issues/07-integrate-ui-tars-browser-runtime.md, issues/08-build-round-button-fixture-and-oracles.md

**What to build:** Let a user submit the round-button request from the Field Desk and watch it complete through the real Orchestrator, Pi Coding Runtime, UI-TARS Browser Runtime, controlled executors, Journal, Artifacts, Oracles, and final Run dossier. This is the first complete Prism product seam and the M1 acceptance boundary.

- [ ] The Run preserves the original prompt and commits a defensible relational FrontendRepairSpec before source mutation.
- [ ] Browser Runtime captures the pre-mutation Baseline, Pi produces a scoped patch through the WorkspaceExecutor, and the relevant build and tests pass.
- [ ] Browser Runtime proves that rendered radius increased materially while label, clickability, size, and layout invariants remain true.
- [ ] The Run can reach task_complete only when both the scoped code Oracle and BrowserVerificationReport pass and cite committed evidence.
- [ ] Journal and artifact replay reconstructs the same terminal state, DAG revision, budgets, approvals, and verification references with valid hashes.
- [ ] One injected restart after the committed Baseline resumes from the node boundary without repeating a committed node or accepting a stale executor.
- [ ] The GUI replaces prototype mock data with the real DAG, runtime, evidence, lease, and terminal result for this Run.
