# Prototype the developer-ready roadmap revision

Type: `wayfinder:prototype`  
Parent: `issues/00-design-the-dual-route-prism-architecture.md`  
State: `closed`  
Status: `ready-for-human`  
Assignee: `/root`  
Blocked by: `issues/18-choose-dual-route-evaluation-gates.md`

## Question

What candidate developer-ready dual-runtime architecture specification applies
the resolved router, runtime, state, safety, React frontend-repair scenario, and
evaluation decisions, replaces the superseded console-operations catalog and
I1–I8 graph, and proposes a replacement implementation graph and first
milestone boundary for final human review?

## Comments

### 2026-07-24 — Candidate specification and runnable DAG prototype

Prototype assets:

- [Candidate Prism developer-ready architecture](../../../docs/prototypes/prism-roadmap/candidate-spec.md)
- The accepted runnable terminal shell was removed after its result was absorbed
  into the [durable Prism roadmap](../../../docs/prism-roadmap.md).
- [Prototype verdict notes](../../../docs/prototypes/prism-roadmap/NOTES.md)

The zero-dependency Node.js terminal prototype was driven through R1–R9. It exposed the intended parallel frontier after contracts, withheld R9 until Orchestrator, Pi Runtime, UI-TARS Runtime, and React fixture dependencies were complete, reported M1 as `READY FOR REVIEW`, and then exposed R10 safety/recovery and R11 remaining scenarios in parallel.

The candidate specification proposes 13 implementation nodes. M1 ends at R9 with one real round-button request traversing both embedded runtimes, controlled executors, event journal, dual oracles, fenced effect lease, and one node-boundary restart smoke. R10–R13 add the full fault suite, remaining five scenarios, evaluation and frozen SWE-bench manifest, and release packaging. Human verdict is still required; this ticket remains open.


## Resolution

Accept the [candidate Prism developer-ready architecture](../../../docs/prototypes/prism-roadmap/candidate-spec.md) and its 13-node replacement implementation DAG as the basis for final architecture review. The zero-dependency roadmap prototype was exercised through R1–R9 and demonstrated the intended dependency frontier and milestone transition; its terminal shell was removed after the accepted result was absorbed into the [durable Prism roadmap](../../../docs/prism-roadmap.md).

The proposed first milestone is R1–R9. It ends only when one round-button natural-language request traverses the real embedded Pi Coding Runtime and UI-TARS Browser Runtime, controlled WorkspaceExecutor and ActionBroker paths, append-only event and artifact state, build and test checks, deterministic browser verification, fenced effect lease, and one node-boundary process-restart smoke. This is planning approval only and does not authorize product implementation.

Keep R10–R13 outside M1: the complete safety, cancellation, and recovery fault suite; the remaining five React repair scenarios; the eval runner and frozen 12-task SWE-bench manifest; and CLI packaging plus release evidence. These become later work after the first vertical seam is proven.

The accepted verdict is recorded in [prototype notes](../../../docs/prototypes/prism-roadmap/NOTES.md). The final architecture ticket must absorb the accepted specification into the durable roadmap and approve or revise the implementation graph before any implementation tickets are published. After absorption, delete the throwaway terminal shell rather than retaining it as product code.
