# Paper confirmatory v1 — preregistration

Written and frozen before any confirmatory model calls. Historical ambiguity-initial,
adaptive pilot, stale-recovery/validation cohorts and delayed-modal diagnostics are
exploratory evidence, protected byte-for-byte. They are not resumed, recomputed or
pooled into this study. Stop after 12 tasks × 5 repeats × 4 arms = 240 terminal cells.
No interim tuning, task replacement, outcome deletion, repeat extension or second model.

## Research framing and primary contrasts

RQ1 — Action Representation and Grounding: How does the amount and scope of semantic
context in action representations affect browser-agent grounding reliability? RQ2 —
Adaptive Context Expansion: Can adaptive context expansion preserve high grounding
reliability while exposing less semantic context than a fixed structural representation?
RQ3 — End-to-End Context Efficiency: Does adaptive action representation reduce
end-to-end inference cost, not just per-observation representation size?

Primary paired contrasts are Adaptive minus Structural and Adaptive minus Local. The
raw-selector-reference arm has additional sanitized locator DOM and a different output
representation. It is a reference arm, never an equivalent causal treatment. Prior
compact/role outcomes remain exploratory. No additional top-level RQs.

## Tasks and preregistered annotations

Twelve fixed, new synthetic fixtures: four unique, four local ambiguity, four
hierarchical/structural ambiguity. All require one intended click; subsequent DONE
allows measuring termination cost separately. The task JSON contains the ambiguity class
and minimum sufficient target representation before any model run. Unique tasks have
distinct labels; local tasks require nearby entity text; structural tasks have equal
local entity text and different section headings or fieldset legends. Expected minimums:
compact for the four unique tasks, local for the four local tasks, structural for the
four structural tasks. No task requires role alone; role remains measurable as an
adaptive outcome. Positions are balanced globally (four first/second/third); stratum
distributions are 2/1/1, 1/2/1 and 1/1/2. Candidate ordering is fixed before runs.

The minimum refers to grounding the requested target, not making every unrelated
candidate distinct. local-04 includes unrelated repeated Help controls with equal local
text and different section headings. The goal Edit Atlas is sufficient at local; a
whole-action-space collision policy may over-expand. This challenge is preregistered,
not selected from Adaptive outcomes. Annotations are design expectations rather than
proof that a model will correctly interpret the sufficient representation. Do not change
an annotation after observing policy output. Browser checks verify public context
extraction and oracle behavior, without requiring Adaptive to match annotations.

## Frozen treatment and environment

Unchanged pilot adaptiveTargets policy: initially compact for every eligible target;
within each operation promote only equal formatted descriptions through role, local,
structural. Ignore index IDs; normalize whitespace, preserve case and compare actual
truncated strings. Stop when distinct or structural is exhausted. Never inspect goals,
private oracle attributes or model outcomes to choose context. Final observation level
is maximum candidate level; log per-candidate levels and counterfactual collisions.
Fixed local80, nearby120, section48, name160, ancestor6 and traversal200 limits. The
role/local/structural formats are not strictly cumulative; structural changes container,
nearby text and heading scope together. Interpret them as bundled scopes.

Model: glm-5.3-flash, OpenCode Go https://opencode.ai/zen/go/v1, temperature0, top_p1,
max_tokens8192, provider-default reasoning; unchanged SYSTEM_PROMPT/TASK_PROMPT_FORMAT.
Chrome/153.0.8010.12, Node v22.23.2, headless dedicated profile, CDP loopback9333,
viewport1120×780, observed modal policy, fixture loopback9841, concurrency4, eight
executed actions, five stale retries, 240000ms task deadline, 120000ms request timeout,
cohort call ceiling6500. Deterministic balanced arm rotation across task/repeat cells.
No model or browser substitution. Record pilot/runtime drift explicitly at freeze.
Provider internal weights, deterministic serving, hardware and fingerprints are not
controlled. Never include secrets in metadata, archives or logs.

Frozen manifest covers config/tasks/annotation bytes, all fixtures, runtime and eval
source, dependency lockfile, exact prompts, protocol, model settings, browser revision
and JS version, Node/OS/architecture, endpoint, viewport/budgets, ordered plan and
variant definitions. Save exact source archive and hashes. Verify on first execution, on
resume and before each dispatch; refuse on drift. Canonical output only: a new output
cannot create an additional cohort. Keep historical inventory and audit before/after.

## Outcomes and denominators

Grounding Success: the first scored executed target input selects the intended target
and executes the correct click, as verified by the private monotonic action audit. An
incorrect first input remains a grounding failure even if corrected later. A later
provider, output, browser or termination failure cannot erase a correct grounding. No
executed scored input counts as Grounding Success false. Report infrastructure failures
separately, including whether they occurred before or after grounding. Strict Task
Success: runtime completes as DONE with no error, final success checks, correct-action
count exactly one and wrong-target counter zero. These outcomes are logged
independently; correct click → provider timeout is grounding true, strict false.

Correct Target Rate = correct scored selections / all correct-or-wrong scored
selections, including unexecuted stale proposals. Wrong Target Rate = wrong executed
inputs / audited executed CLICK/TYPE_TEXT/SELECT inputs; also report any-wrong run rate.
Semantic Ambiguity Failure Rate = primary SEMANTIC_AMBIGUITY summaries / all planned
completed runs. Invalid Action Rate = invalid nonterminal proposals / nonterminal action
attempts. Report overall, per task and per stratum. Infra events may overlap semantic
failures; never collapse them.

