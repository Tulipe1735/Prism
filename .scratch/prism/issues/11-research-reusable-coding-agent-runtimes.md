# Research reusable coding-agent runtimes

Type: `wayfinder:research`  
Parent: `issues/00-design-the-dual-route-prism-architecture.md`  
State: `closed`  
Status: `ready-for-agent`  
Assignee: `/root/research_coding_agents`  
Blocked by: `none`

## Question

Which actively maintained open-source coding-agent runtimes, libraries, or npm
packages can provide repository inspection, patch generation, command
execution, test feedback, resumable state, and a programmatic embedding
boundary suitable for Prism? Compare TypeScript, Python, and
cross-language options using primary sources and recommend a shortlist rather
than selecting the winner.

## Comments

## Resolution

Research is recorded in [Reusable coding-agent runtimes](../research/coding-agent-runtimes.md).
Carry OpenCode, Codex, and OpenHands forward as production candidates, with
mini-SWE-agent as a minimal Python reference implementation. Use ACP v1 as a
candidate cross-language adapter boundary rather than as the runtime itself,
and select the production backend only after the candidates pass the same
repository-edit, test-repair, restart/resume, policy-denial, cancellation, and
Windows/WSL contract spike.
