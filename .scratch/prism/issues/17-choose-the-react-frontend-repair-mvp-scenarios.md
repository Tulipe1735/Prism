# Choose the React frontend-repair MVP scenarios

Type: `wayfinder:grilling`  
Parent: `issues/00-design-the-dual-route-prism-architecture.md`  
State: `closed`  
Status: `ready-for-human`  
Assignee: `/root`  
Blocked by: `issues/16-define-shared-run-state-and-handoffs.md`

## Question

Which small, deterministic React fixture scenarios should define Prism's first
frontend-repair slice across interaction and state, visibility, responsive
layout, and directional styles such as radius or shadow—and, for each scenario,
what prompt, initial fixture, expected Run DAG possibilities, source-code
oracle, browser-rendered oracle, and reset make the repair unambiguous?

## Comments

### 2026-07-24 — Candidate six-scenario local React suite

Use one isolated React and TypeScript fixture application with one route per scenario, fixed local data, no authentication or external network, pinned browser and viewports, bundled fonts, and disabled nondeterministic animation. Each scenario manifest records the natural-language prompt, known-bad fixture revision, route and viewport, normalized `FrontendRepairSpec`, accepted DAG family, code and browser oracles, artifact requirements, and deterministic reset command or patch hash. Code acceptance requires a scoped workspace diff plus build and relevant tests; it must not require one exact implementation. Browser acceptance follows the closed evidence contract and is authoritative for user-visible behavior.

Proposed suite balances two explicit change requests with four bug repairs:

1. **Round the primary button.** Prompt: “Make the primary Save button clearly rounded instead of square.” Initial radius is square. Oracle: the same semantic target has a materially larger rendered radius, a localized before/after difference, unchanged text and clickability, and no unintended size shift.
2. **Restore card depth.** Prompt: “Restore a subtle but visible shadow to the profile card without moving it.” Initial `box-shadow` is absent. Oracle: rendered shadow is no longer `none`, the target clip changes, and card geometry and surrounding layout remain within tolerance.
3. **Repair modal opening.** Prompt: “The Edit profile button does nothing; make it open the dialog.” Oracle: browser reproduction fails before the patch; afterward the same click exposes the named `dialog`, moves focus inside it, and produces no new console error.
4. **Repair form enablement.** Prompt: “Submit stays disabled after I enter a valid email; fix it.” Oracle: empty and invalid input remain disabled, valid input enables Submit, and the resulting state transition is visible and keyboard-operable.
5. **Repair mobile overflow.** Prompt: “On mobile the checkout actions run off-screen; keep them usable.” At the pinned mobile viewport, oracle requires no horizontal page overflow, no action overlap or clipping, and every action inside the viewport; a desktop invariant prevents regression.
6. **Repair an occluded menu.** Prompt: “The account menu opens behind the header and cannot be clicked; fix it.” Oracle: the opened menu is visible, not clipped or occluded at its hit-test point, and its fixture item receives the click.

All six require both capabilities and finish with Browser Runtime verification. Code inspection may run concurrently with browser baseline work. The two directional-change scenarios require a pre-mutation rendered baseline but do not force an exact CSS value in the user prompt. The four bug scenarios require browser reproduction before mutation. Browser-only cannot complete because source edits are required; coding-only cannot complete because rendered or interactive verification is required.


## Resolution

Adopt six deterministic scenarios: two explicit frontend change requests and four reproducible bugs. Host them as separate routes in one isolated React and TypeScript fixture application with fixed local data, no authentication or external network, pinned browser and viewports, bundled fonts, and nondeterministic animation disabled. Every scenario manifest records its natural-language prompt, known-bad fixture revision, route and viewport, normalized `FrontendRepairSpec`, accepted DAG family, code and browser oracles, required artifacts, and deterministic reset command or patch hash.

1. **Round the primary button:** “Make the primary Save button clearly rounded instead of square.” Verify a materially larger rendered radius and localized before/after difference while preserving label, clickability, and size.
2. **Restore card depth:** “Restore a subtle but visible shadow to the profile card without moving it.” Verify rendered shadow is no longer `none`, the target clip changes, and card and surrounding geometry remain within tolerance.
3. **Repair modal opening:** “The Edit profile button does nothing; make it open the dialog.” Reproduce failure, then verify the same click exposes the named dialog, moves focus inside, and adds no console error.
4. **Repair form enablement:** “Submit stays disabled after I enter a valid email; fix it.” Verify empty and invalid input remain disabled, valid input enables Submit, and the state transition is visible and keyboard-operable.
5. **Repair mobile overflow:** “On mobile the checkout actions run off-screen; keep them usable.” At the pinned mobile viewport, verify no horizontal page overflow, overlap, or clipping and keep all actions inside the viewport; retain a desktop-layout invariant.
6. **Repair an occluded menu:** “The account menu opens behind the header and cannot be clicked; fix it.” Verify the opened menu is visible, unclipped, unoccluded at its hit-test point, and its fixture item receives the click.

All six are hybrid capability tasks and must finish with Browser Runtime verification. Code inspection may run concurrently with browser baseline or reproduction. The two directional-change scenarios require pre-mutation rendered baselines without forcing exact CSS values in the user prompt; the four bug scenarios require browser reproduction before mutation. Browser-only cannot complete because source edits are required, and coding-only cannot complete because rendered or interactive verification is required.

The code oracle requires a scoped workspace diff, successful build, and relevant tests without mandating one exact implementation. The browser oracle is authoritative for the requested user-visible result and follows the closed evidence contract. Reset must restore the exact known-bad source revision and fixture state and reproduce the original failure or baseline before the next run.
