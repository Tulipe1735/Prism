# Visual SWE Harness

This repository is the planning workspace for **ConsoleOps Agent** (working
title): a resume-sized TypeScript project that combines Chrome computer use
with structured MCP evidence to diagnose and safely repair configuration
problems across a small web-development stack.

## Current status

The project is in Wayfinder planning. No implementation has started.

- [Open the canonical decision map](.scratch/console-ops-agent/PRD.md)
- [Read the selected technical baseline](docs/TECH-STACK.md)
- [Read the local tracker conventions](docs/agents/issue-tracker.md)
- [Browse the decision tickets](.scratch/console-ops-agent/issues/)

## Locked product boundary

- Natural-language problem input
- Chrome computer use is required in every MVP scenario
- Official MCP servers support diagnosis and independent verification
- Initial consoles: GitHub, Vercel, and Supabase/PostgreSQL
- Three roles: Diagnoser/Router, Browser Operator, and Auditor
- TypeScript, `@earendil-works/pi-agent-core`, and a Next.js operator/replay
  interface
- `playwright-core` for Chrome/CDP and
  `@modelcontextprotocol/sdk@1` for MCP clients
- Balanced and Strict approval modes backed by a static risk registry

The implementation plan will be written only after the open decision tickets
have been resolved.
