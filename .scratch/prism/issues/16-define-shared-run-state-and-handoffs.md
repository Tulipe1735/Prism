# Define shared run state and handoffs

Type: `wayfinder:grilling`  
Parent: `issues/00-design-the-dual-route-prism-architecture.md`  
State: `closed`  
Status: `ready-for-human`  
Assignee: `/root`  
Blocked by: `issues/13-define-routing-and-switching-policy.md`, `issues/14-choose-the-coding-agent-embedding-strategy.md`, `issues/15-define-the-browser-evidence-contract.md`

## Question

What durable run-state model and handoff envelopes let the Router, Browser
Runtime, and Coding Runtime share `FrontendRepairSpec` intent, reproduction and
rendered baselines, localization evidence, patch proposals, approvals,
verification reports, budgets, and cancellation state while remaining
replayable and resumable?

## Comments

### 2026-07-24 — Candidate event-sourced run state and node-boundary resume

Use three persistence layers. An immutable `RunManifest` records the original prompt, workspace and local-preview identity, runtime and schema versions, initial authority and budgets. An append-only sequenced `RunEvent` journal is the source of truth for normalized `FrontendRepairSpec`, DAG revisions, node attempts, observations, artifact commits, effect proposals and policy decisions, approvals, budget charges, cancellation, reconciliation, and terminal status. A content-addressed artifact store holds patches, screenshots, DOM or trace material, test output, and verification reports. `RunSnapshot` is a replaceable materialized view rebuilt from the journal, never an independent authority.

Dispatch each node through a versioned `RuntimeTaskEnvelope` containing run, DAG revision, node and attempt identity; runtime kind; typed input and artifact references; workspace or browser baseline references; authority scope; remaining budget; deadline and cancellation token; and correlation, causation, and idempotency keys. A runtime returns only committed artifact references, resource usage, and the existing typed `NodeOutcome`. Runtime-private Pi or UI-TARS conversation state may be checkpointed as an optimization, but the next node must be reconstructible from canonical events and artifacts rather than depending on opaque in-memory SDK objects.

Candidate MVP resume guarantee: recover across Prism process restart at DAG node boundaries, not at an arbitrary model token or half-executed browser input. Replay the event journal, verify artifact hashes, reconstruct the latest DAG and budget/cancellation state, and never rerun committed nodes. A crashed read-only attempt may restart within its retry bound. Any effectful attempt without a durable completion record becomes `unknown`, releases no success dependency, and must be reconciled against reality before retry: inspect workspace hashes and patch state for code effects; reconnect or relaunch the local preview, invalidate screenshot coordinates, and capture a fresh `BrowserObservation` for browser effects. Never blindly repeat an unknown external effect.

Effect leases use a persisted monotonically increasing fencing token so a stale executor cannot commit after recovery. Cancellation and approval denial are durable terminal control events; restart does not clear them. Every state transition carries schema version, sequence, timestamp, actor, correlation and causation IDs, and redacted payload or artifact references so forensic replay can explain both runtime handoffs and Orchestrator DAG expansion.


### 2026-07-24 — Clarification: checkpoint recovery is not DAG rollback

The human summarized the intended behavior as returning to the prior node rather than continuing from halfway through the failed node. Refine this wording: Prism restores the state after the last durably committed node; it does not undo or rerun that node, and the append-only DAG never rewinds. The interrupted current attempt is abandoned as an in-memory continuation and receives a durable `interrupted` or `unknown` record.

The Orchestrator then decides the current node from its boundary. For a read-only node, create a new attempt from the original typed envelope. For an effectful node, reconcile first. If the effect did not occur, create a new attempt; if it completed, record a reconciled success and advance; if it partially occurred or cannot be determined, append a recovery or compensation node or block for human review. Therefore the system resumes from the last committed checkpoint, but it does not blindly “roll back one node.”


## Resolution

Persist each run as an immutable `RunManifest`, an append-only sequenced `RunEvent` journal, and a content-addressed artifact store. The manifest fixes the original prompt, workspace and local-preview identity, runtime and schema versions, initial authority, and budgets. The event journal is the sole source of truth for `FrontendRepairSpec`, immutable DAG revisions, node attempts, runtime handoffs, observations, patch and effect records, policy and approval decisions, budget charges, cancellation, reconciliation, and terminal status. Screenshots, DOM and trace material, patches, test output, and verification reports live as hashed artifacts. A `RunSnapshot` is only a rebuildable materialized view.

The Orchestrator dispatches a versioned `RuntimeTaskEnvelope` with run, DAG revision, node, and attempt identity; target runtime; typed input and artifact references; workspace or browser baseline references; authority scope; remaining budget; deadline and cancellation token; and correlation, causation, and idempotency keys. A Runtime returns committed artifact references, resource usage, and a typed `NodeOutcome`; it cannot mutate the DAG or pass raw capabilities to its sibling. Pi or UI-TARS private session checkpoints are optional caches, never canonical state: the next node must be reconstructible from journaled events and artifacts.

The MVP guarantees recovery across Prism process restart at DAG node boundaries, not continuation from an arbitrary model token or half-executed browser input. Restore the state after the last durably committed node; do not undo or rerun that node, and never rewind the append-only DAG. Mark the interrupted current attempt `interrupted` or `unknown` and decide it again from its boundary. A read-only node may receive a fresh bounded attempt. An effectful node must first reconcile reality: inspect workspace hashes and patch state for code effects, or reconnect or relaunch the local preview, invalidate old coordinates, and capture a fresh `BrowserObservation` for browser effects. If the effect did not occur, retry with a new attempt; if it completed, record reconciled success; if it is partial or unknowable, append a recovery or compensation node or block for human review. Never blindly repeat an unknown effect.

Persist effect leases with monotonically increasing fencing tokens so an executor from before recovery cannot commit afterward. Budget consumption, cancellation, and approval denial are durable control events and survive restart. Every event carries schema version, sequence, timestamp, actor, correlation and causation identifiers, plus redacted payload or artifact references. This supports forensic replay, deterministic state reconstruction, and explicit handoffs without pretending to provide exact mid-instruction continuation.
