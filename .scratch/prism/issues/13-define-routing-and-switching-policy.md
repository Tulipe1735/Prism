# Define the routing and switching policy

Type: `wayfinder:grilling`  
Parent: `issues/00-design-the-dual-route-prism-architecture.md`  
State: `closed`  
Status: `ready-for-human`  
Assignee: `/root`  
Blocked by: `none`

## Question

What structured decision should the initial prompt router return, how should it
represent uncertainty or hybrid work, and which explicit events may switch a
run between browser evidence and coding-agent repair without creating loops or
silently widening authority?

## Comments

### 2026-07-24 — Preserve an explicit hybrid route

Human decision: the initial router may return `hybrid` as a first-class result. Hybrid work must be represented explicitly rather than being inferred only after a browser-to-coding or coding-to-browser handoff.

### 2026-07-24 — Hybrid is a capability set, not a fixed sequence

Human correction: `hybrid` must not imply browser-first or any fixed browser-to-code-to-browser sequence. A pure source-code problem routes to `coding`. When the initial classification is `hybrid`, the orchestrator chooses the first worker from the current evidence gap and may later downgrade the run to a single route when the other capability is no longer needed.

### 2026-07-24 — Concurrency and DAG execution

Human decision: read-only browser and coding analysis may run concurrently, but only one worker at a time may hold the effect lease that authorizes a source mutation or browser interaction. The overall run should be modeled as a DAG rather than a fixed route sequence. Pure coding and pure browser tasks are small single-capability DAGs; hybrid tasks combine capability-specific nodes through typed artifact dependencies.

### 2026-07-24 — Incremental immutable DAG revisions

Human decision: the router creates only an initial Run DAG skeleton. As evidence arrives, the orchestrator may append immutable DAG revisions with new nodes and edges. It must not mutate completed nodes or introduce graph cycles. Retries create bounded attempt nodes, and verification failures expand a later revision rather than jumping back to an earlier node.

### 2026-07-24 — Typed node registry

Human decision: every DAG node must instantiate a versioned type from an allowlisted registry. Each registered type fixes its input and output schemas, worker capability, effect class, approval policy, timeout, retry bound, and permitted successor types. `plan.expand` may add registered nodes and edges but cannot invent tools, workers, effects, or authority at runtime.

### 2026-07-24 — Uncertain is read-only evidence gathering

Human decision: `uncertain` is a first-class initial classification whose DAG may contain only read-only inspection, observation, and context-gathering nodes followed by `route.reclassify`. No source mutation or browser interaction node may become ready until reclassification produces `coding`, `browser`, or `hybrid` in a later DAG revision.


## Resolution

The initial Router returns a typed classification of `coding`, `browser`, `hybrid`, or `uncertain`, plus confidence, required capabilities, initial authority scope, and an initial Run DAG revision. `hybrid` is a capability set rather than a fixed sequence; the first worker is chosen from the current evidence gap and the run may later narrow to one capability. `uncertain` permits only read-only evidence nodes until `route.reclassify` produces another classification.

Execution is an incrementally expanded DAG made of immutable revisions. Every node instantiates a versioned type from an allowlisted registry that fixes its schemas, worker, effect class, approval policy, timeout, retry bound, and permitted successors. Read-only nodes may run concurrently, while source mutations and browser interactions share one exclusive effect lease. Retries create bounded attempt nodes instead of graph cycles.

The top-level component is the `Orchestrator`; its internal `DagScheduler` computes ready nodes and dispatches them. Workers may return only typed artifacts and one of `succeeded`, `needs_more_evidence`, `needs_code_change`, `needs_browser_verification`, `retryable_failure`, `blocked`, `approval_denied`, `cancelled`, or `task_complete`. Only the Orchestrator may validate those proposals and append a DAG revision. Natural-language output cannot directly add tools, widen authority, or switch workers.
