# TypeScript Chrome-control substrate research

Research date: 2026-07-23  
Decision ticket: [Choose the TypeScript Chrome-control substrate](../issues/01-choose-typescript-chrome-control-substrate.md)

## Resolution

Keep `playwright-core` as the browser substrate. Run a visible, dedicated
Chrome/Chrome-for-Testing profile and put every observation and action through
one thin ConsoleOps browser adapter. Use locator-first actions, with coordinate
actions only as a logged fallback tied to a specific screenshot and viewport.
The adapter—not the model and not Playwright—owns risk lookup, approval
interception, redaction, and canonical trace emission.

Provider-native computer-use models may propose actions through the same typed
adapter later. They must not receive a second, unmediated browser connection.
UI-TARS is not needed for the MVP.

## Confirmed current capabilities

As of this research, npm reports `playwright-core` `1.61.1`.

- `chromium.connectOverCDP()` attaches to an existing Chromium browser and
  exposes its default context and pages. Playwright explicitly documents this
  connection as lower fidelity than its native protocol connection.
- A visible branded browser can instead be started under Playwright control
  with a persistent, non-default user-data directory. This is the preferred
  MVP path because it retains a real Chrome window while avoiding the lower
  fidelity of attaching to an arbitrary already-running browser.
- Page, element, and buffer screenshots are first-class. The buffer form can be
  passed as a multimodal observation without an intermediate public file.
- Locators provide auto-waiting and retryability. Role, label, text, and other
  user-facing locators are therefore more robust than raw CSS/XPath selectors.
- `page.mouse` supports viewport-relative coordinate input when a semantic
  target cannot be expressed.
- Browser-context tracing captures Playwright operations, DOM snapshots,
  screenshots, and network activity. It is useful diagnostic evidence but does
  not include ConsoleOps approvals, MCP calls, role handoffs, or scenario
  oracles.
- Storage state can persist cookies, local storage, and IndexedDB-backed
  authentication. Playwright warns that the file may contain credentials that
  can impersonate the account. Session storage requires separate handling.

## Selected runtime shape

### Browser process and session

1. Run the agent runtime and Chrome on the same Windows host for the MVP.
2. Prefer Chrome for Testing or an installed Chrome channel launched visibly
   through `playwright-core`.
3. Use one dedicated fixture profile directory per test identity; never attach
   to the developer's default daily profile.
4. Authenticate the fixture identity manually once, then reuse that dedicated
   profile. Storage-state export is optional and must remain ignored,
   access-controlled, redacted from traces, and easy to purge.
5. Use `connectOverCDP()` only for an explicitly launched fixture Chrome when a
   separate browser lifecycle is required. Do not treat an arbitrary CDP port
   as trusted.

Chrome 136 and later ignore remote-debugging switches against the default data
directory. A non-standard `--user-data-dir` is required; Chrome recommends
Chrome for Testing for automation. This aligns with the product's disposable
fixture boundary.

### Observation contract

One observation should contain:

- run, role, step, page, and observation identifiers;
- current URL and viewport dimensions;
- a viewport screenshot artifact reference and content hash;
- a small structured page summary (title, visible text excerpt, dialogs, and
  candidate semantic targets);
- redaction metadata and omitted regions;
- timestamp and the preceding action identifier.

The screenshot is the primary computer-use observation. Structured DOM-derived
metadata improves reliability but must not turn the scenario into hidden API
automation.

### Action contract

Expose a deliberately small action union:

- navigate or open a known console URL;
- click a semantic locator;
- click viewport coordinates;
- fill a semantic locator;
- select an option;
- press a key or key chord;
- wait for a visible condition or navigation;
- capture an observation;
- finish with a typed result.

The model proposes this contract; it never receives raw `Page`,
`BrowserContext`, CDP, filesystem, or process handles.

### Locator and coordinate policy

