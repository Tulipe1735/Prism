# Research browser observer and UI-TARS integration

Type: `wayfinder:research`  
Parent: `issues/00-design-the-dual-route-prism-architecture.md`  
State: `closed`  
Status: `ready-for-agent`  
Assignee: `/root/research_browser_worker`  
Blocked by: `none`

## Question

Which current open-source components and integration patterns can implement a
browser-only evidence, interaction, and verification worker using UI-TARS or a
compatible visual browser-control stack while preserving visible Chrome
actions, typed approvals, replay, and structured handoff to a coding agent?
Use primary sources and recommend interface patterns, not a final product
choice.

## Comments

## Resolution

Recommend a layered browser-only worker: UI-TARS or Midscene performs visual grounding and proposes one typed action at a time; a project-owned action broker applies policy and approval before Playwright/CDP executes it; Playwright traces plus redacted console, network, screenshot, and verification artifacts form the structured evidence handoff to the separate coding agent. Shortlist Midscene + Playwright for the fastest TypeScript prototype, `@ui-tars/sdk` with a custom brokered browser Operator for maximum policy control, and Browser Use with the same broker/trace contracts as the Python alternative. Stagehand `observe -> validate -> act` and Playwright MCP are useful structured-path patterns, while Chrome DevTools for agents is best kept as an evidence sidecar. The comparison, interfaces, risks, and evaluation gates are in [Browser observer and UI-TARS integration research](../research/browser-observer-ui-tars.md).
