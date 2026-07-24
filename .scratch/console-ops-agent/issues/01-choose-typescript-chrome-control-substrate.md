# Choose the TypeScript Chrome-control substrate

State: `closed`  
Status: `ready-for-agent`  
Label: `wayfinder:research`  
Parent: [ConsoleOps Agent MVP Decision Map](../PRD.md)  
Assignee: `/root`  
Selected baseline: `playwright-core`  
Blocked by: none  
Blocks:
[Choose the six MVP troubleshooting scenarios](04-choose-six-mvp-troubleshooting-scenarios.md),
[Define the three-agent handoff contract](05-define-three-agent-handoff-contract.md),
[Choose the implementation architecture and milestone boundary](10-choose-implementation-architecture-and-milestone-boundary.md)

## Question

How should the selected `playwright-core` Chrome/CDP substrate be layered with
multimodal reasoning to produce screenshot observations and reliable browser
actions while preserving visible computer-use behavior, replayability, and
safe interception?

The answer must validate current official capabilities, Windows development
friction, authentication/session reuse, screenshot/action primitives,
locator-first versus coordinate actions, replay hooks, approval interception,
and the minimum thin adapter. Provider-native computer-use SDKs and UI-TARS
may be evaluated as optional reasoning/action layers, not replacement
substrates.

## Comments

<!-- Resolution comments are appended here. -->

### 2026-07-23 — Resolution

Keep `playwright-core` as the selected substrate. Use a visible, dedicated
Chrome/Chrome-for-Testing profile, locator-first typed actions, screenshot-bound
coordinate fallback, and one adapter-owned approval/trace interception point.
Playwright traces remain supplementary to the ConsoleOps trajectory.

Full findings: [TypeScript Chrome-control substrate research](../research/chrome-control-substrate.md).
