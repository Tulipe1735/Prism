# Second-model replication v1 — preregistration

Parent: paper-confirmatory-v1. Type: cross-model. Frozen before the sole neutral
connectivity smoke and before benchmark execution. Original evidence is immutable;
no completed parent run, report, config, fixture or archive is rewritten or rerun.
Exactly 12 identical tasks × 5 repeats × 4 identical arms = 240 terminal cells.
No performance tuning, extension, replacement, second model switch or open-web work.

## Model selection and control-diff

Use deepseek-v4.1-flash through the identical OpenCode Go chat-completions endpoint,
chosen from the authenticated model inventory for a different model family, existing
JSON support, and the published Flash subscription allowance. No benchmark results
were consulted for model selection. Config changes: model and separate cohort ID only.
Temperature requested 0, top_p requested 1, max_tokens8192, provider-default reasoning:
no thinking or reasoning_effort fields. DeepSeek documentation says thinking defaults
to enabled/high and temperature does not affect thinking; effective routing/sampling
is not exposed by OpenCode. Preserve requested settings without emulating unsupported
ones. JSON object mode does not guarantee the probability-head schema and can return
empty/truncated content. No schema fallback, repair, prompt tuning or budget increase.

Provider inventory proves access, not remaining quota. Published Flash allowance is
$60 monthly with 50% weekly and 20% five-hour windows. Parent-scale usage projects
below this allowance; worst-case 6500 calls is not guaranteed. No purchase or extra
usage is enabled. Endpoint/quota errors stop new dispatch, active tasks settle;
resume only missing cells with the same model, settings and controls.
Sources: https://opencode.ai/docs/go/ and
https://api-docs.deepseek.com/api/create-chat-completion/ .

## Identical method and outcomes

The parent's preregistration remains the definition of prompts, representations,
annotation-relative minimum levels, ambiguity detector, adaptive escalation, executor,
oracle, transport retry rules, budgets, matched ordering, metric denominators, usage
coverage and failure taxonomy. Reuse its unchanged implementation and byte-identical
task JSON and fixture tree. Four arms: indexed-local, indexed-structural,
indexed-adaptive, raw-selector-reference. Keep exact Node v22.23.2,
Chrome/153.0.8010.12 with browser metadata, viewport1120×780, eight actions, five
stale retries, three HTTP attempts, request120s/task240s, concurrency4, call cap6500,
fixture port9841, CDP9333, observed modal policy. Use a separate dedicated profile.

Separate orchestration files only change isolation, freeze checks and report paths.
Original evaluator/runtime source hashes must equal the parent's freeze before every
dispatch and resume. A passive cloned-response recorder preserves response content,
reasoning, finish reason and usage in a separate JSONL, without changing requests,
responses, validation or retries. Host resource/latency overhead is a measurement
limitation. No other runtime drift is accepted without recording it before execution.

All task object hashes (annotation and executed form), fixture files, runtime/eval
source files, prompts, policy, lockfile, ordered plan and browser/OS metadata are frozen.
The historical inventory protects every existing evaluation artifact and method/test
file. Canonical replication result and response paths are separate. Freeze is exclusive.
Record failed cells as terminal; do not rerun them. On interruption resume missing cells
only. An abrupt process kill can lose unfinished in-flight trials; disclose if it occurs.

## Analysis and qualitative replication criteria

RQ1: report Grounding Success, Strict Task Success, Correct Target Rate, Wrong Target
Rate, Semantic Ambiguity Failure Rate and Invalid Action Rate separately for unique,
local and structural tasks and per task. Structural minus Local is the primary
structural contrast; also Adaptive minus Local. Replication requires a clear positive
structural grounding effect and no consistent local-task need for structural scope.
Do not turn the pooled cohort rate into the RQ1 headline.

RQ2: Adaptive minus Structural grounding, absolute difference and task-cluster CI,
wrong-target rate, representation cost, minimum match, over/under-expansion and
compact/role/local/structural escalation proportions, initially and all/pre/post
grounding. Qualitative replication requires no substantial wrong-target increase,
material representation savings and descriptively close grounding motivating more
study. These criteria are qualitative, not significance thresholds or a numerical margin.
Formal non-inferiority was not tested because no externally justified margin was preregistered.

RQ3: characters and estimated tokens per observation; input/output/total tokens per
task and per grounding/strict success; calls, retries, executed steps and latency.
Adaptive minus Local and Adaptive minus Structural are primary. Exact usage claims
require complete coverage for every HTTP attempt; missing usage stays unknown and
observed lower bounds separate. Qualitative replication requires clearly reduced
Adaptive total usage versus Local and favorable/unresolved versus Structural, without
a large consistent cost regression. Representation size alone proves no total savings.

Reuse matched task-repeat units, task averaging then 2000-draw task-cluster bootstrap,
seed1735, percentile95% intervals, per-task effects and four-task strata. Analyze the
second model independently before cross-model comparison. Never pool raw runs across
models. Report directions, magnitudes and intervals, including degenerate-CI limits.

Failure taxonomy unchanged: SEMANTIC_AMBIGUITY, UNDER_EXPANSION, OVER_EXPANSION,
MODEL_OUTPUT_ERROR, DECISION_ERROR, INVALID_ACTION, EXECUTION_ERROR, BUDGET_EXCEEDED,
PROVIDER_TIMEOUT, PROVIDER_HTTP_ERROR, ENDPOINT_FAILURE, UNKNOWN and existing transport/
stale labels. Expansion labels are independent policy diagnostics. A sufficient-level
wrong choice is not automatically UNDER_EXPANSION. No post-outcome relabeling unless a
genuine schema bug is documented. Suggestions are future method revisions only.

Every failed response diagnostic records output tokens, structured final content,
reasoning-budget exhaustion (true only with usage evidence; otherwise unknown),
recoverable operation/target from emitted content, and pre/post correct grounding.
Partial reasoning is preserved; do not infer intention from absent/truncated evidence.
Compare failure counts, formatting versus grounding, and full reasoning exhaustion
with the parent using the same denominators; secondary subtypes do not replace labels.

Claim ledger: Replicated / Partially replicated / Not replicated / Inconclusive.
Claims refer to these twelve synthetic fixtures and this protocol, not universal
necessity, equivalence, statistical non-inferiority, monetary savings or open-web
validity. Freeze qualitative criteria before outcomes; never rewrite them afterwards.

## Smoke, stop and verification

One neutral nonbenchmark connectivity request with identical budget/settings and JSON
mode, using the unchanged system prompt and a single DONE-only empty action space.
No benchmark task goal, oracle, fixture or tuning. Save request hash, model ID, usage,
finish reason and response outside the 240-cell cohort. If incompatible, report the
blocker; do not silently change prompts or settings.

Stop when exactly 240 unique planned terminal summaries exist. Generate independent
replication report, analysis/integrity/response diagnostics and cross-model summary.
Verify no duplicates/orphan steps, exact planned matrix, hashes and historical evidence,
unit/browser checks, typecheck, lint and build. No more trials until full analysis.
