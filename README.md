# Prism

Prism is a standalone TypeScript Visual SWE harness. It accepts a natural-language frontend repair request, coordinates an embedded Pi Agent SDK Coding Runtime with an embedded UI-TARS Browser Runtime, applies source changes through a confined WorkspaceExecutor, and verifies the rendered result through a brokered browser path.

## Current status

The developer-ready architecture is approved. Product implementation has not started.

- [Read the canonical Prism roadmap](docs/prism-roadmap.md)
- [Open the completed Wayfinder map](.scratch/prism/issues/00-design-the-dual-route-prism-architecture.md)
- [Read the selected technical baseline](docs/TECH-STACK.md)
- [Review the deferred dashboard-adapter expansion](.scratch/prism/scenarios.md)
- [Read the local tracker conventions](docs/agents/issue-tracker.md)

## First product boundary

- One Prism Orchestrator coordinates sibling Coding and Browser runtimes.
- The Coding Runtime owns repository inspection, source changes, shell requests, and tests through the WorkspaceExecutor.
- The Browser Runtime owns reproduction, observation, typed interaction proposals, and rendered verification through the ActionBroker.
- Only the Orchestrator may expand the immutable Run DAG.
- The append-only event journal and hashed artifacts are canonical run state.
- The first fixture suite contains six objectively verifiable React repairs.
- Browser verification requires deterministic predicates and localized visual evidence; qualitative model judgment is supplemental.

GitHub, Vercel, and Supabase dashboard repair is a deferred adapter direction, not part of the first React milestone. The useful safety, evidence, approval, oracle, and reset constraints from the former ConsoleOps plan have been absorbed into the deferred expansion document linked above.

## Delivery sequence

The approved roadmap does not itself authorize implementation. The intended handoff is:

```text
logic prototype
→ record the verdict and amend the specification if needed
→ publish R1–R13 as implementation tickets
→ implement M1 through R9
```

The prototype is throwaway validation work. Its terminal shell stays on a prototype branch; only validated decisions return to the main branch.
