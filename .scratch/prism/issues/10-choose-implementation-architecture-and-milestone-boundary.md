# Choose the implementation architecture and milestone boundary

Type: `wayfinder:grilling`  
Parent: `issues/00-design-the-dual-route-prism-architecture.md`  
State: `closed`  
Status: `ready-for-human`  
Assignee: `/root`  
Blocked by: `issues/19-prototype-the-developer-ready-roadmap-revision.md`

## Question

Which consolidated dual-runtime architecture, component boundaries, technology
choices, React frontend-repair fixture slice, and first implementation
milestone should become the developer-ready specification, and what replacement ticket
graph should be approved for implementation while the superseded I1–I8 graph
remains historical?

## Comments

- Final review candidate: [Prism developer-ready roadmap](../../../docs/prism-roadmap.md). It consolidates the accepted dual-runtime architecture, R1-R13 replacement DAG, and M1 boundary at R9. This ticket remains open until explicit human approval; approval ends wayfinding but does not authorize implementation.

## Resolution

Approve the [Prism developer-ready roadmap](../../../docs/prism-roadmap.md) as
the durable architecture specification. Prism remains a standalone TypeScript
product with sibling Pi Agent SDK Coding Runtime and UI-TARS Browser Runtime
components coordinated by the Orchestrator through immutable, incrementally
expanded Run DAG revisions and controlled effect executors.

Adopt R1–R13 as the replacement implementation DAG and end M1 at R9, where the
round-button React request must traverse both real runtimes, deterministic
browser evidence, confined source mutation, journal and artifact replay,
fenced effects, and a node-boundary restart smoke. R10–R13 remain M2.

This closes architecture wayfinding only. It neither publishes implementation
tickets nor authorizes product implementation; either requires a separate
action.
