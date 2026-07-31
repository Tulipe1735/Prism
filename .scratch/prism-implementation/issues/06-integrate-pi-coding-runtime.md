# 06 — Integrate the Pi Coding Runtime into a live Run

State: open
Status: ready-for-agent
Assignee: unassigned
Blocked by: issues/05-stream-a-dual-runtime-run-dag.md

**What to build:** Replace the mocked Coding Runtime with an embedded Pi Agent SDK session that can inspect a scoped workspace, propose a source repair, request controlled effects, and return a typed outcome visible in the live dossier.

- [ ] The implementation pins and documents the verified Pi Agent SDK packages and versions used by the embedded same-process runtime.
- [ ] Pi receives a versioned RuntimeTaskEnvelope and can return only committed artifact references, resource usage, and a Zod-validated NodeOutcome.
- [ ] Repository reads, patch application, shell commands, and tests cross the WorkspaceExecutor; Pi cannot directly mutate the DAG or widen its authority.
- [ ] Coding trajectory events preserve command, diff, test, model, token, correlation, causation, and attempt identity without exposing secrets.
- [ ] Cancellation, timeout, budget exhaustion, malformed SDK output, and process cleanup produce typed terminal or retryable outcomes and visible dossier evidence.
- [ ] An integration smoke demonstrates a scoped inspection, patch proposal, failing test, corrected result, and passing final test inside a disposable fixture workspace.
