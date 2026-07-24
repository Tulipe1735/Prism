# Define the browser evidence contract

Type: `wayfinder:grilling`  
Parent: `issues/00-design-the-dual-route-prism-architecture.md`  
State: `closed`  
Status: `ready-for-human`  
Assignee: `/root`  
Blocked by: `issues/12-research-browser-observer-and-ui-tars-integration.md`

## Question

For an objectively verifiable React frontend-repair task, what observations,
typed actions, and verification evidence must the Browser Runtime emit to prove
the requested rendered or interactive behavior changed, remain robust to
irrelevant visual noise, and demonstrate that it never edited source code or
performed an unapproved mutation?

## Comments

### 2026-07-24 — Candidate contract for React rendered-result evidence

Proposed boundary for human confirmation: the Browser Runtime gathers and packages evidence, but UI-TARS model judgment is not the sole success oracle. Every passing MVP verification must bind the exact local preview build, URL, viewport, DPR, interaction state, target identity, and post-change observation, then satisfy at least one deterministic rendered predicate such as computed style, element geometry, visibility, or interaction state.

A passing `BrowserVerificationReport` should include intent-linked assertions, a localized after screenshot, and—when change comparison matters—a localized before/after pair. Visual diffs operate on the target region with explicit masks and tolerances for animation, caret, antialiasing, fonts, and other known noise; full-page screenshots remain forensic artifacts rather than brittle global pixel gates. Each assertion returns `passed`, `failed`, or `inconclusive` and cites its observation and artifact references. Source-level tests and diffs remain Coding Runtime artifacts and cannot substitute for browser-rendered evidence.

The Browser Runtime receives no repository-write, patch, shell, or general filesystem capability. It may write only broker-owned run artifacts. Every browser input is a typed ActionBroker event bound to a fresh observation; the append-only action log plus capability manifest proves which effects were requested, allowed, denied, and executed.

### 2026-07-24 — Human clarification: prompts may be directional rather than numeric

The user rejected any requirement that ordinary prompts supply exact CSS values. A request such as “make this square corner rounder” is sufficiently actionable even without naming a pixel radius; “make this look more premium” is materially more ambiguous.

Revise the contract around an intent-normalization step. Prism preserves the original prompt, then derives a typed `FrontendRepairSpec` before mutation. The spec may use relational predicates such as `border-radius increased from baseline`, categorical predicates such as `corners changed from square to rounded`, or terminal-shape predicates such as `pill radius is at least half the control height`; it need not invent an exact user requirement. The Coding Runtime may choose the concrete implementation value, and the Browser Runtime verifies the normalized relation against fresh before/after rendered observations.

Only prompts whose target, direction, or success meaning cannot be made defensible from page and code context require clarification or human acceptance. Pure aesthetic goals such as “more premium” may be decomposed into a proposed visual plan for confirmation, while clear directional requests such as “more rounded”, “more shadow”, or “increase spacing” proceed without forcing the user to specify CSS.

### 2026-07-24 — Scope challenge: frontend verification versus console operations

The user raised whether React changes make the MVP materially harder than the original GitHub, Vercel, and Supabase dashboard scenarios, whose success could often be checked by rerunning a workflow, endpoint, query, or other backend oracle.

The tradeoff is not simply easy versus hard. Local frontend work introduces rendered-state and visual-intent verification, but it keeps fixtures deterministic, effects local, and both embedded runtimes essential: the Coding Runtime changes source and the Browser Runtime reproduces and verifies the user-visible result. External console operations have simpler backend success oracles but add authentication, third-party UI drift, approval and side-effect risk, rate limits, and difficult reset; they also underuse the Coding Runtime because the source repository may not change. A backend/database code focus would make ordinary tests or API checks authoritative and leave UI-TARS largely incidental.

Recommended MVP boundary: keep frontend as the first vertical slice, but define it as objective frontend repair rather than open-ended visual design. Prioritize reproducible interaction, state, responsive-layout, visibility, and directional style defects, plus prompts such as square-to-rounded or missing-shadow restoration. Defer prompts such as “make it premium” and defer authenticated third-party dashboard repair to a later slice.

## Resolution

Prism's first vertical slice is objectively verifiable React frontend repair, not open-ended visual design, authenticated third-party console operation, or pure backend/database repair. Include reproducible interaction and state bugs, visibility and responsive-layout bugs, and directional style repairs such as square-to-rounded or restoring a missing shadow. Prompts such as “make it more premium” require a proposed concrete change plan and human confirmation, or return `inconclusive`; they are not MVP evaluation cases.

Preserve the original prompt and normalize it into a typed `FrontendRepairSpec` before mutation. The spec can express exact predicates, relational predicates such as `after.borderRadius > before.borderRadius`, event-to-state transitions, and invariants. A user need not provide CSS numbers when the target and direction are clear. The Coding Runtime chooses a reasonable implementation value; the Browser Runtime verifies the normalized intent against fresh rendered observations.

Each `BrowserObservation` binds the run and browser session, local preview build identity, URL and route, browser/version, viewport and DPR, interaction or pseudo-state, target identity, screenshot hash, and the relevant DOM, accessibility, computed-style, geometry, console, and network facts. Prefer a target that combines a semantic locator with a screenshot-bound visual region; purely visual coordinates expire when the observation changes.

A `BrowserVerificationReport` returns `passed`, `failed`, or `inconclusive` and cites every assertion to observation and artifact references. `passed` requires at least one intent-linked deterministic rendered or interaction predicate plus a localized after screenshot; relational repairs also require a matching before observation. UI-TARS qualitative judgment and localized visual diffs may support the result but cannot be the sole oracle. Visual comparison uses target-region clips, explicit masks, and tolerances for animation, caret, antialiasing, fonts, and other declared noise. Full-page screenshots are forensic artifacts, not brittle global pixel gates. Source diffs, unit tests, and build success remain Coding Runtime evidence and cannot substitute for browser verification.

The Browser Runtime has no repository-write, patch, shell, extension-installation, arbitrary-script-evaluation, or general filesystem capability. It may write only broker-owned run artifacts. Every browser input is a typed ActionBroker proposal bound to a fresh observation and recorded append-only with its policy result and execution outcome. Observation and ephemeral interaction inside an allowlisted local preview may run automatically; cross-origin movement, secrets, file transfer, persistent external writes, destructive actions, and permission changes require approval or are denied. This capability manifest and action log demonstrate that the Browser Runtime did not edit source or bypass policy.
