# CLI binding v1: bounded prospective model experiment

Date: 2026-10-05 (Asia/Shanghai). Authorized budget: at most 192 actual HTTP requests,
no retry. Provider: existing OpenCode Go endpoint; requested models GLM-5.3-flash and
DeepSeek-v4.1-flash. This supersedes the initial zero-model budget for this new block,
not any old freeze. Hypothesis is post-hoc; the upcoming locally frozen evaluation is
prospective, not externally registered.

## Primary question

Does exposing an explicit candidate–group binding improve first-choice grounding on
group goals beyond the same group words and candidate set? Does the effect differ on
entity goals? This is a minimal external one-decision caller of the current CLI, not the
historical internal model loop, a full coding agent or a planning/termination study. CLI
vs MCP transport and general task completion are not experimental treatments.

## Design fixed before calls

Reuse the 24 ordinary states of the separate CLI contract study: four hand-crafted DOM
families, two skeletons per family, three counterbalanced states. Two goal conditions
request the same initial control: named entity or its group. Two model-facing
projections of the real `observe --scope relations` output: Bound and Unbound. Both use
the same canonical public group list, candidate fields and reference syntax. Only
`belongs_to` values change from a group ID (`R1`, `R2`, `R3`) to `??`. Every candidate
has one displayed group in these ordinary fixtures. Preflight must verify that. No
oracle, task IDs, family, source HTML or true target metadata enters the model payload.

For each actual CLI observation, construct both projections and require their complete
UTF-8 serialized lengths to match and their canonical group words to match. Equal bytes
do not guarantee equal tokenizer tokens. Preserve real CLI observation/target/evidence
IDs. Separate cells have independently issued UUIDs of the same format and length; these
are incidental variation, not identical prompt bytes between executed arms. Within-view
counterfactual comparison isolates the projection's substantive changes.

24 states × two goals × two projections × two models = 192 cells, one request per cell.
Each cell gets a newly opened tab, real CLI observation, a single model decision and at
most one real CLI action. Rotate dispatch order within each task, concurrency four; save
dispatch index and completion time. No repeated trial, retries, recovery, DONE or
outcome-driven sample extension. Model seed is unavailable. Temperature 0, top_p 1,
max_tokens 8192, provider-default reasoning, JSON-object response format. Timeout 90 s.
Do not interpret temperature zero as deterministic service behavior.

H1: Bound−Unbound first-choice correctness is positive for group goals in each model.
H2: the effect is smaller on entity goals. Failure or abstention is informative. No
non-inferiority/equivalence hypothesis, universal model superiority or SOTA claim.

## Decision and execution

Shared system prompt requests exactly `{"target":"<offered ref>"}` or `{"target":null}`
for abstention. Parse strict JSON with exactly that key. Never repair or re-prompt. A
reference not in the offered click candidates is invalid. If valid, execute the selected
real ref with the original evidence through `prism act --stdin`. The controller cannot
revise the model selection using the oracle. Invalid/abstaining outputs never execute.
Oracle uses the independent app state and recorded click event, not the extractor; it is
consulted only by the harness outside model messages.

Primary: first-choice correctness among all dispatched cells, counting invalid output
and abstention as not correct. Separately report valid-output coverage, abstention,
correct/wrong actual execution, gate refusal, acknowledgement, independent oracle
attainment, provider/infra errors and missing cells. This is not strict agent success:
no termination or multi-step capability is measured. Unknown input outcomes stay
unknown.

Pair Bound/Unbound by page state, goal and model. Average three states within each of
eight base pages; report paired effect, base-page means, four family means and
leave-one-family-out sensitivity. A fixed-seed (20261005) 10,000-resample base-page
bootstrap is a limited uncertainty diagnostic over constructed pages, not a CI for all
websites. Also report four-family clustered sensitivity intervals. Do not use trials as
192 independent tasks or pool models to hide model differences. If any cell is missing
or provider identity unresolved, do not label the block a complete confirmatory result.

## Cost, receipts and stopping

Save complete request bodies, raw response body/content, requested and returned model,
HTTP status, actual attempt count, timeout/error, provider usage, prompt hash, input
bytes, CLI observation, command, receipt and independent oracle. Authorization headers
and keys are never written. Usage missing means unknown. Representation bytes, provider
prompt tokens and total inference usage are separate endpoints. No 35% saving claim
applies.

Freeze the exact method, prompt and analysis before the first real request. Never amend
that manifest to match later changes. Stop new scheduling on authentication/quota error,
unexpected/missing returned model identity or exhausted 192-request budget; retain
in-flight completions (at most four) and every failed cell. A normal single timeout or
invalid output gets no retry. Do not silently rerun into the same block.

Positive results strengthen explicit binding as a mechanism under these controlled tasks
and this minimal CLI caller. Null effects weaken that explanation; inspect valid
coverage and family effects without redesigning the same block. A model disagreement
limits cross-model claims. External realistic tasks and full-agent recovery remain
separate future studies. Freeze experiments rather than add repeats after observing the
effect; any follow-up requires a new question, protocol and budget.
