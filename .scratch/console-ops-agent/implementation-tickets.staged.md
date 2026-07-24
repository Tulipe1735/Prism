# Staged implementation ticket graph

Approval date: 2026-07-23  
Status: `staged`  
Approved scope: eight tickets, the blocking edges below, and the six scenarios
in [the MVP scenario catalog](scenarios.md).

## Planning gate

This file records an approved breakdown; it does not publish executable work.
Do not create these implementation tickets, mark them `ready-for-agent`, assign
them, or begin product implementation until
[Wayfinder ticket 10](issues/10-choose-implementation-architecture-and-milestone-boundary.md)
is closed. I1 is directly blocked by Wayfinder ticket 10, and that gate
therefore blocks the entire graph transitively.

## Approved graph

| ID | Ticket | Blocked by |
| --- | --- | --- |
| I1 | Prove the GitHub Actions-variable tracer | [Wayfinder ticket 10](issues/10-choose-implementation-architecture-and-milestone-boundary.md) |
| I2 | Repair a disabled GitHub workflow | I1 |
| I3 | Repair a Vercel preview environment value | I1 |
| I4 | Repair a Vercel build configuration | I3 |
| I5 | Repair a Supabase RLS policy | I1 |
| I6 | Enable a required Supabase extension | I5 |
| I7 | Demonstrate denial, cancellation, and interruption safety | I1 |
| I8 | Benchmark and package the portfolio demonstration | I2, I4, I6, I7 |

Exact approved edges:

```text
I1 <- Wayfinder ticket 10
I2 <- I1
I3 <- I1
I4 <- I3
I5 <- I1
I6 <- I5
I7 <- I1
I8 <- I2, I4, I6, I7
```

No ticket is to be merged or split before publication unless a later Wayfinder
decision makes the approved boundary impossible. Any such conflict returns to
human review rather than silently changing this graph.

## I1 — Prove the GitHub Actions-variable tracer

Deliver one minimal end-to-end run for S1: natural-language prompt, three role
handoffs, GitHub MCP diagnosis, visible Chrome repair of a non-secret variable,
approval, audit, replay, oracle, and reset.

## I2 — Repair a disabled GitHub workflow

Deliver S2 through the same complete path, including workflow-state evidence,
browser enablement, verified execution, and deterministic reset.

## I3 — Repair a Vercel preview environment value

Deliver S3 using Vercel MCP logs, visible browser configuration repair and
redeploy, replay, verification, and reset.

## I4 — Repair a Vercel build configuration

Deliver S4 using the established Vercel adapter and fixture, including build-log
diagnosis, browser repair, redeploy, verification, and reset.

## I5 — Repair a Supabase RLS policy

Deliver S5 with read-only MCP diagnosis, visible dashboard policy repair,
mandatory high-risk approval, least-privilege verification, replay, and reset.

## I6 — Enable a required Supabase extension

Deliver S6 with extension-state diagnosis, visible dashboard mutation,
independent verification, and safe reversal.

## I7 — Demonstrate denial, cancellation, and interruption safety

Deliver a complete operator story showing denied approval, cancellation,
interrupted mutation handling, durable audit evidence, and no unsafe automatic
retry.

## I8 — Benchmark and package the portfolio demonstration

Evaluate all six scenarios against MCP-only and browser-only baselines. Package
the recruiter-length demonstration, replay comparison, failure reporting, and
defensible metrics.

