# Prism technical baseline

Status: `initial Field Desk and shared request contracts implemented`

This document describes the current Prism technology boundary. The Field Desk
and first contract seam are verified; runtime, executor, persistence, browser,
and evaluation packages remain owned by later implementation tickets.

## Product runtime

| Technology | Responsibility |
| --- | --- |
| Next.js 15.5.21 + React 19.2.8 | Production Field Desk and second-level Run dossier routes |
| TypeScript on Node.js | Orchestrator, contracts, runtimes, controlled executors, CLI, and evaluation tooling |
| pnpm 9.15.9 + Turborepo 2.10.7 | Package boundaries and shared build, typecheck, lint, and test tasks |
| Zod 4.4.3 | Versioned repair-request and boundary-response validation |
| Vitest 3.2.7 | Node 18-compatible deterministic contract and route tests |
| Pi Agent SDK | Embedded Coding Runtime session and coding trajectory events |
| UI-TARS SDK | Embedded Browser Runtime visual grounding and typed action proposals |

Next.js, React, and React DOM are exact pins verified together by the production
build and prototype regression. The repository reuses the selected Tailwind,
Radix UI, class-variance-authority, clsx, tailwind-merge, and Lucide foundation
without importing unrelated authentication, payments, database, or Redis
dependencies.

The Orchestrator and both SDK runtimes will run in one Node.js process for the
MVP. This is a deployment choice, not an authority shortcut: source, shell,
test, and browser effects still cross controlled executors.

Do not inherit the former ConsoleOps package name or version pins by default.
The owning R6 and R7 runtime tickets must pin the actual Pi and UI-TARS
packages against the interfaces approved in the roadmap; the initial Field Desk
slice does not preinstall either SDK.

## Current workspace

```text
apps/
  web/
packages/
  contracts/
  tooling-config/
```

- `web` owns the real Field Desk, request validation API boundary, Run history
  empty state, and second-level dossier route.
- `contracts` currently owns only the v1 repair request, validation receipt,
  structured boundary error, workspace, and viewport schemas.
- `tooling-config` shares TypeScript, ESLint, Prettier, and Vitest configuration.

The following approved packages remain planned:

```text
packages/
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

- Later contract tickets extend `contracts` with versioned DAG, task-envelope,
  outcome, evidence, event, and artifact schemas.
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

Logging and browser-executor packages remain implementation pins for their
owning tickets.

## Deferred dashboard adapters

Future GitHub, Vercel, and Supabase adapters may add project-scoped, normally read-only vendor MCP evidence beside visible browser repair. They reuse Prism ActionBroker, approval, journal, artifact, oracle, reset, and recovery contracts; they do not revive the former ConsoleOps product or become a third runtime.

See [Prism future dashboard adapters](../.scratch/prism/scenarios.md).
