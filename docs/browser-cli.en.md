# Prism

[简体中文](browser-cli.md) | English

Prism is a browser-use CLI for an external agent. The agent plans, chooses targets and
decides whether the task is complete. Prism observes the browser, exposes target
context, validates references and sends one input operation. Prism needs no model key
and never calls a model.

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

## Let an agent install it

Give your agent this prompt to install Prism and connect it to itself:

```text
Install Prism for browser work:
1. Run `npm install -g @tulipe1735/prism` and check `prism --version`.
2. Copy `$(npm root -g)/@tulipe1735/prism/skills/prism` into your skills
   directory, for example `~/.config/opencode/skills/prism` for opencode or
   `~/.claude/skills/prism` for Claude Code.
3. Copy `$(npm root -g)/@tulipe1735/prism/commands/prism.md` into your commands
   directory, for example `~/.config/opencode/commands/prism.md` for opencode or
   `~/.claude/commands/prism.md` for Claude Code.
4. Restart, then use the prism skill or `/prism <url>` for browser tasks.
```

The agent needs shell access and write access to its own configuration directory.

## Use

```bash
prism session open --url https://example.com --browser-url http://127.0.0.1:9222
prism observe --session <session> --scope local
prism context --session <session> --observation <observation> --target <ref> --scope relations
prism act --session <session> --observation <observation> --target <ref> --evidence <evidence> --operation click --request-id decision-1
prism session close --session <session>
```

Replace placeholders with values from the previous JSON response. Each `observe` issues
new observation, evidence and target refs; a new observation expires old refs. Targets
have one `description` and explicit state. Observation `state.controls/messages` exposes
read-only results, including visible disabled controls, selected options and feedback.
Check coverage and truncation before interpreting missing data. Both views share control
naming and state-reading rules; multiline values retain line breaks. Select targets
expose the offered `option_value/option_label`, while `state.selected_options` records
the current selection. Truncated select state refuses input.

New actions persist their receipt, then return `post_observation`: `captured` contains
current local observation `data`; `failed` does not change the input outcome. Use that
state to assess completion, and observe again when asynchronous results remain pending.
For unknown or interrupted input, query
`prism receipt --session <session> --request-id <id>`. Exact original-id replay returns
only its historical receipt, without current refs.

`prism <command> --help` shows arguments and examples. The complete agent instructions
are in [skills/prism/SKILL.md](../skills/prism/SKILL.md).

## Run from source

Contributors need pnpm:

```bash
pnpm install
pnpm build
node dist/cli.js --help
```

`pnpm dev` runs commands from source without producing `dist/`.
