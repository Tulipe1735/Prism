# 10 — Handle approval, cancellation, and recovery in the GUI

State: closed
Status: ready-for-agent
Assignee: codex
Blocked by: issues/09-complete-round-button-tracer-bullet.md

**What to build:** Give the user a trustworthy Field Desk control surface for proposed effects, approval or denial, cancellation, interruption, reconciliation, and terminal blocking. The GUI must explain what Prism will do without allowing a stale or modified action to reuse authority.

- [x] A Radix-based approval surface shows the exact Run, node, origin, target, effect class, redacted parameters, preconditions, and reason for approval.
- [x] Approval is single-use and bound to the proposal digest, current observation, fencing token, target, arguments, and expiry; drift invalidates it.
- [x] Approve, decline, and cancel produce distinct durable events and GUI states, and decline or cancellation performs no new mutation.
- [x] Deterministic fault cases cover workspace escape, Browser Runtime source-write requests, stale visual actions, prompt-injected authority escalation, denial, cancellation, read-only crash, and unknown code or browser effects.
- [x] An unknown effect is reconciled against workspace or browser reality before retry; partial or unknowable effects append recovery or human-review work rather than repeating blindly.
- [x] Replaced fencing tokens prevent a stale executor from committing, and the dossier makes the reconciliation decision and evidence inspectable.

## Resolution

Completed the approval seam with the existing Radix-backed `Button`, Journal, ActionBroker, and monotonic effect lease. The Field Desk now exposes the exact redacted proposal and distinct approve, decline, and cancel controls; approvals are durable, single-use, expiry- and observation-bound capabilities, and any drift requires a fresh proposal and fencing token.

Interrupted source and browser effects now reconcile against committed workspace or browser evidence before any retry. Proven no-effect source attempts are reproposed under a new fence, while partial or unknowable outcomes append inspectable human-review work and block the Run. Deterministic tests cover the required authority, cancellation, stale-action, recovery, and unknown-effect cases, including a real-Chromium restart/replay path.

Verified with serial full-workspace tests, the real-Chromium tracer-bullet test, full typecheck and lint, and the production build.
