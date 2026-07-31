# 10 — Handle approval, cancellation, and recovery in the GUI

State: open
Status: ready-for-agent
Assignee: unassigned
Blocked by: issues/09-complete-round-button-tracer-bullet.md

**What to build:** Give the user a trustworthy Field Desk control surface for proposed effects, approval or denial, cancellation, interruption, reconciliation, and terminal blocking. The GUI must explain what Prism will do without allowing a stale or modified action to reuse authority.

- [ ] A Radix-based approval surface shows the exact Run, node, origin, target, effect class, redacted parameters, preconditions, and reason for approval.
- [ ] Approval is single-use and bound to the proposal digest, current observation, fencing token, target, arguments, and expiry; drift invalidates it.
- [ ] Approve, decline, and cancel produce distinct durable events and GUI states, and decline or cancellation performs no new mutation.
- [ ] Deterministic fault cases cover workspace escape, Browser Runtime source-write requests, stale visual actions, prompt-injected authority escalation, denial, cancellation, read-only crash, and unknown code or browser effects.
- [ ] An unknown effect is reconciled against workspace or browser reality before retry; partial or unknowable effects append recovery or human-review work rather than repeating blindly.
- [ ] Replaced fencing tokens prevent a stale executor from committing, and the dossier makes the reconciliation decision and evidence inspectable.
