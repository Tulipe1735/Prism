# Browser observer and UI-TARS integration research

Research date: 2026-07-24

## Scope and boundary

This research covers an **observable, browser-only worker** that can use a visible
Chrome session to reproduce a bug, inspect the page, interact with it, verify a
result, and hand structured evidence to a separate coding agent.

The browser worker must not edit source code. It should not receive repository
write tools, a shell, or a general filesystem tool. Its only filesystem writes
should be broker-owned artifacts under the current run directory (screenshots,
traces, reports, redacted logs). Source changes remain the coding agent's job.

The worker should be able to start on the browser route or be called later by the
coding route. Routing is therefore an initial preference, not a permanent
partition.

## Main finding

Do not make UI-TARS, Playwright, or an MCP server the security boundary. Split
the worker into replaceable layers:

1. **Session adapter** owns the visible Chrome tab/profile.
2. **Observers** collect screenshot plus structured page/debugging state.
3. **Grounder/planner** proposes the next typed browser action. UI-TARS is one
   possible visual grounder.
4. **Action broker** is the only component allowed to execute input.
5. **Policy and approval gate** classifies every proposed action before
   execution.
6. **Verifier** evaluates explicit postconditions.
7. **Evidence recorder** emits an append-only event log and an evidence bundle
   for the coding agent.

This split is supported by UI-TARS's own SDK shape: its experimental SDK makes
`screenshot()` and `execute()` the two required `Operator` methods, and passes a
parsed prediction, screen dimensions, device pixel ratio, and coordinate scale
factors into `execute()`. A custom `Operator.execute()` is therefore a natural
place to convert a model prediction into a `ProposedBrowserAction` and send it
through policy instead of immediately producing input.

The official UI-TARS repository points web-automation users to Midscene.js.
Midscene currently offers pure-vision localization, UI-TARS model adapters,
Playwright/Puppeteer integration, a Chrome extension bridge, cacheable
localization, and visual reports. It is the strongest ready-made TypeScript
candidate for a prototype, but its high-level multi-action calls must still sit
behind the project's own action broker.

Playwright should remain the default deterministic executor and trace producer
where a semantic locator exists. Coordinate input should be a fallback for
canvas, unlabeled controls, closed shadow roots, and other visually accessible
but structurally opaque UI.

## Candidate comparison

| Candidate | Visual grounding | Chrome control and observation | Structured targets/evidence | Approval interception | Replay/audit | Main integration risks |
| --- | --- | --- | --- | --- | --- | --- |
| **Midscene.js + Playwright** | Pure-vision localization; supports UI-TARS and other VLMs | Playwright/Puppeteer, CDP, or extension Bridge Mode for an existing visible Chrome tab | `aiLocate`/interaction/assertion APIs; HTML report with screenshots and JSON; XPath localization cache | No project-specific per-action approval contract. Avoid exposing one-shot `aiAct` for high-risk work; adapt atomic location/action calls through the broker | Visual report is strong for audit; cache can accelerate reruns but is not a correctness guarantee | Current model guide lists UI-TARS as compatible but not its default; XPath cache fails on DOM change/canvas/cross-origin/closed shadow; high-level planning can batch effects |
| **`@ui-tars/sdk` + custom browser Operator** | Native UI-TARS screenshot-to-coordinate action loop | Custom operator can use Playwright, CDP, or an extension bridge | Parsed action type/inputs plus dimensions, DPR and scale factors are available at `execute()` | Best low-level interception seam: custom `execute()` proposes rather than executes | Must add Playwright trace and an event store; SDK callbacks provide deltas/status, not a complete audit system | SDK documentation is marked experimental; coordinate normalization is fragile; browser operator packages in the TARS stack have been refactored; more implementation work |
| **Browser Use (Python) + brokered tools** | Optional vision in the agent; current CLI path is primarily structured DOM/CDP | Python browser session with CDP access, pause/resume and custom tools | Pydantic structured output; history exposes actions, URLs, screenshots, errors and extracted content and can be serialized | Lifecycle hooks are step boundaries, not by themselves a hard pre-action boundary. Wrap tool registry execution and use one action per step for gated runs | Rich history is useful for audit; add Playwright trace for DOM/network/console evidence; live rerun is still nondeterministic | Must prevent multi-action steps from bypassing approval; Python/TS transport boundary; general custom tools could accidentally expand capability |
| **Stagehand + Playwright** | Primarily AI over structured page state; can use computer-use agents, but is not the direct UI-TARS path | Accepts Playwright/Puppeteer/Patchright pages and has its own CDP engine | `observe()` returns inspectable `Action[]` with description, method, arguments and selector; typed extraction via schema | Excellent interface pattern: `observe` first, validate/approve, then `act(Action)` with no second inference | Action cache and logs help reruns; pair with Playwright trace for forensic replay | XPath/DOM dependence; cache miss invokes AI again; broad `agent.execute()` should not be exposed for approved workflows |
| **Playwright MCP / Playwright directly** | Structured accessibility snapshots by default; optional vision capability in MCP | Reliable browser automation; can launch or connect through CDP | Snapshot refs, role/name/test-id locators, screenshots, network and trace artifacts | MCP tool boundaries are easy to broker, but the official project explicitly says it is not a security boundary | Best available local forensic trace: actions, before/action/after DOM snapshots, screenshots, console and network | Accessibility tree misses visual-only meaning; CDP attachment is lower fidelity than Playwright protocol; origin allow/block lists are guardrails, not security boundaries |
| **Chrome DevTools for agents (`chrome-devtools-mcp`)** | Experimental coordinate click exists, but it is not a visual planner | Strongest Chrome-specific debugging: live tab, console, network, screenshots, performance and memory | Snapshot element UIDs plus detailed debug evidence | Put a trusted allowlist proxy in front; do not expose `evaluate_script`, upload, navigation and input indiscriminately | Performance traces and collected debug state are strong evidence; not a complete executable replay format | Exposes the attached browser's content and control; remote-debug port is sensitive; usage metrics are on by default; Chrome-only |

