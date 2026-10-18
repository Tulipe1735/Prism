# Prism

English | [简体中文](README.md)

A personal coding agent built for long-term use. The desktop workbench runs on Windows,
and the agent works in WSL on your repository: reading code, editing files, running
commands and tests, and verifying task results.

Prism runs its own task loop and ships with a Prism browser tool, MCP, skills, web
search, and cross-session memory. The default model is DeepSeek.

Code: [browser capability](src/browser) · [browser CLI](src/interfaces/cli.ts) ·
[receipts and sessions](src/cli/sessions.ts)

## Status

Under reconstruction. The previous personal research assistant has been removed; the new
agent kernel runs headless today, the Electron desktop is not implemented yet.

Available today: the `prism` browser CLI, documented in the
[browser guide](docs/browser-cli.md); the kernel serves its sessions, task loop and tool
execution over local HTTP/SSE, described in the
[kernel contract](docs/kernel-contract.md).

## First-version goals

- **Desktop workbench**: an Electron interface on Windows with workspaces, sessions,
  chat, tool activity, code changes, and task artifacts. No built-in editor, file tree,
  or interactive terminal.
- **Full development loop**: read and write files, run commands and tests in a WSL
  workspace, with verifiable results.
- **Preset capabilities**:
  - Prism browser: observation, target references, action validation, and input
    receipts, implemented by the [kernel browser module](docs/kernel-browser.md); serves
    the built-in agent first, and may open up to external agents later.
  - MCP: connect external tool servers, configured in [mcp.json](docs/mcp.md).
  - Skills: loaded on demand from directory conventions.
  - Web search: built-in `web_search` and `web_fetch`, DeepSeek by default,
    configurable.
  - Cross-session memory: session history is persisted, resumable, and compactable.
- **Permission boundary**: three scopes (read-only / workspace-write / full access) with
  out-of-scope approvals granted once; modeled after
  [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
- **Model**: DeepSeek API by default; any OpenAI-compatible endpoint can be configured.

## Architecture

![Prism architecture](docs/architecture.svg)

The Electron interface runs on Windows; the kernel runs in WSL. The two communicate over
local HTTP/SSE, and the desktop starts the kernel through `wsl.exe`. See
[ADR-0001](docs/adr/0001-windows-ui-wsl-execution.md).

[Editable Excalidraw source](docs/architecture.excalidraw) · [Glossary](GLOSSARY.md) ·
[Requirements](docs/requirements-2026-10-18-coding-agent.md)

## Development

Requires Node.js ≥22.19 and pnpm.

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

See [skills/prism](skills/prism/SKILL.md) for the agent skill of the existing browser
CLI, and [docs/skills.md](docs/skills.md) for the kernel's skill directory convention
and priority order.

The kernel starts headless, listens on `127.0.0.1` and prints its address as one JSON
line (interface in [docs/kernel-contract.md](docs/kernel-contract.md)):

```bash
node --experimental-strip-types --disable-warning=ExperimentalWarning \
  src/interfaces/kernel.ts [--port <n>] [--data-dir <path>]
```

MIT License. The README follows the structure of
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
