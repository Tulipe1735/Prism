# Verify Pi as the TypeScript orchestration spine

State: `closed`  
Status: `ready-for-agent`  
Label: `wayfinder:research`  
Parent: [ConsoleOps Agent MVP Decision Map](../PRD.md)  
Assignee: `/root`  
Selected baseline: `@earendil-works/pi-agent-core`  
Blocked by: none  
Blocks:
[Define the three-agent handoff contract](05-define-three-agent-handoff-contract.md),
[Choose the trajectory, replay, and evaluation schema](07-choose-trajectory-replay-and-evaluation-schema.md),
[Choose the implementation architecture and milestone boundary](10-choose-implementation-architecture-and-milestone-boundary.md)

## Question

Can the current `@earendil-works/pi-agent-core` package cleanly serve as the
TypeScript orchestration spine for three role agents, typed MCP/browser tools,
approval pauses, multimodal screenshot messages, cancellation, and structured
trajectory events; and where does the project need a thin harness abstraction
rather than relying on Pi directly?

The answer must verify the package's current agent loop, event streaming, tool
preflight, and context-transform APIs; document current limitations; and
define the smallest viable integration contract without assuming roadmap
features exist.

## Comments

<!-- Resolution comments are appended here. -->

### 2026-07-23 — Resolution

Keep `@earendil-works/pi-agent-core` as the orchestration spine, with one
`Agent` per role. Pi supplies the loop, multimodal messages, validated tool
preflight, event streaming, context transformation, and cooperative
cancellation. A thin ConsoleOps coordinator must own typed handoffs, approval
durability, the static risk registry, correlation, canonical trajectory, and
recovery policy.

Full findings: [Pi TypeScript orchestration-spine research](../research/pi-typescript-orchestration-spine.md).