### How to use the shortlist

These are prototype candidates, not a final product choice:

1. **TypeScript, fastest UI-TARS-oriented prototype:** Midscene
   (`@midscene/web`) for visual grounding and browser bridge, Playwright for
   semantic execution/assertions/traces, and selected Chrome DevTools
   capabilities for console/network/performance evidence.
2. **TypeScript, strongest control over policy:** `@ui-tars/sdk` with a custom
   browser `Operator`. The operator never executes a prediction directly; it
   maps it into the project's action schema and calls the action broker.
3. **Python alternative:** Browser Use with a narrow tool registry, a custom
   pre-execution broker, `max_actions_per_step = 1` for approval-sensitive
   sessions, Pydantic evidence output, and Playwright/CDP tracing.
4. **Structured-path components/patterns:** Playwright MCP or Stagehand
   `observe() -> validate -> act()` can be used as a structured observer or as
   reference implementations even when the visual planner is Midscene/UI-TARS.
5. **Debug evidence sidecar:** Chrome DevTools for agents is valuable for
   console, network, performance and live-session attachment, but should not be
   the autonomous planner or authorization layer.

## Recommended language-neutral interfaces

Use JSON-schema-compatible discriminated unions so the orchestrator and coding
agent can be TypeScript while the browser worker can be TypeScript or Python.

### Observation

```ts
type BrowserObservation = {
  schemaVersion: "1";
  observationId: string;
  sessionId: string;
  tabId: string;
  capturedAt: string;
  url: string;
  title: string;
  viewport: { width: number; height: number; dpr: number };
  screenshot: ArtifactRef & { sha256: string };
  accessibilitySnapshot?: ArtifactRef;
  domSnapshot?: ArtifactRef;
  consoleCursor?: string;
  networkCursor?: string;
  pageStateHash: string;
};
```

`pageStateHash` should cover at least tab identity, URL, viewport, screenshot
hash, and a compact structured-state hash. It is a freshness guard, not proof
that the page is safe.

### Target

```ts
type BrowserTarget =
  | {
      kind: "semantic";
      role?: string;
      accessibleName?: string;
      testId?: string;
      locator?: string;
      snapshotRef: string;
    }
  | {
      kind: "visual";
      x: number;
      y: number;
      coordinateSpace: "viewport-css-px";
      screenshotSha256: string;
      viewport: { width: number; height: number; dpr: number };
      description: string;
    }
  | {
      kind: "hybrid";
      semantic: Extract<BrowserTarget, { kind: "semantic" }>;
      visual: Extract<BrowserTarget, { kind: "visual" }>;
    };
```

Prefer `hybrid`, then `semantic`, then `visual`. A visual target is valid only
for the exact screenshot/viewport it was grounded against. Before input, capture
or compare fresh state and reject stale coordinates.

### Proposed action and policy decision

