# Prism

Prism is a standalone TypeScript Visual SWE harness. It accepts a natural-language frontend repair request, coordinates an embedded Pi Agent SDK Coding Runtime with an Agent Plan Browser Runtime, applies source changes through a confined WorkspaceExecutor, and verifies the rendered result through a brokered browser path.

## Current status

Prism now ships as a local Next.js GUI. The Field Desk creates durable repair
Runs; `/runs` reopens their journal-backed dossiers; `/evaluations` starts and
resumes the six-scenario capability evaluation. Embedded Pi and Agent Plan
runtimes can only request source, command, and browser effects through confined
executors. Approvals, recovery, budgets, deterministic browser verification,
and SHA-256 content-addressed evidence remain visible in the dossier.

- [Read the canonical Prism roadmap](docs/prism-roadmap.md)
- [Reproduce the release evidence](docs/RELEASE-EVIDENCE.md)
- [Open the completed Wayfinder map](.scratch/prism/issues/00-design-the-dual-route-prism-architecture.md)
- [Read the selected technical baseline](docs/TECH-STACK.md)
- [Review the deferred dashboard-adapter expansion](.scratch/prism/scenarios.md)
- [Read the local tracker conventions](docs/agents/issue-tracker.md)

Run the product:

```bash
pnpm install
pnpm dev
```

The Field Desk is at `/`, Run history at `/runs`, and evaluation analysis at
`/evaluations`. By default the workspace is the repository root and durable data
is stored under `.prism/`. Override them when needed:

```bash
PRISM_WORKSPACE_PATH="/path/with spaces/project" \
PRISM_DATA_DIR="/path/to/prism-data" \
pnpm dev
```

Before release, run the same workspace gates used by the evidence record:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
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
The delivered vertical slice is:

```text
selected Field Desk prototype
→ real Field Desk and shared request contracts
→ durable Run creation and replayable state
→ controlled workspace and browser evidence paths
→ six complete repair scenarios
→ resumable evaluation dashboard and release evidence
```
