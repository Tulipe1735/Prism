# Design the dual-route Prism architecture

Type: `wayfinder:map`  
State: `closed`  
Status: `complete`  
Assignee: `unassigned`  
Blocked by: `none`

## Destination

Update the existing Prism roadmap into a developer-ready architecture
specification for a standalone TypeScript product whose first vertical slice
repairs objectively verifiable React interaction, state, layout, visibility,
and directional-style defects from a text prompt. Its embedded Pi Agent SDK
Coding Runtime edits source, its embedded UI-TARS Browser Runtime reproduces
and verifies the rendered result, and its Orchestrator coordinates both through
a safe, dynamically expanded Run DAG.

## Notes

- This map plans the architecture; it does not implement the runtime.
- The browser route reproduces, observes, interacts, and verifies. It does not
  edit source code.
- The coding-agent route owns source inspection and source-code edits.
- Initial routing chooses the best starting route, not a permanent route.
  Either route may request a structured handoff during the run.
- A React frontend-repair task may start coding-first when the prompt and source
  are sufficient, or browser-first when reproduction, localization, or a
  rendered baseline is needed. Browser verification closes the task only with
  explicit evidence.
- Retain safety, approval, audit, replay, oracle, reset, and workspace
  confinement as architecture constraints, scaled to local frontend fixtures.
- Prism is a standalone TypeScript product. Its Orchestrator embeds sibling runtimes: a Pi Agent SDK-based Coding Runtime and a UI-TARS SDK-based Browser Runtime.
- Use `wayfinder` for this map. Research findings live under
  `.scratch/prism/research/` because this planning directory is not
  a Git repository and cannot provide throwaway research branches.

## Decisions so far

- [Research reusable coding-agent runtimes](11-research-reusable-coding-agent-runtimes.md) — Surveyed reusable coding runtimes and adapter boundaries; the later embedding decision selects Pi Agent SDK for Prism's built-in Coding Runtime.
- [Research browser observer and UI-TARS integration](12-research-browser-observer-and-ui-tars-integration.md) — Use UI-TARS behind a project-owned typed Action Broker and browser executor, with screenshot, DOM, action, and verification evidence; the TypeScript path is the MVP.
- [Define the routing and switching policy](13-define-routing-and-switching-policy.md) — The Router emits a typed initial classification and immutable Run DAG skeleton; the Orchestrator alone expands allowlisted nodes through append-only revisions, permits parallel reads, and serializes effects with one lease.
- [Choose the coding-agent embedding strategy](14-choose-the-coding-agent-embedding-strategy.md) — Embed Pi Agent SDK and UI-TARS SDK as sibling same-process runtimes behind shared typed contracts and controlled workspace/browser executors; pnpm packages modularize Prism rather than extend a host agent.
- [Define the browser evidence contract](15-define-the-browser-evidence-contract.md) — Normalize natural-language frontend intent into typed rendered predicates; require deterministic browser evidence plus localized screenshots, keep UI-TARS judgment supplemental, and broker every browser effect without code-write capability.
- [Define shared run state and handoffs](16-define-shared-run-state-and-handoffs.md) — Use an append-only event journal and hashed artifacts as canonical state, exchange typed node envelopes, and recover across process restarts at committed node boundaries with reconciliation for unknown effects.
- [Choose the React frontend-repair MVP scenarios](17-choose-the-react-frontend-repair-mvp-scenarios.md) — Use one isolated local React fixture with two directional change requests and four reproducible interaction, state, responsive-layout, and occlusion bugs; every scenario requires code changes, browser verification, dual oracles, and deterministic reset.
- [Choose the dual-route evaluation gates](18-choose-dual-route-evaluation-gates.md) — Report a paired 12-task SWE-bench coding non-regression guard separately from the primary 18-attempt React suite; require structural route validity, zero safety violations, reconstructible replay, and manifest-bounded resources.
- [Prototype the developer-ready roadmap revision](19-prototype-the-developer-ready-roadmap-revision.md) — Accept a 13-node replacement DAG for final review, with M1 ending at the R9 round-button dual-runtime vertical slice and R10–R13 reserved for hardening, remaining scenarios, evaluation, and packaging.
- [Choose the implementation architecture and milestone boundary](10-choose-implementation-architecture-and-milestone-boundary.md) — Approved the durable developer-ready roadmap, its R1–R13 replacement DAG, and M1 boundary at R9 without authorizing implementation.

## Not yet specified

- None.

## Out of scope

- Implementing or publishing executable product tickets during this map.
- GitHub, Vercel, Supabase, and other third-party dashboard repair scenarios
  are deferred beyond R1–R13; their reusable constraints and candidate fixtures
  are retained in [Prism future dashboard adapters](../scenarios.md).
- Open-ended aesthetic design prompts without a confirmable repair plan are
  outside the MVP evaluation boundary.
- Treating Prism as a plugin for a customer's existing coding agent, or adding
  Python, child-process, remote-worker, or generic host-plugin runtimes to the
  MVP.
- Weakening the existing approval, audit, replay, oracle, reset, or
  production-safety boundaries.
