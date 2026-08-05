# 06 — Integrate the Pi Coding Runtime into a live Run

State: closed
Status: ready-for-agent
Assignee: codex
Blocked by: issues/05-stream-a-dual-runtime-run-dag.md

**What to build:** Replace the mocked Coding Runtime with an embedded Pi Agent SDK session that can inspect a scoped workspace, propose a source repair, request controlled effects, and return a typed outcome visible in the live dossier.

- [x] The implementation pins and documents the verified Pi Agent SDK packages and versions used by the embedded same-process runtime.
- [x] Pi receives a versioned RuntimeTaskEnvelope and can return only committed artifact references, resource usage, and a Zod-validated NodeOutcome.
- [x] Repository reads, patch application, shell commands, and tests cross the WorkspaceExecutor; Pi cannot directly mutate the DAG or widen its authority.
- [x] Coding trajectory events preserve command, diff, test, model, token, correlation, causation, and attempt identity without exposing secrets.
- [x] Cancellation, timeout, budget exhaustion, malformed SDK output, and process cleanup produce typed terminal or retryable outcomes and visible dossier evidence.
- [x] An integration smoke demonstrates a scoped inspection, patch proposal, failing test, corrected result, and passing final test inside a disposable fixture workspace.

## Resolution

Integrated `@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai` 0.82.1 as an embedded runtime with an explicit tool allowlist backed by `WorkspaceExecutor`. Added the versioned task/result contracts, bounded and redacted trajectory evidence, typed failure mapping, and live repository/orchestrator wiring. The disposable-fixture smoke exercises inspection, an initially failing repair, a corrected patch, and a passing final test through the real Pi SDK session surface.

Verified with `pnpm typecheck`, `pnpm lint`, and `pnpm test`.
