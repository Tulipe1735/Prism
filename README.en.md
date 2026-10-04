# Prism

[简体中文](README.md) | English

Prism is a browser-use CLI for an external agent. The agent plans, chooses targets and
decides whether the task is complete. Prism observes the browser, exposes target
context, validates references and sends one input operation. Prism needs no model key
and never calls a model.

## Architecture

![Prism browser-use CLI for agents architecture](docs/architecture.svg)

The external agent makes decisions. Prism exposes observation and relation evidence,
checks reference and evidence freshness, sends input and saves receipts. `executed`
means input acknowledged, not task success.

[Editable Excalidraw source](docs/architecture.excalidraw)

## Requirements

- Node.js ≥22.19.0
- A reachable Chrome with remote debugging. The default profile of Chrome 136+ refuses
  remote debugging, so use a separate profile:

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.prism-chrome"
```

## Install

```bash
npm install -g @tulipe1735/prism
```

`pnpm add -g @tulipe1735/prism` works too. The package installs the `prism` executable.

## Use

```bash
prism session open --url https://example.com --browser-url http://127.0.0.1:9222
prism observe --session <session> --scope local
prism context --session <session> --observation <observation> --target <ref> --scope relations
prism act --session <session> --observation <observation> --target <ref> --evidence <evidence> --operation click --request-id decision-1
prism receipt --session <session> --request-id decision-1
prism session close --session <session>
```

Replace placeholders with values from the previous JSON response. Each `observe` issues
new observation, evidence and target refs; a new observation expires old refs.
`prism <command> --help` shows arguments and examples. The complete agent instructions
are in [skills/prism/SKILL.md](skills/prism/SKILL.md).

## Run from source

Contributors need pnpm:

```bash
pnpm install
pnpm build
node dist/cli.js --help
```

`pnpm dev` runs commands from source without producing `dist/`.
