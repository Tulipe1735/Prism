# Map MCP versus browser capabilities for GitHub, Vercel, and Supabase

State: `closed`  
Status: `ready-for-agent`  
Label: `wayfinder:research`  
Parent: [ConsoleOps Agent MVP Decision Map](../PRD.md)  
Assignee: `/root`  
Blocked by: none  
Blocks:
[Choose the six MVP troubleshooting scenarios](04-choose-six-mvp-troubleshooting-scenarios.md),
[Define the approval and risk registry](06-define-approval-and-risk-registry.md),
[Choose the implementation architecture and milestone boundary](10-choose-implementation-architecture-and-milestone-boundary.md)

## Question

For GitHub, Vercel, and Supabase, which developer troubleshooting operations
are currently available through each official MCP server, which meaningful
operations or evidence remain browser-only, and which small set of hybrid
workflows is safe and reversible enough for an MVP benchmark?

The answer must use current first-party documentation and distinguish read,
write, destructive, billing, secret, security, preview/development, and
production capabilities.

## Comments

<!-- Resolution comments are appended here. -->

### 2026-07-23 — Resolution

Use the official GitHub, Vercel, and Supabase MCP servers as scoped evidence
and independent-verification channels. Keep selected console-setting repairs
browser-owned in disposable repositories, preview projects, and development
databases. Default MCP access to project-scoped, allow-listed, read-only tools;
exclude production, secrets, billing, account administration, and destructive operations.

Full findings: [MCP versus browser capability audit](../research/mcp-versus-browser-capabilities.md).
