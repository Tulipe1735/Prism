# Prism

English | [简体中文](README.md)

A personal research agent built for everyday use. Discover papers and repositories,
compare approaches, and carry research progress into the next task.

Prism runs its own task loop with DeepSeek. Two Feishu roles share durable research
state; a local worker uses the browser CLI for an already signed-in NWPU portal.

Code: [loop](src/assistant/runtime.ts) · [prompts](src/assistant/prompts.ts) ·
[orchestration](src/assistant/service.ts)

## Features

- **Morning brief:** 10:00 Asia/Shanghai, Gmail subscriptions and actual GitHub
  Trending. Silence when nothing merits a recommendation.
- **Deep research:** alternative methods, assumptions, evidence, costs and limits; check
  and revise within 20 minutes.
- **Personal knowledge:** Notion-to-Markdown sync; manual Markdown, text PDF and resume
  imports with source locations.
- **Shared state:** progress, preferences and editable corrections. Delivery, reading
  and demonstrated understanding remain distinct.
- **Learning:** course records and nwpu-cram materials, with local observations and
  execution receipts.

Code: [sources](src/assistant/connectors.ts) · [library](src/assistant/library.ts) ·
[store](src/assistant/store.ts) · [courses](src/assistant/courses.ts) ·
[worker](src/assistant/local.ts)

## Run

Requires Node.js ≥22.19 and pnpm.

```bash
pnpm install
pnpm build
cp .env.example .env
# Configure DeepSeek, actual monthly infrastructure cost, and integrations
node --env-file=.env dist/agent.js init
node --env-file=.env dist/agent.js doctor
node --env-file=.env dist/agent.js ask "Compare the approaches in my research library" --deep
node --env-file=.env dist/agent.js serve
```

See the [setup guide](docs/assistant.md) for integrations and deployment. Infrastructure
and model usage share a monthly CNY 50 cap. Estimates use configured rates; reconcile
provider bills.

Code: [CLI](src/assistant/cli.ts) · [config](src/assistant/config.ts) ·
[Feishu](src/assistant/feishu.ts) · [deployment](compose.assistant.yaml)

## Architecture

![Prism personal research architecture](docs/architecture.svg)

[Editable Excalidraw](docs/architecture.excalidraw) ·
[module index](docs/architecture.md) · [glossary](GLOSSARY.md)

Code: [agent](src/assistant) · [browser CLI](src/interfaces/cli.ts) ·
[receipts](src/cli/sessions.ts)

## Developer preview

See the [verification record](docs/assistant-verification.md) for tested and pending
scope.

Controlled integration tests cover task results, citations, state, sync, budgets and
delivery. Live messaging, cloud operation, personal Notion/Gmail imports and NWPU
queries require credentials and live acceptance. This version has not been deployed.

The existing `prism` browser CLI remains available:
[browser guide](docs/browser-cli.en.md), [agent skill](skills/prism/SKILL.md).

Code: [tests](tests/assistant) · [research evaluation](evals/assistant/README.md) ·
[browser tests](tests/cli)

## Development

```bash
pnpm typecheck
pnpm test
pnpm build
```

MIT License. README structure inspired by
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

Code: [test configuration](vitest.config.ts) · [build entries](tsup.config.ts)
