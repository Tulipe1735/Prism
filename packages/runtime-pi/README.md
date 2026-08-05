# Prism Pi Coding Runtime

This package embeds the official Pi Agent SDK behind Prism's versioned runtime
and workspace boundaries.

## Verified SDK baseline

Verified on 2026-08-05 against the official `v0.82.1` tag and npm metadata:

- `@earendil-works/pi-coding-agent` `0.82.1` — the embedded session SDK;
- `@earendil-works/pi-ai` `0.82.1` — shared model types and the deterministic
  faux provider used by the integration smoke; and
- Node.js `>=22.19.0`, matching the coding-agent package engine.

Both packages are exact dependencies in `package.json`; runtime dependency
updates are deliberate ticketed changes, not floating semver upgrades.

Official references:

- <https://github.com/earendil-works/pi/blob/v0.82.1/packages/coding-agent/docs/sdk.md>
- <https://github.com/earendil-works/pi/blob/v0.82.1/packages/coding-agent/package.json>

## Authority boundary

`PiSdkSessionFactory` disables discovered extensions, skills, prompts, context
files, and all built-in Pi tools. Each session receives only the custom Prism
tools allowed by its `RuntimeTaskEnvelope`. Those tools create typed workspace
requests; repository reads, patches, shell commands, and tests are executed by
`WorkspaceExecutor` and committed before their references can leave the runtime.

The runtime returns exactly a Zod-validated `NodeOutcome`, committed
`ArtifactRef` values, and resource usage. Raw assistant prose is not returned or
persisted. The committed Pi trajectory records operation artifacts, command/test
facts, hash-based diff identity, model and token usage, and run/node/attempt
causality without copying unredacted workspace output.

## Production model selection

The Field Desk uses the first authenticated Pi model by default. Set both
`PRISM_PI_PROVIDER` and `PRISM_PI_MODEL` to select an explicit configured model.
Missing or half-specified configuration fails before a live Run is started.

## Verification

```bash
pnpm --filter @prism/runtime-pi test
pnpm --filter @prism/runtime-pi typecheck
```

The integration smoke uses a real in-process Pi SDK session with the official
faux provider and a disposable real `WorkspaceExecutor` fixture. It covers a
scoped inspection, an initial patch, a failing test, a corrected patch, and a
passing final test.
