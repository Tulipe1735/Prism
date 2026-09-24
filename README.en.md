# Prism

English | [简体中文](README.md)

Prism is a TypeScript browser-agent CLI. Give it a URL and a goal, and it reads the page
into a numbered table of visible controls, lets the decision model choose which
operation to run on which element, and executes over the Chrome DevTools Protocol —
until the decision model judges the goal achieved.

![Prism architecture](docs/architecture.svg)

## Requirements

- Node.js >= 22.19
- A Chrome that can be reached over CDP
- `TYPESAFE_API_KEY`
- An OpenAI-compatible key (CLI mode only; when the MCP host supports sampling, the
  host's own model answers field text)

## Install

```bash
npm install -g @tulipe1735/prism
```

It ships two executables: `prism` (CLI) and `prism-mcp` (MCP server).

## Connect Chrome

Start Chrome in remote-debugging mode. Chrome 136+ refuses remote debugging on its
default profile, so use a dedicated profile and sign in there once:

```bash
# macOS
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir="$HOME/.prism-chrome"

# Linux
google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.prism-chrome"

# Windows
"%PROGRAMFILES%\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=9222 --user-data-dir="%USERPROFILE%\.prism-chrome"
```

## Use as an MCP server

`prism-mcp` is a stdio MCP server that exposes a single task-level tool:

| Tool           | Input                                      | Returns                                                                             |
| -------------- | ------------------------------------------ | ----------------------------------------------------------------------------------- |
| `browser_task` | `url`, `goal`, `max_steps?`, `record_dir?` | `status`, `reason`, `final_url`, `final_title`, `final_text`, `steps`, `elapsed_ms` |

The host delegates the entire browsing subtask; the observe/decide/act loop, freshness
checks, budgets, and the verdict are all Prism's job. Each step is reported as an MCP
progress notification; a cancellation request aborts the run and closes the tab.

When the host declares the `sampling` capability (opencode does), the field text is
answered by the host's own model through `sampling/createMessage`, and
`TEXT_MODEL_API_KEY` is not needed; otherwise Prism falls back to `TEXT_MODEL_*`.
Decisions — which control, which target — always go through TypeSafe and are never
handed to the host model.

opencode (`opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "prism": {
      "type": "local",
      "command": ["prism-mcp"]
    }
  }
}
```

`prism-mcp` must be on PATH (`pnpm link --global` from the repo root), or point
`command` at `["node", "/absolute/path/to/prism/dist/mcp.js"]`. Other MCP clients work
the same way. Keys are read from the server process's environment and from `.env` in its
working directory.

Note: don't pass unset variables through the config as
`"environment": { "TYPESAFE_API_KEY": "{env:TYPESAFE_API_KEY}" }` — an empty value
overrides the key of the same name in `.env` and breaks loading.

## Respect

`src/browser/snapshot.js` comes from
[browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast) and is used
under the MIT License. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
