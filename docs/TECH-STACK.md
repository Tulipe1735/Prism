# Prism technical baseline

Status: `selected for the approved roadmap; not yet implemented`

This document describes the current Prism technology boundary. Exact dependency versions and any package name not fixed by the approved architecture are pinned during R1 or the owning implementation ticket.

## Product runtime

| Technology | Responsibility |
| --- | --- |
| TypeScript on Node.js | Orchestrator, contracts, runtimes, controlled executors, CLI, and evaluation tooling |
| pnpm workspace | Package boundaries and distribution |
| Pi Agent SDK | Embedded Coding Runtime session and coding trajectory events |
| UI-TARS SDK | Embedded Browser Runtime visual grounding and typed action proposals |

The Orchestrator and both SDK runtimes run in one Node.js process for the MVP. This is a deployment choice, not an authority shortcut: source, shell, test, and browser effects still cross controlled executors.

Do not inherit the former ConsoleOps package name or version pins by default. R1 must pin the actual Pi and UI-TARS packages against the interfaces approved in the roadmap.

## Prism-owned packages

```text
apps/
  cli/
packages/
  contracts/
  orchestrator/
  runtime-pi/
  runtime-ui-tars/
  workspace-executor/
  action-broker/
  trajectory-store/
  eval/
fixtures/
  react-repair/
```

- `contracts` owns versioned DAG, task-envelope, outcome, evidence, event, and artifact schemas.
- `orchestrator` owns routing, DAG revisions, scheduling, budgets, cancellation, and the fenced exclusive effect lease.
- `runtime-pi` and `runtime-ui-tars` translate SDK events into Prism contracts; neither may execute unrestricted effects or mutate the DAG.
- `workspace-executor` confines repository reads, patches, commands, and tests.
- `action-broker` validates browser proposals and owns BrowserExecutor access.
- `trajectory-store` owns the append-only journal, hashed artifacts, and rebuildable snapshots.
- `eval` owns deterministic fault tests, React scenarios, and the frozen SWE-bench non-regression manifest.

## Browser and verification boundary

The UI-TARS SDK is a planner and grounder, not the security boundary. A custom Prism operator maps each prediction to a typed browser proposal. The ActionBroker checks target freshness, origin, effect class, authority, approval, and lease before BrowserExecutor input.

Use semantic or hybrid targets where possible. A coordinate target must be bound to the screenshot hash, viewport, device-pixel ratio, tab, and page state that produced it. Stale targets fail closed.

Deterministic browser predicates and fixture oracles are authoritative. Screenshots, UI-TARS judgment, Playwright traces, console data, and network data are evidence artifacts, not substitutes for the oracle.

## Testing and observability requirements

Implementation packages must select libraries that provide:

- runtime schema validation for every cross-package contract;
- deterministic unit and fault testing;
- browser fixture control, screenshots, traces, console, and network evidence;
- structured events with run, DAG, node, attempt, correlation, and causation identity;
- Windows-safe artifact paths and deterministic process cleanup.

The exact schema, test, logging, and browser-executor packages remain R1/R4/R8 implementation pins unless the approved roadmap names them explicitly.

## Deferred dashboard adapters

Future GitHub, Vercel, and Supabase adapters may add project-scoped, normally read-only vendor MCP evidence beside visible browser repair. They reuse Prism ActionBroker, approval, journal, artifact, oracle, reset, and recovery contracts; they do not revive the former ConsoleOps product or become a third runtime.

See [Prism future dashboard adapters](../.scratch/prism/scenarios.md).

No dependency installation is authorized by this planning document.