Static representation cost includes serialized target-map keys/syntax and, only for
selector reference, sanitized DOM. Characters are Unicode code points. Estimated tokens
= ceil(UTF-8 bytes/4), not GLM tokens. Mean per observation includes terminal
observations, with initial observations separately reported. Total representation tokens
/ successful grounding includes failed-run overhead; also give cost / strict success.
Provider input/output/total token totals are exact only if every actual HTTP attempt
reports usage. Retain response usage and give observed lower bounds and coverage when
retry/error attempts lack counts; never replace missing usage by zero or claim an exact
cost reduction from incomplete data. Calls include all HTTP attempts; retries include
HTTP and stale retries; steps count executed actions; latency includes setup and
cleanup. Provider total cost / success includes failed-run overhead and uses the same
completeness rule. Compare paired representation cost with paired end-to-end
input/output/total tokens, calls/retries/steps/latency explicitly. Smaller
representation does not establish lower end-to-end cost. Tokens measure inference usage,
not monetary price.

## Policy diagnostics

For every Adaptive observation record task class, expected minimum, pre-/post-grounding
phase, initial/final level, full fixed-level collision counts/groups, candidate levels,
remaining mixed collisions, minimum match, estimated tokens and candidate count.
Confusion matrix: expected minimum vs final maximum level. Primary over-/under-expansion
and structural precision/recall use the initial observation (one per Adaptive run);
report all-observation and pre-/post-grounding distributions separately so disappearing
controls do not turn terminal observations into apparent policy errors. Over-expansion =
richer than frozen target minimum. Under-expansion = below minimum AND remaining
ambiguity or grounding failure. A wrong choice at a sufficient level is a
decision/semantic failure, not automatically under-expansion. Structural precision =
expected structural / initial observations ending structural. Recall = ending structural
/ expected structural initial observations. These are annotation-relative diagnostics,
not causal evidence that any escalation improves correctness. OVER_EXPANSION is a policy
label, not an automatic task failure. Show coexisting failure/infra labels
independently.

## Provider failures and interruption

Unchanged preregistered transport: at most three HTTP attempts; retry429/503/529 and
connection exceptions, exponential500/1000ms waits between attempts (2000ms after final
connection exception, matching existing transport). No output-error or task-level retry.
Record original failed attempts with PROVIDER_TIMEOUT, PROVIDER_HTTP_ERROR or
ENDPOINT_FAILURE, including successful retries. Fatal endpoint HTTP400/401/402/403/429,
exhausted5xx/connections, model drift or total call cap stop dispatch; active tasks
settle. Other isolated timeouts follow the same existing endpoint stop rule. Preserve
original failed terminal outcomes. Serialize complete run batches and checkpoint counts.
On interruption resume only missing task/variant/repetition cells under identical
controls; never rerun a completed failure. An abrupt process kill may lose in-flight
uncompleted batches; record this limitation. Interrupted active attempts are not
completed cells.

## Statistical analysis and claim rules

Use matched task-repeat cells; average paired differences across repeats within each
task, then across tasks. Treat task as cluster, not 240 independent samples.
Deterministic 2000-draw task-cluster bootstrap, seed1735, 95% percentile intervals
(2.5–97.5%); preserve all five repeats when resampling tasks. Overall12-task and
within-stratum4-task estimates, per-task paired values, effect sizes and intervals. No
p-values required. Small-cluster intervals and degenerate intervals when all task
differences agree are limited evidence. Any incomplete cohort report is descriptive,
marked incomplete; confirmatory claims wait for240 unique terminal summaries. No
replacement/drop of infrastructure-affected cells.

RQ2 practical reliability gap: Structural Grounding Success minus Adaptive Grounding
Success and paired task-cluster CI. No non-inferiority margin is preregistered; never
claim non-inferiority or equivalence. Similar observed rates are tentative. Context-cost
reduction requires an observed difference and interval; end-to-end reduction requires
complete usage and supported paired total-token differences. Zero observed wrong-target
inputs means zero in this cohort only, not a universally zero error rate.

Failure labels: SEMANTIC_AMBIGUITY, UNDER_EXPANSION, OVER_EXPANSION, MODEL_OUTPUT_ERROR,
DECISION_ERROR, INVALID_ACTION, EXECUTION_ERROR, BUDGET_EXCEEDED, PROVIDER_TIMEOUT,
PROVIDER_HTTP_ERROR, ENDPOINT_FAILURE, UNKNOWN. Preserve original primary failure and
independent policy/infra diagnostics; avoid guessing intention from outputs. For every
variant count grounding failures, strict-only failures and infrastructure-affected runs.

Report directly around RQ1/RQ2/RQ3, Failure Analysis, Threats to Validity, Confirmatory
Conclusions, and a Supported/Tentative/Unsupported claim ledger based on actual
evidence. All conclusions are confined to these synthetic fixtures, one model, one
provider, one runtime and this prompt/structured-output protocol. No open-web,
cross-model or universal-superiority claim; replication is later work, not authorized in
this cohort.