```ts
type BrowserEffect =
  | "read_only"
  | "navigation"
  | "local_ui_state"
  | "external_write"
  | "destructive"
  | "auth_or_permission"
  | "secret_input"
  | "file_transfer";

type BrowserAction =
  | { kind: "navigate"; url: string }
  | { kind: "click"; target: BrowserTarget; button?: "left" | "right" }
  | { kind: "type"; target: BrowserTarget; valueRef: string; submit: boolean }
  | { kind: "select"; target: BrowserTarget; values: string[] }
  | { kind: "scroll"; direction: "up" | "down" | "left" | "right"; amount: number }
  | { kind: "handle_dialog"; decision: "accept" | "dismiss"; promptValueRef?: string }
  | { kind: "upload"; target: BrowserTarget; artifactRef: string }
  | { kind: "wait"; condition: string; timeoutMs: number };

type ProposedBrowserAction = {
  schemaVersion: "1";
  actionId: string;
  sessionId: string;
  tabId: string;
  observationId: string;
  intent: string;
  action: BrowserAction;
  effect: BrowserEffect;
  idempotency: "idempotent" | "non_idempotent" | "unknown";
  preconditions: Array<{ kind: string; expected: unknown }>;
  model: { provider: string; model: string; rawPredictionRef?: ArtifactRef };
};

type PolicyDecision =
  | { decision: "allow"; scope: "once" }
  | { decision: "require_approval"; reason: string; approvalRequestId: string }
  | { decision: "deny"; reason: string };
```

The approval token must be single-use and bind the action digest,
`observationId`, tab/session, approver, and expiry. Changing arguments or page
state invalidates it. The UI should display the origin, human-readable target,
effect, destination domain, and redacted value description. It must preserve
three outcomes: accept, decline, and cancel.

MCP tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`,
`openWorldHint`) are useful input to this vocabulary but are only hints. The
trusted host must classify and enforce every concrete call itself.

Suggested default policy:

- Auto-allow observation, screenshot, console/network reads, waits, scrolling,
  and verification.
- Auto-allow reversible navigation within an allowlisted origin when no data is
  submitted.
- Require approval for external writes, destructive actions, permission/auth
  changes, secret submission, file upload/download, purchases, messages, and
  cross-origin data movement.
- Hard-deny source editing, shell execution, repository writes, extension
  installation, arbitrary JavaScript evaluation, and unrestricted local file
  access in the browser worker.

### Result and evidence handoff

```ts
type BrowserActionResult = {
  actionId: string;
  status: "succeeded" | "failed" | "denied" | "stale" | "cancelled";
  startedAt: string;
  finishedAt: string;
  beforeObservationId: string;
  afterObservationId?: string;
  consoleDelta?: ArtifactRef;
  networkDelta?: ArtifactRef;
  error?: { code: string; message: string };
};

