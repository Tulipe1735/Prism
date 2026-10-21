# Prism

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/Tulipe1735/Prism)

English | [简体中文](README.md)

**Prism is an extensible personal agent workbench for Windows and WSL.**

Describe a task in the desktop workbench. The agent uses files, commands, browsers and
external tools to carry it out, with visible execution history and results. Cordis
powers the kernel. **Creator Mode** lets you request a capability in natural language,
have the agent create and install a plugin, and use it without restarting.

[Download for Windows](https://github.com/Tulipe1735/Prism/releases/latest) ·
[Documentation](docs/README.md) · [Creator Mode](docs/guide/creator-mode.md) ·
[Plugin development](docs/develop/plugins.md)

## Get started

1. Download and install `Prism-<version>-Setup-x64.exe` from
   [Releases](https://github.com/Tulipe1735/Prism/releases/latest).
2. Open Prism, select **native Windows** or an initialized **WSL distribution**, and
   prepare the runtime.
3. Configure your model endpoint, name and API key; choose a workspace in that
   environment and start a conversation.

Native Windows mode needs neither WSL nor a separate Node installation. WSL mode uses
the selected distribution's Linux toolchain. DeepSeek is the default model;
OpenAI-compatible endpoints are configurable. The first browser download needs network
access. See the [workbench guide](docs/guide/workbench.md) for installation, runtime
selection, data locations and updates.

## Available today

- **Development and file tasks**: read and edit files, search repositories, run commands
  and tests, and inspect changes and artifacts.
- **Browser operation**: observe pages, inspect target context, validate references,
  perform actions and inspect input receipts. Supports Chromium, Firefox, WebKit and
  takeover of a logged-in Chrome or Edge.
- **Extensions**: create and hot-load local plugins with Creator Mode, connect external
  tools through MCP, and load workflow instructions as skills.
- **Continuous sessions**: persist and resume local history, cancel tasks, and compact
  context.
- **Shared canvas**: [Excalidraw](docs/guide/canvas.md) supports manual drawing and
  agent edits, session autosave, and editable file, SVG and PNG export.
- **Visible execution**: streaming responses, tool calls, file changes, approvals and
  settings in the desktop workbench.
- **Windows and WSL**: run the same kernel in the chosen environment, with separate
  workspaces, sessions and plugins.

File and command tools follow read-only, workspace-write or full-access permission
scopes. Writes outside the workspace require one-time approval. Plugins run trusted
local code; MCP servers control their own capabilities. See
[permissions](docs/guide/permissions.md).

## Creator Mode: request a plugin

Open **Settings → Creator Mode**, enable plugin authoring, and ask:

> Create a text word-count plugin, install it, and verify it with Chinese and English
> text.

The agent can inspect the runtime, generate a JavaScript plugin, install it with
`plugin_manager`, then discover and call its tools on the next model request. Plugins
persist in the kernel's data directory and reload after restart. The right-hand Plugins
tab launches Excalidraw and provides enable, disable, reload and remove actions for
custom plugins. A failed update restores the previous version.

Creator Mode is off by default. Turning it off leaves enabled plugins running. This
version supports kernel tools and events; DSH plugin compatibility depends on the
required host interfaces. See [usage](docs/guide/creator-mode.md) and the
[authoring contract](docs/develop/plugins.md).

## Browser CLI for other agents

The standalone `prism` browser-use CLI lets external agents plan and evaluate tasks
while Prism observes the browser, validates references and executes individual actions.
It needs no model key.

```bash
npm install -g @tulipe1735/prism
prism --help
```

[Browser CLI guide](docs/guide/browser-cli.en.md) · [Agent skill](skills/prism/SKILL.md)

## Direction

Prism aims to combine browsers, application CLIs and application object interfaces so
CLI agents can complete more real software tasks. Future work includes CLI-Anything
integration, object-level operation of applications such as WPS, and Harness²-inspired
refinement based on execution evidence. **Those integrations and automatic refinement
are not implemented yet.** The workbench, built-in tools, MCP, skills, browser CLI and
Creator Mode are available now.

## Documentation and development

- [Documentation index](docs/README.md)
- [Run, verify and release from source](docs/develop/README.md)
- [Plugin development](docs/develop/plugins.md)
- [Architecture](docs/reference/architecture.md) ·
  [Kernel HTTP/SSE contract](docs/reference/kernel.md)
- [Cordis plugin lifecycle](docs/reference/plugins.md) · [Glossary](GLOSSARY.md)

Requires Node.js ≥22.23.2 and pnpm:

```bash
pnpm install
pnpm build
pnpm workbench
```

Source: [kernel](src/kernel) · [workbench](src/workbench) ·
[browser CLI](src/interfaces/cli.ts)

Plugin design and documentation organization draw on
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). The Creator Mode
idea is discussed in the
[DeepSeek Harness lecture slides](https://jyywiki.cn/GSE/2026/slides9.html).

MIT License.
