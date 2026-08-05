# Prism UI-TARS Browser Runtime

This package embeds the official UI-TARS SDK `GUIAgent` behind Prism's versioned
browser and ActionBroker boundaries.

## Verified SDK baseline

Verified on 2026-08-05 against the published `@ui-tars/sdk@1.2.3` npm metadata:

- `@ui-tars/sdk` `1.2.3` — the official experimental GUI agent SDK (`GUIAgent`,
  `Operator`, `UITarsModel`);
- `@ui-tars/sdk/core` — the `Operator` base class, `parseBoxToScreenCoords`,
  `StatusEnum`, and `ScreenshotOutput`/`ExecuteParams` types;
- `playwright-core` `1.61.1` — the confined local Chromium session;
- `uuid` `11.1.0` — a direct dependency required by the SDK's ESM build.

Both `@ui-tars/sdk` and `playwright-core` are exact dependencies in
`package.json`; runtime dependency updates are deliberate ticketed changes, not
floating semver upgrades.

Official references:

- <https://github.com/bytedance/UI-TARS-desktop/blob/main/docs/sdk.md>
- <https://www.npmjs.com/package/@ui-tars/sdk>

## Model interface

`UiTarsSdkSessionFactory` talks to an OpenAI-compatible chat completions endpoint
(UI-TARS model service). Configure it with:

- `PRISM_UI_TARS_BASE_URL` — the model service base URL;
- `PRISM_UI_TARS_API_KEY` — the model service API key;
- `PRISM_UI_TARS_MODEL` — the model identifier (for example a UI-TARS-1.5
  endpoint model).

All three must be set before a live browser Run starts; otherwise
`createConfiguredUiTarsSdkSessionFactory` throws `UiTarsConfigurationError`.

## Coordinate convention

UI-TARS predictions carry a normalized box `[x1, y1, x2, y2]` in model space.
`parseBoxToScreenCoords` converts the box center to physical screen pixels using
the screenshot's physical resolution and the model's `factors`. The custom
`PrismBrowserOperator` divides that by `scaleFactor` (device-pixel ratio) to get
viewport CSS pixels, then builds a **coordinate** browser target bound to the
exact observation that grounded it: observation ID, screenshot hash, page-state
hash, and viewport.

The ActionBroker's freshness policy re-observes the page at execution time and
rejects any coordinate target whose observation no longer matches. A stale page
therefore fails closed without any browser input.

## Authority boundary

`PrismBrowserOperator` exposes only `click` and `finished` in
`MANUAL.ACTION_SPACES`; every parsed prediction becomes a Zod-validated
`BrowserActionProposal` sent through the ActionBroker, never a direct browser
input. `UiTarsBrowserPort` has only `observe`, `screenshot`, `click`, and
`dispose` — no repository write, patch, shell, arbitrary-script, extension, or
filesystem capability. Multi-action model output is still routed one proposal at
a time through the same broker.

UI-TARS qualitative judgment is recorded as a `supplemental` verification
assertion. A `BrowserVerificationReport` can only be `passed` when an
intent-linked deterministic predicate also passes, enforced by the
`browserVerificationReportSchema` superRefine. The deterministic predicate is
injected through the `UiTarsVerifier` port.

## Supported browser configuration

`PlaywrightBrowserPortFactory` launches a headless local Chromium with:

- the run viewport (`width`, `height`, `deviceScaleFactor`) as the page viewport
  and DPR;
- network confined to the configured local origin (only same-origin `GET`/`HEAD`
  pass through);
- downloads disabled (`acceptDownloads: false`);
- `PRISM_BROWSER_EXECUTABLE_PATH` (when set) selecting the Chromium binary,
  otherwise the Playwright-bundled Chromium.

The base URL must be an explicit local HTTP origin (`127.0.0.1`, `localhost`, or
`::1`); anything else is refused.

## Verification

```bash
pnpm --filter @prism/runtime-ui-tars test
pnpm --filter @prism/runtime-ui-tars typecheck
```

The integration smoke launches a real local Playwright Chromium session against a
throwaway HTTP fixture, then proves: a baseline observation is captured; an
allowlisted local click executes through the ActionBroker; a coordinate proposal
grounded on the pre-click observation is rejected as stale after the page
mutated; and the browser port exposes no source-write capability.