type BrowserEvidenceBundle = {
  schemaVersion: "1";
  taskId: string;
  session: {
    browser: string;
    browserVersion: string;
    profileMode: "isolated" | "user_attached";
    viewport: { width: number; height: number; dpr: number };
  };
  reproduction: {
    status: "reproduced" | "not_reproduced" | "inconclusive";
    expected: string;
    actual: string;
    minimalSteps: string[];
  };
  observations: ArtifactRef[];
  actionLog: ArtifactRef;
  playwrightTrace?: ArtifactRef;
  har?: ArtifactRef;
  console?: ArtifactRef;
  network?: ArtifactRef;
  verification: Array<{
    assertion: string;
    status: "passed" | "failed" | "inconclusive";
    evidenceRefs: ArtifactRef[];
  }>;
  suspectedCodeAreas?: Array<{ pathHint: string; reason: string; confidence: number }>;
  redactions: string[];
  limitations: string[];
};
```

The coding agent receives the bundle and artifact references, not browser
credentials, complete cookies, unredacted headers, or an unlimited DOM dump. It
can request another observation by a typed evidence query. `suspectedCodeAreas`
are hints only; the browser worker still cannot read or edit the repository.

## Replay and audit semantics

Use two distinct terms:

- **Forensic replay:** inspect what happened. Playwright Trace Viewer records
  action timing, locator, before/action/after DOM snapshots, screenshots,
  console and network data. Midscene reports provide a useful visual narrative
  and can export screenshots/JSON/Markdown.
- **Executable rerun:** attempt the same workflow again. Store typed actions,
  preconditions and semantic locators, pin browser/version/viewport, start from
  known storage state, and optionally replay network from HAR. A changing
  website or external side effect means exact deterministic replay cannot be
  promised.

Never treat screen coordinates as portable replay instructions. On rerun,
resolve the semantic target again or re-ground from a new screenshot. Midscene's
XPath cache is an optimization: its own documentation says DOM changes can
invalidate it and that canvas, cross-origin frames, closed shadow roots, and
dynamic graphics require fallback.

## Important integration risks

1. **Stale visual actions.** UI-TARS coordinates depend on screenshot size,
   viewport, DPR, scroll position and any image resizing. Normalize to viewport
   CSS pixels and bind the action to the screenshot hash.
2. **Action batching bypasses approval.** High-level APIs may plan and execute
   several effects in one call. Approval-sensitive runs must expose one proposed
   action at a time.
3. **Prompt injection from page content.** Screenshot, DOM, accessibility text,
   console and network bodies are untrusted observations. They never grant new
   tools or relax policy.
4. **Attached-profile exposure.** CDP or extension attachment can expose logged
   in sessions. Prefer an isolated profile; when user attachment is required,
   show the selected tab/profile and redact secrets. A remote-debug port must be
   local and short-lived.
5. **CDP fidelity and version drift.** Playwright documents CDP attachment as
   lower fidelity than its native protocol. Tip-of-tree CDP has no compatibility
   guarantee. Pin tested Chrome/Playwright versions and test reconnect,
   navigation, dialogs, downloads and multi-tab behavior.
6. **MCP is not authorization.** Official Playwright MCP documentation says it
   is not a security boundary; allow/block origin settings and secret
   replacement are guardrails. The host broker owns permissions.
7. **Evidence privacy.** Traces, screenshots, DOM, console and network data may
   contain credentials and personal data. Redact at capture/export, use bounded
   retention, and never pass raw storage state to the coding agent.
8. **Framework API churn.** UI-TARS SDK documentation is experimental and the
   TARS stack has renamed/refactored browser operators. Hide dependencies behind
   the session, observer, grounder and executor interfaces.
9. **Visual model availability.** UI-TARS-1.5 has published open weights; do not
   make the contract depend on one UI-TARS version or assume every announced
   model has equivalent distributable weights. Make the grounder pluggable and
   record exact model/version in every run.

## Prototype evaluation gates

Evaluate the TypeScript and Python candidates against the same fixtures:

1. Accessible DOM form: semantic target succeeds and produces a trace.
2. Canvas or icon-only bug: visual fallback succeeds with screenshot-bound
   coordinates.
3. External write: proposed click is paused before input and the approval shows
   exact target/effect.
4. Stale observation: page mutation between proposal and approval causes a
   `stale` result and re-observation, never execution.
5. Destructive/secret/file-transfer actions: policy requires approval and audit
   values are redacted.
6. Prompt-injected page: page text cannot enable code/file/shell tools.
7. Verification failure: worker returns structured evidence to the coding agent
   and does not attempt a source edit.
8. Replay: trace opens, action log validates against schema, and a rerun uses
   semantic re-resolution rather than stored coordinates.

## Primary sources

- ByteDance, [UI-TARS repository](https://github.com/bytedance/UI-TARS) — model,
  action parsing, coordinate notes, open UI-TARS-1.5 weights, and recommendation
  of Midscene for web automation.
- ByteDance, [experimental `@ui-tars/sdk` guide](https://github.com/bytedance/UI-TARS-desktop/blob/main/docs/sdk.md)
  — `GUIAgent`, custom `Operator`, parsed action, DPR/scaling, callbacks, abort
  signal and loop limits.
- ByteDance, [UI-TARS Desktop / Agent TARS repository](https://github.com/bytedance/UI-TARS-desktop)
  — current multimodal stack and browser-operator implementation context.
- Midscene, [official repository](https://github.com/web-infra-dev/midscene),
  [model strategy](https://midscenejs.com/model-strategy),
  [Chrome Bridge Mode](https://www.midscenejs.com/bridge-mode),
  [caching](https://www.midscenejs.com/caching), and
  [report-file consumption](https://midscenejs.com/zh/consume-report-file).
- Microsoft, [Playwright locators](https://playwright.dev/docs/locators),
  [actionability](https://playwright.dev/docs/actionability),
  [Trace Viewer](https://playwright.dev/docs/trace-viewer), and
  [`connectOverCDP`](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp).
- Microsoft, [Playwright MCP repository](https://github.com/microsoft/playwright-mcp)
  — structured snapshots, target refs, optional vision, session artifacts and
  explicit security limitations.
- Chrome DevTools team, [Chrome DevTools for agents repository](https://github.com/ChromeDevTools/chrome-devtools-mcp)
  and [tool reference](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md)
  — live Chrome, snapshot UID actions, console/network/performance evidence and
  isolation/security options.
- Chrome DevTools Protocol,
  [DOMSnapshot](https://chromedevtools.github.io/devtools-protocol/tot/DOMSnapshot/)
  and [Input](https://chromedevtools.github.io/devtools-protocol/tot/Input/).
- Browser Use, [lifecycle hooks](https://docs.browser-use.com/open-source/customize/hooks),
  [custom tools](https://docs.browser-use.com/open-source/customize/tools/add),
  and [official repository](https://github.com/browser-use/browser-use).
- Stagehand, [`observe()`](https://docs.stagehand.dev/v3/references/observe),
  [`act()`](https://docs.stagehand.dev/v3/basics/act), and
  [official repository](https://github.com/browserbase/stagehand).
- Model Context Protocol,
  [elicitation specification](https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation),
  [client security practices](https://modelcontextprotocol.io/docs/develop/clients/client-best-practices),
  and [tool-annotation risk vocabulary](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/).
