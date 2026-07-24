# Choose the six MVP troubleshooting scenarios

State: `closed`  
Status: `ready-for-human`  
Label: `wayfinder:grilling`  
Parent: [ConsoleOps Agent MVP Decision Map](../PRD.md)  
Assignee: `/root`  
Blocked by:
[Choose the TypeScript Chrome-control substrate](01-choose-typescript-chrome-control-substrate.md),
[Map MCP versus browser capabilities for GitHub, Vercel, and Supabase](02-map-mcp-versus-browser-capabilities.md)  
Blocks:
[Define the approval and risk registry](06-define-approval-and-risk-registry.md),
[Choose the trajectory, replay, and evaluation schema](07-choose-trajectory-replay-and-evaluation-schema.md),
[Choose the portfolio demo and success metrics](08-choose-portfolio-demo-and-success-metrics.md),
[Choose the implementation architecture and milestone boundary](10-choose-implementation-architecture-and-milestone-boundary.md)

## Question

Which six repeatable developer problems—ideally two per supported console—best
demonstrate hybrid MCP plus Chrome diagnosis and repair while remaining
authentic, safe, resettable, inexpensive, and small enough for a solo MVP?

The resolution must state the initial state, natural-language prompt, expected
evidence, required Chrome action, approval points, success oracle, reset
procedure, and explicit non-goals for every scenario.

## Comments

<!-- Resolution comments are appended here. -->

### 2026-07-23 — Resolution

Approved six disposable, resettable MVP scenarios:

1. repair a GitHub Actions non-secret repository variable;
2. enable a disabled GitHub fixture workflow;
3. repair a Vercel preview environment value;
4. repair a Vercel Root Directory or equivalent build setting;
5. repair a Supabase fixture RLS read policy;
6. enable a harmless required PostgreSQL extension.

The scenario runner is the primary end-to-end seam:

`prompt -> role handoffs -> MCP evidence -> proposed Chrome repair -> approval -> visible Chrome execution -> audit/replay -> oracle -> reset`

Every scenario requires a disposable fixture, synthetic values, scoped MCP
evidence, a meaningful visible Chrome mutation, policy interception, a
machine-checkable oracle, and deterministic reset.

Full initial states, prompts, evidence, Chrome actions, approvals, oracles,
resets, and non-goals are recorded in the
[approved MVP scenario catalog](../scenarios.md).

The approved I1–I8 implementation breakdown is retained only as a
[staged graph](../implementation-tickets.staged.md). It is not published,
assigned, or `ready-for-agent`; I1 remains blocked by
[Choose the implementation architecture and milestone boundary](10-choose-implementation-architecture-and-milestone-boundary.md).
