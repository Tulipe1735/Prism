# Prism

Prism is a standalone TypeScript Visual SWE harness. It accepts a natural-language frontend repair request, coordinates an embedded Pi Agent SDK Coding Runtime with an embedded UI-TARS Browser Runtime, applies source changes through a confined WorkspaceExecutor, and verifies the rendered result through a brokered browser path.

## Current status

The developer-ready architecture is approved. The first implementation slice is
now built: a production-shaped Next.js Field Desk, shared Zod repair-request
contracts, browser/server validation, and honest empty Run surfaces. Run
creation, persistence, orchestration, Pi, UI-TARS, browser evidence, and replay
remain planned work rather than implemented capability.

- [Read the canonical Prism roadmap](docs/prism-roadmap.md)
- [Open the completed Wayfinder map](.scratch/prism/issues/00-design-the-dual-route-prism-architecture.md)
- [Read the selected technical baseline](docs/TECH-STACK.md)
- [Review the deferred dashboard-adapter expansion](.scratch/prism/scenarios.md)
- [Read the local tracker conventions](docs/agents/issue-tracker.md)
- [Open the selected Field Desk UI prototype](apps/web/app/prototype/prism/NOTES.md)

Run the current product shell:

```bash
pnpm install
pnpm dev
```

The Field Desk is at `/`; the selected throwaway prototype remains available at
`/prototype/prism` for regression comparison.

Run the repeatable prototype-isolation regression with:

```bash
pnpm test:prototype
```

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

Implementation tickets are published under `.scratch/prism-implementation/`.
The current handoff is:

```text
selected Field Desk prototype
→ real Field Desk and shared request contracts
→ durable Run creation and replayable state
→ controlled workspace and browser evidence paths
→ first complete round-button tracer bullet
```

The prototype remains throwaway validation work. Production code preserves its
workspace-first information hierarchy but does not import its mock Runs, DAG,
evidence, or verdicts.