1. Try a role/label/text/test-id locator and require a unique, visible target.
2. Record the resolved target summary before execution.
3. Use coordinate clicks only for canvas-like or otherwise non-semantic UI.
4. Bind coordinates to the observation screenshot hash and viewport.
5. Reject stale coordinate actions after navigation, resize, or a newer
   observation.
6. Capture an after-action observation and the resulting URL/dialog state.

This keeps computer use visible while avoiding coordinate-only brittleness.

## Approval and safety interception

All browser actions pass through a single `BrowserActionExecutor` boundary:

1. validate the proposed action;
2. resolve its named adapter operation;
3. look up the static risk-registry entry;
4. redact the approval preview;
5. pause or deny according to Balanced/Strict mode;
6. execute only the exact approved operation and parameters;
7. emit the result and after-action observation.

Approval is for a named operation, target, and normalized parameter digest—not
for generic future browser control. A page transition or changed target
invalidates the approval. Unknown operations are denied pending a registry
change.

Console adapters may expose stronger preconditions, such as the expected
project slug, environment (`development` or `preview`), current setting value,
and allowed next value. Production targets fail before approval.

## Replay boundary

The canonical trajectory records ConsoleOps events around Playwright:

- observation captured;
- action proposed;
- operation/risk resolved;
- approval requested, granted, denied, or expired;
- action started and finished;
- before/after artifact references;
- page URL and target summary;
- error, cancellation, and verifier result.

Playwright trace chunks are linked as supplementary artifacts. They are not the
durable replay schema because they cannot represent MCP evidence, role
handoffs, approvals, or benchmark truth.

## Windows development friction

- `playwright-core` does not download a browser. The fixture must pin and
  validate an installed Chrome/Chrome-for-Testing executable or channel.
- Chrome 136+ requires a non-default user-data directory for remote debugging.
- A persistent profile cannot be opened concurrently by multiple Chrome
  processes; fixtures need an ownership lock and a clear stale-lock recovery
  message.
- Windows and WSL filesystem paths, loopback networking, and process ownership
  differ. Keep the browser-owning Node process on Windows for the MVP instead
  of making WSL-to-Windows CDP connectivity part of the product.
- Use an ephemeral debugging port or a loopback-only port with a per-run
  capability. Never expose CDP on a non-loopback interface.
- Auth/profile artifacts, screenshots, downloads, and traces need Windows-safe
  paths and deterministic cleanup.

## Minimum thin adapter

The smallest useful boundary has six responsibilities:

1. fixture browser lifecycle and dedicated-profile ownership;
2. screenshot plus structured observation capture;
3. typed locator-first action execution with coordinate fallback;
4. static operation resolution and approval interception;
5. canonical ConsoleOps event emission plus optional Playwright trace chunks;
6. cancellation, timeout, redaction, and artifact cleanup.

Do not add a second browser framework, a generic desktop-control layer, or a
provider-specific action runtime to the MVP.

## Validation implications

The highest test seam is a complete scenario run through the public runner:
prompt → role handoff → screenshot observation → proposed browser operation →
approval → visible Chrome effect → MCP verification → replayable trajectory →
scenario oracle.

Lower-level tests should cover only safety-critical adapter behavior:
stale-coordinate rejection, locator ambiguity, production-target rejection,
approval digest matching, cancellation, and secret redaction.

## Primary sources

- [Playwright BrowserType API](https://playwright.dev/docs/api/class-browsertype)
- [Playwright locators](https://playwright.dev/docs/locators)
- [Playwright screenshots](https://playwright.dev/docs/screenshots)
- [Playwright Mouse API](https://playwright.dev/docs/api/class-mouse)
- [Playwright tracing](https://playwright.dev/docs/api/class-tracing)
- [Playwright authentication](https://playwright.dev/docs/auth)
- [Chrome remote-debugging changes from Chrome 136](https://developer.chrome.com/blog/remote-debugging-port)
- [playwright-core on npm](https://www.npmjs.com/package/playwright-core)
