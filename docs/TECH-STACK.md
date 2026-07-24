# Technical baseline

Status: **selected for planning; not yet implemented**

These packages are the current implementation baseline. Open Wayfinder research
tickets validate their integration boundaries and current APIs; they do not
reopen the stack without concrete evidence.

## Application layer

| Technology | Responsibility |
| --- | --- |
| TypeScript | Shared language for the harness, adapters, schemas, and UI |
| Next.js | Operator console, approval UI, run status, and replay viewer |

Exact framework and runtime versions will be pinned when the implementation
architecture ticket resolves.

## Agent and integration runtime

| Package | Responsibility |
| --- | --- |
| `@earendil-works/pi-agent-core` | Agent loop, event streaming, tool preflight, and context transformation |
| `playwright-core` | Chrome/CDP connection, browser sessions, screenshots, and UI actions |
| `@modelcontextprotocol/sdk@1` | MCP client transport, discovery, and tool invocation |

Pi has migrated to the `@earendil-works/pi-agent-core` package name. The MCP
TypeScript SDK stays on major version 1 for the MVP because version 2 remains a
future migration rather than an implementation prerequisite.

References:

- [Pi Agent Core package](https://www.npmjs.com/package/@earendil-works/pi-agent-core)
- [Official MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)

## Contracts, testing, and observability

| Package | Responsibility |
| --- | --- |
| `zod` | Runtime schemas for operations, trajectories, approvals, fixtures, and adapter boundaries |
| `vitest` | Unit tests for policy, schemas, routing, and trace behavior |
| `@playwright/test` | End-to-end scenario fixtures, verifiers, retries, and evidence capture |
| `pino` | Structured operational logs with run and trace correlation identifiers |

## Intended layering

```text
Next.js operator and replay UI
                |
@earendil-works/pi-agent-core
                |
typed operation registry (zod)
        /                       \
playwright-core             MCP SDK v1
Chrome observations         structured evidence
and approved actions        and verification
        \                       /
 pino trace events + Vitest/Playwright verification
```

## Guardrails

- `playwright-core` is the browser substrate; `@playwright/test` is the
  scenario-verification layer. Do not collapse their responsibilities.
- MCP tools support diagnosis and verification but do not remove the required
  Chrome interaction from an MVP scenario.
- Every MCP result, browser action, approval, and verifier result must cross a
  Zod-validated boundary before being recorded.
- Pino logs are operational diagnostics. The replayable trajectory schema
  remains the durable source of truth.
- Package selection does not imply that approval pause/resume, three-agent
  handoffs, or replay are provided automatically. The Pi research ticket must
  identify the thin harness required around confirmed APIs.
- No dependency installation is authorized by this planning document.
