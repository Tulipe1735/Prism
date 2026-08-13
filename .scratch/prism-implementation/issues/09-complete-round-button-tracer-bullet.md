# 09 — Complete the round-button GUI Tracer Bullet

State: closed
Status: ready-for-agent
Assignee: codex
Blocked by: issues/06-integrate-pi-coding-runtime.md, issues/07-integrate-ui-tars-browser-runtime.md, issues/08-build-round-button-fixture-and-oracles.md

**What to build:** Let a user submit the round-button request from the Field Desk and watch it complete through the real Orchestrator, Pi Coding Runtime, UI-TARS Browser Runtime, controlled executors, Journal, Artifacts, Oracles, and final Run dossier. This is the first complete Prism product seam and the M1 acceptance boundary.

- [x] The Run preserves the original prompt and commits a defensible relational FrontendRepairSpec before source mutation.
- [x] Browser Runtime captures the pre-mutation Baseline, Pi produces a scoped patch through the WorkspaceExecutor, and the relevant build and tests pass.
- [x] Browser Runtime proves that rendered radius increased materially while label, clickability, size, and layout invariants remain true.
- [x] The Run can reach task_complete only when both the scoped code Oracle and BrowserVerificationReport pass and cite committed evidence.
- [x] Journal and artifact replay reconstructs the same terminal state, DAG revision, budgets, approvals, and verification references with valid hashes.
- [x] One injected restart after the committed Baseline resumes from the node boundary without repeating a committed node or accepting a stale executor.
- [x] The GUI replaces prototype mock data with the real DAG, runtime, evidence, lease, and terminal result for this Run.

## Resolution

Completed the round-button M1 Tracer Bullet through the existing production seam. The Run now commits the normalized relational `FrontendRepairSpec` before orchestration, captures and journals the real pre-mutation Browser Baseline, gates Pi's scoped patch on the real build/test `CodeOracle`, and gates `task.complete` on both that committed report and the intent-linked deterministic `BrowserVerificationReport`.

The append-only Journal now owns the completed status, budgets, approvals, Oracle references, DAG revision, and monotonic effect-lease fence. A baseline-bound observation artifact lets a second `startHybridRun` resume after an injected stop without repeating the committed browser node; stale fencing tokens are rejected at the store boundary. The Field Desk dossier renders the committed spec, baseline, DAG, runtime evidence, lease, dual-Oracle result, and terminal completion, and offers an idempotent resume action for incomplete Runs.

Verified with the real-Chromium tracer-bullet test, serial full-workspace tests, full typecheck and lint, and the production build.
