# Prism implementation

Status: active

## Source of truth

This feature executes the approved [Prism developer-ready roadmap](../../docs/prism-roadmap.md)
through the local tickets in `issues/`. The roadmap remains authoritative for
runtime ownership, safety boundaries, milestones, and deferred scope.

## Outcome

Deliver a standalone TypeScript Visual SWE harness that accepts a natural-language
frontend repair request, creates replayable Run state, confines workspace and browser
effects, coordinates the Pi and UI-TARS runtimes, and returns rendered evidence.

## Delivery boundary

Implementation proceeds in dependency order from the real Field Desk and shared
contracts through durable Runs, controlled executors, runtime integration, browser
oracles, recovery, evaluation, and release evidence.

The first completed slice owns only:

- the production-shaped Next.js Field Desk and second-level Run dossier hierarchy;
- versioned repair-request, validation-receipt, and contract-error schemas;
- independent browser and server validation of the same request schema;
- honest empty states until durable Run persistence exists; and
- the shared pnpm, Turborepo, TypeScript, lint, formatting, and test foundation.

## Non-goals for the first slice

- Creating a Run or inventing mock Run, DAG, evidence, or verdict records.
- Installing Pi or UI-TARS before their owning runtime tickets.
- Adding authentication, payments, databases, Redis, or dashboard adapters.
- Treating the roadmap as proof that a planned runtime is already implemented.
