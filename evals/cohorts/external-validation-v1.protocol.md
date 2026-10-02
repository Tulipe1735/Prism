# External Validation Study v1 — preregistration

This is validation, not optimization. Fifteen tasks, three repeats, four unchanged
variants, two separately analyzed models: 360 planned cells. No expansion of this cohort
is permitted before analysis. Models are glm-5.3-flash and deepseek-v4.1-flash through
the existing endpoint and existing account credentials. No extra purchases or quota
overrides are authorized.

RQ1: does semantic scope affect grounding on externally authored pages? RQ2: does
Adaptive reduce representation exposure while retaining grounding? RQ3: what fails under
real component DOMs, asynchronous state and longer trajectories?

## Sampling and environments

The convenience sample consists of unchanged published DataTables 1.9.4 examples,
Bootstrap compiled 5.3 examples, jQuery UI 1.14.1 demos, and two live The Internet
dynamic pages. Selection uses functional coverage and independently checkable state, not
the Adaptive detector or a desired effect. The old DataTables release is a limitation.
Bootstrap/data-table/component demos are not production applications. Local replay
preserves original files byte for byte, scripts, stylesheet/layout, external links and
dynamic behavior. It provides reproducibility of component DOMs, not open-web deployment
equivalence. The two live pages retain real network dependence. Live source snapshots
are references, not guarantees of identical future responses. Availability problems are
retained, not replaced, and are reported separately.

No local/structural minimum-scope ground truth is assigned. Collect page type, DOM
element count and depth, observed candidate actions, duplicate labels, duplicate
role/name descriptors, bounded local collisions, section/ancestor descriptor collisions,
DOM structure changes, dialogs/hidden elements, initial and final state, executed steps
and goal length. Collision subgroup comparisons are post-execution observational
analyses, not synthetic task classes.

Tasks include table filtering/pagination, independent repeated tables, column filters,
cards with navigation, checkout/sign-in fields, accordion/tabs, modal acknowledgment, a
five-action modal create/save flow and delayed live controls. Known-control browser
checks are conducted before freeze without any model calls. Their scripts and selectors
are private evaluation metadata, never model input. A preflight failure remains visible.
An invalid task/evaluator can be corrected before freeze; no outcome-based correction is
allowed after model runs start.

## Frozen method and evaluation

Use the existing runOne, runAgent, generative probability-head prompt and parser,
formatter, extractor, ambiguity detector, Adaptive policy, executor and HTTP transport
byte for byte. Preserve temperature 0/top_p 1 requested, provider-default reasoning,
8192 output tokens, eight executed actions, two HTTP retries, five stale retries,
240-second task deadline, 120-second request timeout, 1120×780 viewport and four
concurrent owned tabs. No prompt tuning, policy edits, task-specific waits in model
runs, DOM rewrites, modal filtering, new locator logic or recovery changes. All four
variants are exactly indexed-local, indexed-structural, indexed-adaptive and
raw-selector-reference. The selector reference remains a different information budget;
it is not an equal-exposure primary scope comparison.

The external adapter replaces only fixture-specific private target-audit reads: frozen
legal target selectors identify task-relevant selections, candidate-set selectors
identify competing controls, and other navigation/control actions are neutral. Legal
alternative orders of form fills are allowed. Selection correctness concerns the target
element; wrong text/option arguments fail task state rather than being silently treated
as wrong target elements. Wrong executions are counted monotonically in Node after
actual mouse release/native select, not by modifying the page. There is no injected page
mutation or DOM audit marker. Passive DOM property reads add some timing/resource
overhead; they do not alter browser options, readiness waits, actions, policy evidence
or feedback.

Grounding Success: first scored executed target is correct with no wrong execution at
that trial, as in the prior studies. Report no-scored-execution coverage explicitly; no
attempt is not proof of a grounding error. Strict Task Success additionally requires
every frozen independent DOM check, DONE termination, no runtime error and zero wrong
executions across the whole trajectory. Correct/wrong target and invalid action
denominators retain their prior definitions. Report per-task rates before matched
aggregates; do not treat steps as independent observations.

Representation costs retain the existing utf8-bytes-div-4 estimator and include
target-map formatting (plus sanitized DOM for selector reference). These are token
estimates, not provider tokenizer counts. Provider input/output/total usage, all HTTP
attempts/retries, latency and executed steps remain separate. Unreported or incomplete
usage is unknown, never zero. Passive cloned response logs are retained and reconciled
to raw calls, as in model-two replication.

Adaptive logs retain candidate-level assignments/collision groups and derive the maximum
compact→role→local→structural path, expansion count and collision reasons from the
unchanged metadata. This is representational expansion within an observation, not extra
LLM calls. Retain observation-level paths and summarize maximum final level per run,
structural reach and average exposure.

## Failures and analysis

Preserve the prior taxonomy and add separate external labels: DYNAMIC_STATE_MISMATCH,
STALE_BROWSER_STATE, PAGE_STRUCTURE_CHANGE, HIDDEN_ELEMENT, MODAL_INTERFERENCE,
NETWORK_DEPENDENCY, AUTHENTICATION_BLOCK, TASK_UNDEFINED. Use concrete evidence only;
include uncertainty and unresolved classifications. Do not interpret every task failure
as a grounding failure. Keep grounding, environment (including provider infrastructure),
and model-output/termination behavior separate. Visible dialogs plus stale/occlusion are
evidence of possible modal interference, not proof of a causal mechanism. Source drift
and dynamic state variation are reported without retrying or replacing completed failed
cells.

Deterministically interleave variants using the existing schedule and interleave models
for each cell. Analyze each model's population separately. For each metric, average
repeats within tasks; matched contrasts align task and repetition. Use the existing
deterministic 2,000-draw task bootstrap for 95% confidence intervals on per-task matched
differences. Task is the unit, never the action. Report per-task variation and
sensitivity to shared source family, short trajectories, live environment availability,
incomplete usage, and convenience sampling. No predeclared noninferiority margin or
hypothesis-test threshold is introduced. Representation savings alone do not imply lower
end-to-end inference cost.

Freeze config/tasks/metadata/protocol, prompts, original representation/runtime sources,
dependency lockfile, study runner/evaluator/tests/analysis, source files,
Node/browser/OS metadata and the pre-edit historical inventory. Archive sources and
refuse changed controls or duplicate/retried completed cells on resume. Stop dispatch on
endpoint/model-mismatch/control-drift/call-cap failures; already active runs settle.
Preserve all completed failures; resume only missing cells.

## Claims

Supported = reproduced on these externally authored environments with coverage and
direction consistent with the earlier finding. Partially supported = effect present but
weaker/mixed. Not supported = observed contrary transfer evidence. Unknown =
insufficient coverage/evidence. Do not upgrade to open-web generalization, universal
superiority, production readiness, or statistical noninferiority. A zero-event sample
does not establish a zero-risk population. Unavailable live pages cannot validate
behavior on that page. Report this cohort's limitations without fixing the method.
