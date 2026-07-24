# ConsoleOps Agent MVP Decision Map

Label: `wayfinder:map`  
State: `open`

## Destination

Reach an implementation-ready specification for a solo-buildable,
resume-quality TypeScript agent that accepts a natural-language developer
problem and safely combines Chrome computer use with MCP evidence across
GitHub, Vercel, and Supabase/PostgreSQL.

The specification is complete when the product contract, three-agent
responsibilities, Chrome and Pi substrates, supported scenarios, approval
policy, trace/replay format, evaluation method, operator UI, and build
milestones contain no unresolved decisions.

## Notes

- Working title: **ConsoleOps Agent**. Naming remains non-binding.
- Primary user: a Next.js/TypeScript developer troubleshooting their own
  development or preview environments.
- Every MVP scenario must contain a meaningful Chrome interaction; MCP must
  support the browser agent rather than replace it.
- Three roles are fixed at low resolution: Diagnoser/Router, Browser Operator,
  and Auditor. Their exact contracts remain open.
- Supported consoles are GitHub, Vercel, and Supabase/PostgreSQL.
- The selected technical baseline is recorded in
  [Technical baseline](../../docs/TECH-STACK.md):
  `@earendil-works/pi-agent-core`, `playwright-core`,
  `@modelcontextprotocol/sdk@1`, `zod`, `vitest`, `@playwright/test`, and
  `pino`.
- Package selection is fixed for planning, while the open research tickets
  still validate current APIs, integration boundaries, and the smallest thin
  harness required around them.
- Browser actions occur only in disposable test repositories, preview
  deployments, and development database projects.
- Risk is declared by a typed operation registry, never invented at runtime by
  the model.
- Ask for approval (`Strict`) requests approval for every mutation; Approve
  for me (`Balanced`) policy-approves low risk; guarded Full Access
  policy-approves low and medium risk. High risk always requires human
  approval, while unknown and forbidden operations are denied in every mode.
- Use official MCP servers where they exist. Do not rebuild vendor MCP servers.
- Store raw trajectories before considering a long-term memory product.
- Wayfinder sessions must resolve at most one non-research ticket.

## Decisions so far

<!-- Closed-ticket context pointers are appended here. -->
- [Choose the TypeScript Chrome-control substrate](issues/01-choose-typescript-chrome-control-substrate.md) — Keep `playwright-core` behind one visible, locator-first, approval-intercepted Chrome adapter.
- [Map MCP versus browser capabilities for GitHub, Vercel, and Supabase](issues/02-map-mcp-versus-browser-capabilities.md) — Use scoped official MCPs for evidence and verification while Chrome performs selected disposable-console repairs.
- [Verify Pi as the TypeScript orchestration spine](issues/03-verify-pi-typescript-orchestration-spine.md) — Use one Pi `Agent` per role behind a thin ConsoleOps handoff, approval, trace, and recovery harness.
- [Choose the six MVP troubleshooting scenarios](issues/04-choose-six-mvp-troubleshooting-scenarios.md) — Use two disposable scenarios per console, each with scoped MCP evidence, approved visible Chrome repair, replay, oracle, and deterministic reset.
- [Define the three-agent handoff contract](issues/05-define-three-agent-handoff-contract.md) — Separate read-only diagnosis, approved visible Chrome execution, and independent audit with serial DAG problems and typed, bounded handoffs.
- [Define the approval and risk registry](issues/06-define-approval-and-risk-registry.md) — Gate exact semantic operations with a static risk registry, three guarded permission modes, durable single-operation decisions, and LLM-planned deterministic reset.

## Not yet specified

- The operator dashboard interaction design depends on the trace schema and
  portfolio demo contract.
- Whether any cross-run memory layer earns an MVP place depends on evidence
  from repeated benchmark runs; raw replayable trajectories remain the source
  of truth.
- The Google Cloud/Gmail console may become a post-MVP browser-heavy adapter
  after the three-console harness is proven.

## Out of scope

- DreamerV3, reinforcement learning, fine-tuning, and training a UI model
- Training or reproducing UI-TARS
- A generic agent for arbitrary websites or arbitrary developer consoles
- Docker Desktop or other native desktop automation
- Production accounts, customer data, real billing, or irreversible production
  changes
- Autonomous execution of unknown operations
- Rebuilding official GitHub, Vercel, or Supabase MCP servers
- Screenshot-only program repair, SWE-agent replacement, or automated code
  patch generation
- Stripe and Google Cloud/Gmail in the initial three-console MVP
