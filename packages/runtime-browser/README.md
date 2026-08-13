# Prism Browser Runtime

This package uses Doubao Seed 2.0 Pro through the Volcengine Agent Plan Responses API to
propose screenshot-grounded browser actions. Node's native `fetch` is the only
model client; Playwright remains the confined browser driver.

## Configuration

Set the Agent Plan-specific key before starting a live Run:

```bash
export ARK_AGENT_PLAN_API_KEY="..."
```

The runtime deliberately fixes the endpoint to
`https://ark.cn-beijing.volces.com/api/plan/v3/responses` and the model to
`doubao-seed-2.0-pro`. The configured Agent Plan tier must include the model.

## Boundary

The browser model may return exactly one `click(x, y)` or `finished(judgment)` tool call
per screenshot. The response is validated before `PrismBrowserOperator` turns
it into a typed proposal. Every click passes through `ActionBroker`; stale
coordinates fail closed. The browser exposes only observe, screenshot, click,
and dispose operations and only permits local same-origin GET/HEAD traffic.

Model judgment remains supplemental. A verification report passes only when an
intent-linked deterministic verifier also passes.

## Verification

```bash
pnpm --filter @prism/runtime-browser test
pnpm --filter @prism/runtime-browser typecheck
```
