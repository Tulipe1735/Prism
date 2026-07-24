# Choose the coding-agent embedding strategy

Type: `wayfinder:grilling`  
Parent: `issues/00-design-the-dual-route-prism-architecture.md`  
State: `closed`  
Status: `ready-for-human`  
Assignee: `/root`  
Blocked by: `issues/11-research-reusable-coding-agent-runtimes.md`

## Question

How should standalone Prism embed a Pi Agent SDK-based Coding Runtime and a UI-TARS SDK-based Browser Runtime as sibling executors behind the Orchestrator, and which tool, state, lifecycle, policy, persistence, and pnpm package boundaries belong to each runtime?

## Comments

### 2026-07-24 — Local TypeScript adapter scope and lightweight selection eval

Human scope decision: the MVP does not provide Python workers, cross-language worker hosting, or a WorkBuddy-style multi-runtime platform. The Orchestrator and adapter contract are TypeScript-first. A coding runtime executes locally under Orchestrator control; future adapters may be distributed as pnpm packages, but runtime package installation is a user/developer action and is not an agent capability. The MVP ships one official adapter.

The official adapter will be selected by running OpenCode and Codex candidates against the same fixed manifest of 25 SWE-bench Verified tasks with the same model, prompt, tools, token/step/time budget, and environment. Compare resolved rate first, then crashes/timeouts, cost, latency, and adapter complexity. Do not build a heavy adapter-specific conformance suite; retain only minimal implementation smoke checks for startup, cancellation, workspace confinement, and process cleanup.

### 2026-07-24 — Pivot from embedded runtime to Pi host extension

Human correction: Prism should not select, embed, or replace a customer coding runtime. The customer keeps the existing Pi coding agent, and installing the Prism Pi package adds controlled browser-based reproduction, interaction, evidence, and verification capabilities. This supersedes the earlier OpenCode-versus-Codex runtime selection plan and removes Python workers, cross-language runtime hosting, and ACP from the MVP.

## Superseded resolution — Pi host-extension model

Do not embed a coding runtime. Pi is the first and only MVP host and remains responsible for repository inspection, source edits, shell commands, and tests. Prism ships as a TypeScript Pi package containing a first-party extension plus any supporting skill or prompt resources. The extension subscribes to Pi lifecycle and tool events, registers the Visual SWE tools, and maps Pi code activity and browser activity into the authoritative Orchestrator Run DAG.

The package adds browser-scoped Computer Use through the BrowserWorker and typed ActionBroker; it never grants Pi a raw unrestricted browser or desktop-control tool. The Orchestrator retains DAG revisions, effect leases, approvals, budgets, evidence, cancellation, and replay. Pi remains the coding worker rather than becoming a runtime dependency owned by Prism.

Installation and upgrades are explicit user or developer actions through Pi package management. The agent cannot install or update its own capability package. The MVP supports only the official Pi host extension. Future host integrations may be shipped as separate packages against a stable host-adapter contract, but generic third-party host loading is outside the MVP. Evaluate the same Pi model and configuration before and after installing Prism, rather than comparing embedded coding runtimes.

### 2026-07-24 — Reopen: standalone dual-runtime Prism

Human correction: Prism remains a standalone product with its own Coding Runtime and Browser Runtime. The Coding Runtime should be built by embedding the Pi Agent SDK; the Browser Runtime should be built from the UI-TARS SDK. Both are sibling runtimes scheduled by the Prism Orchestrator. A pnpm package is a distribution and modularization mechanism, not a Pi plugin boundary. The previous Pi host-extension resolution is superseded and this ticket is reopened to specify the embedded runtime and package boundaries.

### 2026-07-24 — Same-process SDK runtimes with controlled executors

Human decision: for the MVP, the Orchestrator, Pi Agent SDK Coding Runtime, and UI-TARS SDK Browser Runtime run in one Node.js process behind separate typed package interfaces. Shell commands, source mutations, and browser input are not executed directly by either SDK loop; they pass through capability-specific controlled executors governed by the Orchestrator effect lease and policy.

## Resolution

Prism is a standalone TypeScript product with two sibling runtimes embedded by one Orchestrator. The Coding Runtime wraps a Pi Agent SDK session and owns code reasoning, repository inspection, patch proposals, shell/test requests, and coding trajectory events. The Browser Runtime wraps UI-TARS `GUIAgent` with a custom Prism Operator and owns screenshots, visual grounding, typed browser-action proposals, and verification evidence.

Both SDK loops run in the Orchestrator Node.js process for the MVP and implement a shared `RuntimeExecutor` contract. Neither runtime may modify the Run DAG. They consume typed node inputs and return typed artifacts and `NodeOutcome` values. A WorkspaceExecutor performs allowlisted file, patch, shell, and test effects for the Coding Runtime; the ActionBroker plus BrowserExecutor performs approved browser effects for the Browser Runtime. The exclusive effect lease remains authoritative across both executors.

Use pnpm workspace packages for modularization and distribution, not as a host-agent plugin model: `contracts`, `orchestrator`, `runtime-pi`, `runtime-ui-tars`, `workspace-executor`, `action-broker`, `trajectory-store`, and a Prism CLI application. Package boundaries must allow later process isolation without changing DAG or artifact schemas, but child-process runtimes, Python workers, remote workers, and generic host plugins are outside the MVP.
