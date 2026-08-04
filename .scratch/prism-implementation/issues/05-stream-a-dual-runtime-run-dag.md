# 05 — Stream a dual-runtime Run DAG into the Field Desk

State: closed
Status: ready-for-agent
Assignee: codex
Blocked by: issues/03-run-confined-workspace-inspection.md, issues/04-capture-brokered-browser-baseline.md

**What to build:** Execute one complete mocked hybrid Run through the Orchestrator and stream its evolving DAG, runtime activity, artifacts, and effect lease into the Field Desk. The user should be able to follow why each node became ready without runtime prose changing authority.

- [x] The Router emits a Zod-validated classification and initial immutable Run DAG revision using only registered node types and legal edges.
- [x] The DagScheduler runs independent read-only work concurrently while serializing source and browser effects through one fenced exclusive lease.
- [x] Runtime outcomes can request evidence or a legal successor, but only the Orchestrator can validate the request and append a later DAG revision.
- [x] Bounded retry creates a new attempt node rather than a graph cycle, and an uncertain route permits only read-only evidence before reclassification.
- [x] The Next.js GUI receives durable progress updates and uses TanStack Query for canonical server-state reconciliation; Zustand may retain only selected Run, panel, and filter preferences.
- [x] The Field Desk displays node state, runtime ownership, journal position, artifact counts, correlation or causation context, and the active fencing token without relying on mock records.
- [x] A mature bounded-concurrency package may be used for execution queues, while Prism retains explicit DAG, authority, and fencing semantics.
