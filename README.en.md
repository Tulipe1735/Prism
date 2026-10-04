# Prism

Prism is a browser-use CLI for an external agent. The agent plans, chooses targets,
supplies field values and checks task completion. Prism observes the browser, exposes
target context, validates references and sends one input operation.

Node.js ≥22.19.0 is required. Prism does not call a model or require a model key.

## Architecture

![Prism browser-use CLI for agents architecture](docs/architecture.svg)

The external agent makes decisions. Prism exposes observation and relation evidence,
checks reference and evidence freshness, sends input, and saves receipts. `executed`
means input acknowledged, not task success. Receipt queries read saved files directly
without requiring a running broker.

[Editable Excalidraw source](docs/architecture.excalidraw)

## Run from source

```bash
pnpm install
pnpm build
node dist/cli.js --help
```

Start Chrome with remote debugging and a separate profile. Then run:

```bash
node dist/cli.js session open --url https://example.com --browser-url http://127.0.0.1:9222
node dist/cli.js observe --session <session> --scope local
node dist/cli.js context --session <session> --observation <observation> --target <ref> --scope relations
node dist/cli.js act --session <session> --observation <observation> --target <ref> --evidence <evidence> --operation click --request-id decision-1
node dist/cli.js receipt --session <session> --request-id decision-1
node dist/cli.js session close --session <session>
node dist/cli.js daemon stop
```

Replace placeholders with values from the previous JSON response. The package exposes
`prism` as its executable. Use `prism <command> --help` for examples.

## Contracts

- `local`: role, name, value and up to 80 characters of local context.
- `structural`: container type, up to 120 characters of nearby text and a 48-character
  section/legend heading.
- `relations`: Local plus bounded visible ancestor group identities and scope, up to six
  levels. This is a group extractor, not a complete relation graph.

Each observation issues new target refs and an evidence id. A new observation expires
old refs. `context` issues evidence for one target. `act` requires that evidence id and
checks the displayed fields, document and control state before input. Local evidence
does not bind undisplayed group relations. Validation does not receive a goal or judge
the agent's choice.

Supported operations: click, fill, select, scroll, wait. Fill requires `--value`, which
can be empty. A select option has its own offered ref and takes no extra value.
`act --stdin` accepts a complete command JSON object and cannot be mixed with action
flags.

An action receipt reports `not_executed`, `executed` or `unknown`. Executed means the
browser acknowledged the input sequence; it does not mean task success. Reusing the same
request id and complete action returns the saved receipt without sending input again. A
changed request using the same id is rejected. Unknown outcomes are never replayed. A
pending receipt is saved before input, so receipt queries work after the broker exits.
Missing receipts do not prove input was never requested.

Except help/version, stdout contains one JSON reply; stderr contains diagnostics.
`--json` is optional. Exit 0 means accepted or queried; 1 means refused or uncertain; 2
means invalid arguments. A successful receipt query can return an unknown action
outcome: read the receipt.

The broker owns its browser tabs, serializes commands within each session and closes
owned tabs after 15 minutes without a command. Session state does not survive broker
restart. `--state-dir` or `PRISM_STATE_DIR` chooses a private state directory; Linux
requires user ownership and mode 700. Use the same directory across commands. Event logs
contain visible page text and may contain field values. `PRISM_BROWSER_URL` sets the
default Chrome HTTP endpoint. The CLI does not read `.env`.

The first version focuses on offered controls. It has no full-page reading, screenshot,
frame or shadow-DOM traversal interface. Evidence checking and CDP input are separate
operations, so changes after the last check remain possible.

## Agent and research use

The agent instructions are in [skills/prism/SKILL.md](skills/prism/SKILL.md). Copy or
reference them in your chosen agent's skill directory. The old URL+goal route, internal
task-level model entry and MCP executable have been removed.

```bash
pnpm typecheck
pnpm test
PRISM_EVAL_CHROME=1 pnpm test -- tests/cli/browser-cli.browser.integration.test.ts
PRISM_EVAL_CHROME=1 PRISM_CLI_TEST_ENTRY=dist/cli.js pnpm test -- tests/cli/browser-cli.browser.integration.test.ts
```

Browser tests use local pages and no model calls. They default to port 9333; set
`PRISM_IT_BROWSER_URL` for another endpoint.

Historical evaluation runners remain in `evals/`. Their model-loop modules are not part
of the packaged CLI. Original data, manifests and frozen archives remain unchanged. This
checkout is a new method: restore historical archives and pinned materials before
rerunning old cohorts. Never rewrite an old freeze to approve changed source.

The research question concerns observation and execution contracts for
relation-dependent grounding. Old representation results do not establish performance
benefits for this CLI or its execution contract. See the
[implementation record](docs/research/browser-cli-implementation-2026-10-04.md) and
[Chinese README](README.md).
