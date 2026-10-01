# Second-Model Replication

## 1. Replication Protocol

COMPLETE AND AUDITED: 240/240 unique planned terminal summaries. Parent paper-confirmatory-v1; independent cross-model replication using deepseek-v4.1-flash, OpenCode Go.

Same 12 tasks, five repeats, four variants; matching Node/Chrome/viewport/fixtures/prompts/method and budgets. Frozen 2026-10-01T08:03:37.351Z. Formal non-inferiority was not tested because no externally justified margin was preregistered.

Matched task-repeat analysis reuses the parent functions: task averages, seed1735, 2000-draw cluster bootstrap and 95% percentile CIs, independently by task stratum. Selector reference has extra DOM and is not an equivalent causal arm.

| Model setting | Frozen value / observed limitation |
|---|---|
| Model / provider | deepseek-v4.1-flash / OpenCode Go, same chat-completions endpoint as parent |
| Temperature / top_p requested | 0 / 1; no setting emulated |
| Output budget | 8,192 tokens on every call, including failures |
| Reasoning | Provider default; no thinking or reasoning_effort overrides. Smoke and cohort responses emitted reasoning tokens. |
| Effective sampling | DeepSeek documents temperature as ineffective in thinking mode; OpenCode effective sampling/default effort is not exposed. Fixed requested settings do not establish deterministic serving. |
| Structured output | Same json_object mode, prompt and probability-head validator; JSON syntax does not guarantee Prism schema or usable final content. |
| Connectivity / allowance | One neutral smoke before benchmark; 240 benchmark cells completed without HTTP or quota errors. No model switch, extra usage or purchase enabled. |

Settings and capability sources: [OpenCode Go](https://opencode.ai/docs/go/) and
[DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/).

## 2. Control-Diff Audit

Protected files 202; changed 0. Parent method source hash 979167cfc4cf26c422546b356a60a39685b3a2afbbde19865c019bd466b1a9be; separate orchestration hash e383630db48197e115ea0d4f1b6d24ea1cfad95f7939cce68fc7ce34748fc438. Task/fixture/source/prompt/policy/config/archive hashes verified. No unexpected control drift.

Expected treatment difference: model/provider-model configuration only. Cohort ID,
artifact paths and dedicated browser profile differ to isolate the study. All other
cohort settings, method sources, task annotations, fixture bytes, prompts, browser
revision, JavaScript engine, Node and OS metadata match. Separate orchestration and
passive response logging add no policy feedback; minor host/latency overhead is disclosed.

Qualitative criteria were frozen before outcomes: a positive structural scope effect
without consistent local-task need for Structural; high Adaptive grounding, no substantial
wrong-target increase and smaller representation context; lower Adaptive total usage
versus Local with favorable or unresolved usage versus Structural. These are qualitative
criteria, not newly invented significance thresholds or a non-inferiority margin.

Passive response record coverage: 520/520 actual HTTP attempts. Potential small host/latency overhead is disclosed; no method changes.
## 3. RQ1 — Action Representation and Grounding

RQ1 replicated. Structural-class grounding was 20/20 with Structural, 19/20 with Adaptive, and 5/20 with Local. Structural minus Local was 75.00 [40.00, 100.00] pp; all four structural tasks had a positive paired effect. Every local task achieved 5/5 grounding with both Local and Structural: richer context was not consistently needed. Unique tasks also reached 20/20 with Local and Structural. These findings support matching scope to ambiguity, not universally requiring structural context; chance successes under insufficient context remain possible.

| Class | Variant | Grounding Success | Correct Target Rate | Wrong Target Rate | Any wrong run | Semantic ambiguity failure | Invalid Action Rate | Strict Task Success |
|---|---|---|---|---|---|---|---|---|
| overall | indexed-local | 75.0% (45/60) | 53.5% (54/101) | 46.5% (47/101) | 23.3% (14/60) | 23.3% (14/60) | 0.0% (0/107) | 75.0% (45/60) |
| overall | indexed-structural | 100.0% (60/60) | 100.0% (60/60) | 0.0% (0/60) | 0.0% (0/60) | 0.0% (0/60) | 0.0% (0/60) | 100.0% (60/60) |
| overall | indexed-adaptive | 96.7% (58/60) | 100.0% (58/58) | 0.0% (0/58) | 0.0% (0/60) | 0.0% (0/60) | 1.7% (1/60) | 86.7% (52/60) |
| overall | raw-selector-reference | 100.0% (60/60) | 100.0% (60/60) | 0.0% (0/60) | 0.0% (0/60) | 0.0% (0/60) | 0.0% (0/60) | 96.7% (58/60) |
| unique | indexed-local | 100.0% (20/20) | 100.0% (20/20) | 0.0% (0/20) | 0.0% (0/20) | 0.0% (0/20) | 0.0% (0/20) | 100.0% (20/20) |
| unique | indexed-structural | 100.0% (20/20) | 100.0% (20/20) | 0.0% (0/20) | 0.0% (0/20) | 0.0% (0/20) | 0.0% (0/20) | 100.0% (20/20) |
| unique | indexed-adaptive | 95.0% (19/20) | 100.0% (19/19) | 0.0% (0/19) | 0.0% (0/20) | 0.0% (0/20) | 0.0% (0/20) | 95.0% (19/20) |
| unique | raw-selector-reference | 100.0% (20/20) | 100.0% (20/20) | 0.0% (0/20) | 0.0% (0/20) | 0.0% (0/20) | 0.0% (0/20) | 100.0% (20/20) |
| local | indexed-local | 100.0% (20/20) | 100.0% (20/20) | 0.0% (0/20) | 0.0% (0/20) | 0.0% (0/20) | 0.0% (0/20) | 100.0% (20/20) |
| local | indexed-structural | 100.0% (20/20) | 100.0% (20/20) | 0.0% (0/20) | 0.0% (0/20) | 0.0% (0/20) | 0.0% (0/20) | 100.0% (20/20) |
| local | indexed-adaptive | 100.0% (20/20) | 100.0% (20/20) | 0.0% (0/20) | 0.0% (0/20) | 0.0% (0/20) | 0.0% (0/20) | 80.0% (16/20) |
| local | raw-selector-reference | 100.0% (20/20) | 100.0% (20/20) | 0.0% (0/20) | 0.0% (0/20) | 0.0% (0/20) | 0.0% (0/20) | 95.0% (19/20) |
| structural | indexed-local | 25.0% (5/20) | 23.0% (14/61) | 77.0% (47/61) | 70.0% (14/20) | 70.0% (14/20) | 0.0% (0/67) | 25.0% (5/20) |
| structural | indexed-structural | 100.0% (20/20) | 100.0% (20/20) | 0.0% (0/20) | 0.0% (0/20) | 0.0% (0/20) | 0.0% (0/20) | 100.0% (20/20) |
| structural | indexed-adaptive | 95.0% (19/20) | 100.0% (19/19) | 0.0% (0/19) | 0.0% (0/20) | 0.0% (0/20) | 5.0% (1/20) | 85.0% (17/20) |
| structural | raw-selector-reference | 100.0% (20/20) | 100.0% (20/20) | 0.0% (0/20) | 0.0% (0/20) | 0.0% (0/20) | 0.0% (0/20) | 95.0% (19/20) |

Correct target rates are conditional on scored accepted selections, including stale proposals. Wrong-target rates count executed audited inputs; any-wrong run rate exposes trajectory contamination. Missing oracle coverage is not zero. Primary semantic-failure counts may coexist with later infrastructure events.

### Per-task results

Each cell: grounding / strict / runs; W = wrong executed inputs.

| Task | Local | Structural | Adaptive | Selector reference |
|---|---|---|---|---|
| paper-unique-01 | 5/5/5; W=0 | 5/5/5; W=0 | 5/5/5; W=0 | 5/5/5; W=0 |
| paper-unique-02 | 5/5/5; W=0 | 5/5/5; W=0 | 5/5/5; W=0 | 5/5/5; W=0 |
| paper-unique-03 | 5/5/5; W=0 | 5/5/5; W=0 | 5/5/5; W=0 | 5/5/5; W=0 |
| paper-unique-04 | 5/5/5; W=0 | 5/5/5; W=0 | 4/4/5; W=0 | 5/5/5; W=0 |
| paper-local-01 | 5/5/5; W=0 | 5/5/5; W=0 | 5/5/5; W=0 | 5/4/5; W=0 |
| paper-local-02 | 5/5/5; W=0 | 5/5/5; W=0 | 5/4/5; W=0 | 5/5/5; W=0 |
| paper-local-03 | 5/5/5; W=0 | 5/5/5; W=0 | 5/5/5; W=0 | 5/5/5; W=0 |
| paper-local-04 | 5/5/5; W=0 | 5/5/5; W=0 | 5/2/5; W=0 | 5/5/5; W=0 |
| paper-structural-01 | 1/1/5; W=17 | 5/5/5; W=0 | 5/5/5; W=0 | 5/4/5; W=0 |
| paper-structural-02 | 4/4/5; W=7 | 5/5/5; W=0 | 4/4/5; W=0 | 5/5/5; W=0 |
| paper-structural-03 | 0/0/5; W=4 | 5/5/5; W=0 | 5/4/5; W=0 | 5/5/5; W=0 |
| paper-structural-04 | 0/0/5; W=19 | 5/5/5; W=0 | 5/4/5; W=0 | 5/5/5; W=0 |

### Matched grounding effects

Adaptive minus comparator, percentage points; 95% task-cluster CI. Positive means higher adaptive grounding rate.

| Class | Contrast | Grounding difference [95% CI] | Strict difference [95% CI] | Any-wrong difference [95% CI] |
|---|---|---|---|---|
| overall | Adaptive − indexed-local | 21.67 [0.00, 46.67] | 11.67 [-10.00, 36.67] | -23.33 [-46.67, -5.00] |
| overall | Adaptive − indexed-structural | -3.33 [-8.33, 0.00] | -13.33 [-23.33, -5.00] | 0.00 [0.00, 0.00] |
| unique | Adaptive − indexed-local | -5.00 [-15.00, 0.00] | -5.00 [-15.00, 0.00] | 0.00 [0.00, 0.00] |
| unique | Adaptive − indexed-structural | -5.00 [-15.00, 0.00] | -5.00 [-15.00, 0.00] | 0.00 [0.00, 0.00] |
| local | Adaptive − indexed-local | 0.00 [0.00, 0.00] | -20.00 [-45.00, 0.00] | 0.00 [0.00, 0.00] |
| local | Adaptive − indexed-structural | 0.00 [0.00, 0.00] | -20.00 [-45.00, 0.00] | 0.00 [0.00, 0.00] |
| structural | Adaptive − indexed-local | 70.00 [25.00, 100.00] | 60.00 [20.00, 80.00] | -70.00 [-95.00, -35.00] |
| structural | Adaptive − indexed-structural | -5.00 [-15.00, 0.00] | -15.00 [-20.00, -5.00] | 0.00 [0.00, 0.00] |

Fixed scope comparison: Structural minus Local Grounding Success, percentage points [95% task-cluster CI]: overall: 25.00 [3.33, 50.00]; unique: 0.00 [0.00, 0.00]; local: 0.00 [0.00, 0.00]; structural: 75.00 [40.00, 100.00].

Per-task paired effects (all metrics and strata) are retained in paper-replication-model2-v1-analysis.json. A degenerate empirical interval is not proof of zero population uncertainty.

## 4. RQ2 — Adaptive Context Expansion

RQ2 qualitatively replicated on grounding and context exposure: Adaptive grounded 58/60 (96.7%) versus Structural 60/60 (100%), with no wrong executed inputs, 35.4% less initial representation context, 55/60 minimum matches, five over-expansions and no under-expansions. The observed 3.33 pp grounding deficit has a 95% task-cluster interval of 0 to 8.33 pp; these are descriptively close rates, not established reliability preservation. The two Adaptive grounding failures were malformed responses before execution. Initial expansion counts match the parent exactly, as expected for the deterministic unchanged policy and fixed fixtures.

Strict completion did not preserve the same pattern: Adaptive 52/60 versus Structural 60/60, Adaptive minus Structural -13.33 [-23.33, -5.00] pp. Six Adaptive trajectories selected the correct target but subsequently reported BLOCKED. Grounding, termination and strict success therefore require separate claims.

Structural Grounding Success: 100.0% (60/60). Adaptive: 96.7% (58/60). Absolute reliability gap (Structural − Adaptive): 3.33 pp [0.00, 8.33]. No non-inferiority margin was preregistered.

### Context cost and paired savings

Adaptive minus comparator in estimated tokens; negative means less context.

| Class | Contrast | Initial tokens difference [95% CI] | Tokens/observation difference [95% CI] |
|---|---|---|---|
| overall | Adaptive − indexed-local | 5.92 [-8.92, 20.50] | 4.51 [-7.48, 16.30] |
| overall | Adaptive − indexed-structural | -26.67 [-39.83, -13.75] | -22.07 [-33.37, -11.00] |
| unique | Adaptive − indexed-local | -25.25 [-27.25, -23.50] | -20.70 [-22.22, -19.38] |
| unique | Adaptive − indexed-structural | -54.50 [-58.00, -51.00] | -45.70 [-50.15, -41.25] |
| local | Adaptive − indexed-local | 6.00 [0.00, 18.00] | 6.00 [0.00, 18.00] |
| local | Adaptive − indexed-structural | -25.50 [-33.00, -19.00] | -21.13 [-27.63, -15.75] |
| structural | Adaptive − indexed-local | 37.00 [35.50, 38.50] | 28.24 [25.58, 32.00] |
| structural | Adaptive − indexed-structural | 0.00 [0.00, 0.00] | 0.63 [0.00, 1.88] |

### Escalation distribution

| Observation set | N | Compact | Role | Local | Structural | Any escalation |
|---|---|---|---|---|---|---|
| Initial (primary) | 60 | 33.3% (20/60) | 0.0% (0/60) | 25.0% (15/60) | 41.7% (25/60) | 66.7% (40/60) |
| All pre-grounding | 60 | 33.3% (20/60) | 0.0% (0/60) | 25.0% (15/60) | 41.7% (25/60) | 66.7% (40/60) |
| Post-grounding | 58 | 32.8% (19/58) | 0.0% (0/58) | 25.9% (15/58) | 41.4% (24/58) | 67.2% (39/58) |
| All observations | 118 | 33.1% (39/118) | 0.0% (0/118) | 25.4% (30/118) | 41.5% (49/118) | 66.9% (79/118) |

### Expected minimum versus Adaptive final level (initial observations)

| Expected | Compact | Role | Local | Structural |
|---|---|---|---|---|
| compact | 20 | 0 | 0 | 0 |
| role | 0 | 0 | 0 | 0 |
| local | 0 | 0 | 15 | 5 |
| structural | 0 | 0 | 0 | 20 |

Minimum match 91.7% (55/60); over-expansion 8.3% (5/60); under-expansion 0.0% (0/60). Structural escalation precision 80.0% (20/25); recall 100.0% (20/20).

These primary diagnostics score the requested target's frozen minimum on the initial observation. The all-observation distribution includes cheap terminal turns; terminal levels are not evidence of under-expansion. Every adaptive observation's collisions, phase, candidate levels, expected-level match and cost are saved in the analysis artifact.

## 5. RQ3 — End-to-End Context Efficiency

RQ3 replicated the original pattern. Adaptive used 1,748.03 versus Local 4,177.88 tokens/task, 58.2% less, with paired difference -2429.85 [-5487.85, -361.65]. Adaptive versus Structural was 1,748.03 versus 1,772.30, paired difference -24.27 [-131.87, 115.85]. The latter interval crosses zero, so total savings over Structural remain unresolved despite smaller initial context. All 520 HTTP calls reported usage; these totals include failed trajectories and reasoning tokens.

Adaptive saved input tokens relative to Structural (-65.45 [-101.68, -33.52]) but used more output tokens on average (41.18 [-49.27, 158.72]). The structural stratum even had a positive point difference in total usage (144.10 [-153.80, 442.00]), with unresolved interval. The overall Adaptive/Local saving is concentrated in structural-ambiguity tasks; local-class cost is unresolved. Tokens per grounding success were 1,808.31 for Adaptive versus 1,772.30 for Structural; tokens per strict success were 2,016.96 versus 1,772.30. Lower per-task usage does not establish equal success-adjusted efficiency.

### Representation-level cost

| Variant | Observations | Chars/obs | Est. tokens/obs | Initial est. tokens | Est. tokens/grounding success | Est. tokens/strict success |
|---|---|---|---|---|---|---|
| indexed-local | 162 | 146.78 | 37.12 | 42.75 | 133.62 | 133.62 |
| indexed-structural | 120 | 253.88 | 63.92 | 75.33 | 127.83 | 127.83 |
| indexed-adaptive | 118 | 165.50 | 41.71 | 48.67 | 84.86 | 94.65 |
| raw-selector-reference | 120 | 834.67 | 209.04 | 211.58 | 418.08 | 432.50 |

Tokens here are ceil(UTF-8 bytes/4), including target-map syntax; selector-reference includes DOM. They are estimates, not GLM tokenizer or billed tokens. Cost per success charges the arm's failed-run overhead. HTTP retransmissions are represented by provider call counts rather than counted as new observations.

### Provider usage and interaction cost

Exact totals require usage for every actual HTTP attempt. Observed usage lower bounds remain separate; failed/retry calls may have unreported consumption.

| Variant | Complete-usage tasks | Usage-bearing calls / actual calls | Input/task | Output/task | Total/task | Observed total lower bound/task | Total/grounding success | Total/strict success | Calls/task | Retries/task | Steps/task | Latency ms/task |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| indexed-local | 60/60 | 162/162 | 1638.85 | 2539.03 | 4177.88 | 4177.88 | 5570.51 | 5570.51 | 2.70 | 0.00 | 1.78 | 21565.77 |
| indexed-structural | 60/60 | 120/120 | 1231.52 | 540.78 | 1772.30 | 1772.30 | 1772.30 | 1772.30 | 2.00 | 0.00 | 1.00 | 6572.59 |
| indexed-adaptive | 60/60 | 118/118 | 1166.07 | 581.97 | 1748.03 | 1748.03 | 1808.31 | 2016.96 | 1.97 | 0.00 | 0.97 | 6528.19 |
| raw-selector-reference | 60/60 | 120/120 | 1627.47 | 999.68 | 2627.15 | 2627.15 | 2627.15 | 2717.74 | 2.00 | 0.00 | 1.00 | 9597.65 |

### Matched inference-cost effects

Adaptive minus comparator; 95% task-cluster intervals. Missing usage invalidates the complete paired token estimate.

| Class | Contrast | Input tokens | Output tokens | Total tokens | Calls | Retries | Steps | Latency ms |
|---|---|---|---|---|---|---|---|---|
| overall | Adaptive − indexed-local | -472.78 [-909.00, -112.88] | -1957.07 [-4599.47, -227.55] | -2429.85 [-5487.85, -361.65] | -0.73 [-1.42, -0.15] | 0.00 [0.00, 0.00] | -0.82 [-1.60, -0.15] | -15037.59 [-34886.80, -1880.71] |
| overall | Adaptive − indexed-structural | -65.45 [-101.68, -33.52] | 41.18 [-49.27, 158.72] | -24.27 [-131.87, 115.85] | -0.03 [-0.08, 0.00] | 0.00 [0.00, 0.00] | -0.03 [-0.08, 0.00] | -44.40 [-568.17, 575.10] |
| unique | Adaptive − indexed-local | -76.00 [-134.50, -46.00] | -16.70 [-66.80, 33.40] | -92.70 [-193.15, -12.60] | -0.05 [-0.15, 0.00] | 0.00 [0.00, 0.00] | -0.05 [-0.15, 0.00] | -278.67 [-464.63, -92.70] |
| unique | Adaptive − indexed-structural | -125.50 [-186.25, -91.00] | -5.05 [-44.70, 34.60] | -130.55 [-204.70, -56.40] | -0.05 [-0.15, 0.00] | 0.00 [0.00, 0.00] | -0.05 [-0.15, 0.00] | -202.79 [-455.81, 50.22] |
| local | Adaptive − indexed-local | 12.00 [0.00, 36.00] | 10.20 [-146.30, 195.80] | 22.20 [-146.30, 231.80] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 35.02 [-530.52, 730.04] |
| local | Adaptive − indexed-structural | -42.50 [-53.75, -32.50] | -43.85 [-79.70, -8.00] | -86.35 [-124.70, -48.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | -415.76 [-962.37, 45.50] |
| structural | Adaptive − indexed-local | -1354.35 [-1920.20, -788.50] | -5864.70 [-12081.10, -2283.60] | -7219.05 [-14129.00, -3432.75] | -2.15 [-3.00, -1.30] | 0.00 [0.00, 0.00] | -2.40 [-3.40, -1.40] | -44869.11 [-90021.69, -19634.18] |
| structural | Adaptive − indexed-structural | -28.35 [-91.65, 6.60] | 172.45 [-92.70, 437.60] | 144.10 [-153.80, 442.00] | -0.05 [-0.15, 0.00] | 0.00 [0.00, 0.00] | -0.05 [-0.15, 0.00] | 485.34 [-969.85, 1940.52] |

Representation cost and inference cost are distinct: initial Adaptive − Structural representation effect -26.67 [-39.83, -13.75] estimated tokens; total provider-token effect -24.27 [-131.87, 115.85]. Reduced end-to-end inference usage is not established by the paired total-token interval (or usage coverage); smaller context alone is insufficient.

## 6. Failure Analysis

Failure distribution changed materially: MODEL_OUTPUT_ERROR fell from 33/240 (13.75%) to 3/240 (1.25%); DECISION_ERROR rose from 0 to 8/240 (3.33%). SEMANTIC_AMBIGUITY was 15 versus 14; both models had exactly 14 Local/structural-class primary semantic failures. Those recurring insufficient-scope failures are more representation-stable than formatting or completion behavior. Local wrong executed inputs rose from 35 to 47 because some trajectories repeatedly selected wrong controls. Adaptive observed zero wrong inputs in both models.

All eight DeepSeek DECISION_ERROR failures grounded correctly and then emitted valid BLOCKED JSON. Six were Adaptive and two selector-reference; three Adaptive cases were local-04. Preserved reasoning reinterpreted the disabled/completed requested control as missing or uneditable, sometimes treating the visible completion status as a suspected trap despite the preceding correct click. This is observed termination reasoning, not evidence that the action was grounded incorrectly. The repeated local-04 over-expansion is shared across models, but its co-occurrence with three DeepSeek BLOCKED decisions does not establish causation.

The two Adaptive MODEL_OUTPUT_ERROR cases emitted recoverable target choices but violated the probability-head schema: unique-04/r2 omitted other offered target keys, and structural-02/r2 used a scalar operation. The Local structural-03/r4 response emitted no usable content. No schema repairs or extra calls were made.

Reasoning exhaustion is not exclusive to GLM: it occurred in two DeepSeek Local/structural-class responses, each with all 8,192 output tokens recorded as reasoning and finish_reason=length. One was structural-03/r4 before any input; one was structural-01/r2 after wrong-team inputs. The latter retains primary SEMANTIC_AMBIGUITY and an independent output-exhaustion diagnostic. Both had no final JSON and no uniquely validated final target recoverable from the partial reasoning; structural-03 contained provisional target-2 speculation, not an executed or validated decision. The parent had four such responses. Absence of final JSON appears as missing content under GLM and empty content under DeepSeek, so comparisons treat null and empty content alike without changing primary labels.

Counts overlap when a grounding or terminal failure also has infrastructure events. A successful preregistered retry retains its original event. Grounding failures are runs without first-target grounding; strict-only failures grounded correctly but fail the full trajectory.

| Variant | Grounding failures | Strict-task-only failures | Infrastructure-affected runs | Primary failure distribution |
|---|---|---|---|---|
| indexed-local | 15 | 0 | 0 | SEMANTIC_AMBIGUITY: 14; MODEL_OUTPUT_ERROR: 1 |
| indexed-structural | 0 | 0 | 0 | none |
| indexed-adaptive | 2 | 6 | 0 | DECISION_ERROR: 6; MODEL_OUTPUT_ERROR: 2 |
| raw-selector-reference | 0 | 2 | 0 | DECISION_ERROR: 2 |

Adaptive annotation-relative policy labels: OVER_EXPANSION 5, UNDER_EXPANSION 0 initial observations. Over-expansion is not an automatic task failure. Required taxonomy additionally distinguishes SEMANTIC_AMBIGUITY, MODEL_OUTPUT_ERROR, DECISION_ERROR, INVALID_ACTION, EXECUTION_ERROR, BUDGET_EXCEEDED, PROVIDER_TIMEOUT, PROVIDER_HTTP_ERROR, ENDPOINT_FAILURE and UNKNOWN. A wrong target has concrete semantic evidence; label co-occurrence does not identify the causal mechanism. Every failed/infra-affected run is indexed in the analysis JSON with complete traces available by run_id in the raw JSONL.


### Output-Budget Diagnostic

Every failed step is indexed in paper-replication-model2-v1-failure-diagnostics.json and its full provider response in the separate response log. 2 responses demonstrably consumed the full budget as reasoning; 0 full-budget responses lack a reasoning-token split (unknown, not asserted zero). No max_tokens increase or failure rerun.

| Primary failure label | GLM / 240 | DeepSeek / 240 |
|---|---|---|
| SEMANTIC_AMBIGUITY | 15 | 14 |
| UNDER_EXPANSION | 0 | 0 |
| OVER_EXPANSION | 0 | 0 |
| MODEL_OUTPUT_ERROR | 33 | 3 |
| DECISION_ERROR | 0 | 8 |
| INVALID_ACTION | 0 | 0 |
| EXECUTION_ERROR | 0 | 0 |
| BUDGET_EXCEEDED | 0 | 0 |
| PROVIDER_TIMEOUT | 0 | 0 |
| PROVIDER_HTTP_ERROR | 0 | 0 |
| ENDPOINT_FAILURE | 0 | 0 |
| UNKNOWN | 0 | 0 |

## 7. Cross-Model Comparison

| Finding | glm-5.3-flash | deepseek-v4.1-flash | Replication status |
|---|---|---|---|
| Structural > Local on structural ambiguity | Structural 90.0% (18/20); Local 25.0% (5/20) | Structural 100.0% (20/20); Local 25.0% (5/20) | Replicated |
| Local sufficient on local ambiguity | 90.0% (18/20) | 100.0% (20/20) | Replicated; assess per-task evidence |
| Adaptive zero/low wrong-target inputs | 0 | 0 | Replicated (observed zero only) |
| Adaptive initial representation cost < Structural | 35.4% less | 35.4% less | Replicated |
| Adaptive total tokens < Local | 1423 vs 3117 | 1748 vs 4178 | Replicated |
| Adaptive total tokens < Structural | 1423 vs 1616; unresolved | 1748 vs 1772 | Inconclusive; cross-model savings unsupported |

### Effect directions and magnitudes

Difference [95% task-cluster CI]. Each model analyzed independently.

| Contrast | GLM | DeepSeek |
|---|---|---|
| Structural − Local grounding (structural), pp | 65.00 [10.00, 100.00] | 75.00 [40.00, 100.00] |
| Adaptive − Structural grounding, pp | 5.00 [-5.00, 15.00] | -3.33 [-8.33, 0.00] |
| Adaptive − Local total tokens/task | -1693.47 [-3410.57, -288.13] | -2429.85 [-5487.85, -361.65] |
| Adaptive − Structural total tokens/task | -192.10 [-440.80, 18.02] | -24.27 [-131.87, 115.85] |

### Failure distribution

| Primary failure label | GLM / 240 | DeepSeek / 240 |
|---|---|---|
| SEMANTIC_AMBIGUITY | 15 | 14 |
| UNDER_EXPANSION | 0 | 0 |
| OVER_EXPANSION | 0 | 0 |
| MODEL_OUTPUT_ERROR | 33 | 3 |
| DECISION_ERROR | 0 | 8 |
| INVALID_ACTION | 0 | 0 |
| EXECUTION_ERROR | 0 | 0 |
| BUDGET_EXCEEDED | 0 | 0 |
| PROVIDER_TIMEOUT | 0 | 0 |
| PROVIDER_HTTP_ERROR | 0 | 0 |
| ENDPOINT_FAILURE | 0 | 0 |
| UNKNOWN | 0 | 0 |

OVER_EXPANSION and UNDER_EXPANSION are also independent policy labels; do not interpret zero primary counts as zero policy events.
Initial Adaptive expansion labels: GLM over 5/60, under 0/60; DeepSeek over 5/60, under 0/60.

Strict-only failures after correct grounding: GLM 14; DeepSeek 8. Full reasoning-budget missing-content cases: GLM 4; DeepSeek 2; unknown reasoning attribution 0.

Formal non-inferiority was not tested because no externally justified margin was preregistered.

Cross-model conclusions remain confined to these shared authored fixtures, provider, prompt and executor. Effective sampling and reasoning defaults can differ by model. External/open-web validity and universal necessity are unsupported.

## 8. Replication Status

| Question | Qualitative replication assessment |
|---|---|
| RQ1 | Replicated: all four structural tasks favor Structural over Local; all local tasks ground perfectly with Local. |
| RQ2 | Qualitatively replicated for high grounding, zero observed wrong inputs and lower representation context; reliability preservation remains inconclusive. Strict completion is model-sensitive and worse for Adaptive under DeepSeek. |
| RQ3 | Replicated pattern: total saving versus Local is supported, while saving versus Structural remains unresolved. |

The most stable behavioral effect is the structural scope advantage (GLM +65 pp,
DeepSeek +75 pp), together with Local sufficiency on local ambiguity. Static representation
savings are identically 35.4%, a reproducibility consequence of fixed inputs/policy rather
than independent evidence for new tasks. The most model-sensitive effects are protocol/
termination behavior and Adaptive's relative grounding direction: +5 pp under GLM versus
−3.33 pp under DeepSeek. Adaptive minus Structural strict success changes from 5.00 [-5.00, 15.00] pp
under GLM to -13.33 [-23.33, -5.00] pp under DeepSeek.

This evidence is sufficient to proceed to separately preregistered external/open-web
validation of the scope and cost hypotheses. It does not establish deployment reliability
or external validity. That next study should audit grounding and termination separately,
retain total usage and output-budget diagnostics, and avoid treating authored fixture
success as proof that real-web interactions have succeeded. No external experiments
were started during this milestone.

Future method revision: investigate completion-evidence interpretation, structured-head
errors and whole-space over-expansion; none was changed during this cohort. Any method
revision requires a new version and a separate evaluation, not repair of these results.

## 9. Threats to Validity

Twelve authored synthetic/local fixtures, one replication model, one provider, one prompt, one browser/runtime. The five repeats are not independent tasks. Four task clusters per stratum yield unstable bootstrap tails; zero differences can give degenerate empirical intervals. Provider serving state, time and concurrency may correlate repetitions; balanced ordering mitigates but does not eliminate this. Local/structural formats bundle multiple fields and truncation limits. The target-minimum annotations are designed sufficiency expectations, not natural-web ground truth. Whole-space collisions can exceed target needs. Selector reference has extra DOM and different locator syntax. Static token estimates are heuristic; provider usage can be incomplete. Structured probability-head errors are policy/protocol failures, not proof of inadequate semantic context. No open-web, external benchmark or universal-superiority inference; two-model evidence uses the same synthetic tasks.



Some preserved reasoning speculates about synthetic benchmark layout from fixture URLs; this is observable heuristic reasoning, not evidence of training exposure. The shared goal/URL/prompt limits independence and external validity. No URLs or task wording were changed.

Additional cross-model limitation: same tasks/fixtures/provider/prompt make this a model replication, not an independent benchmark/task replication. Provider defaults and unexposed effective sampling differ; two models do not establish universal generalization. No automatic source tuning or additional trials. Any suggested improvements are future method revisions.

## 10. Claim Ledger

| Status | Claim | Evidence / limit |
|---|---|---|
| Replicated | Structural context improves grounding over Local on the structural-ambiguity tasks. | 75.00 [40.00, 100.00] pp |
| Replicated | Local context is sufficient on the locally distinguishable tasks. | Local 100.0% (20/20); Structural 100.0% (20/20); paired gap 0.00 [0.00, 0.00] pp. Requires qualitative task-level interpretation; no absolute sufficiency threshold invented. |
| Replicated | Adaptive reduces initial representation cost relative to Structural. | 35.4% reduction |
| Inconclusive | Adaptive preserves descriptively Structural-like grounding reliability. | -3.33 [-8.33, 0.00] pp; 0 wrong executed inputs; descriptive only, no non-inferiority. |
| Replicated | Adaptive reduces total inference tokens relative to Local. | -2429.85 [-5487.85, -361.65] tokens/task |
| Inconclusive | Adaptive reduces total inference tokens relative to Structural. | -24.27 [-131.87, 115.85] tokens/task; parent claim was unresolved, so new evidence does not retroactively establish cross-model savings. |
| Replicated | Adaptive executed zero wrong targets in both completed cohorts. | GLM 0 and DeepSeek 0; cohort-only observation, not a universal zero-error claim. |
| Partially replicated | Adaptive has high descriptive grounding with less representation context. | 93.3% vs 88.3% under GLM; 96.7% vs 100% under DeepSeek. No non-inferiority margin; relative direction reverses. |

Statistical non-inferiority/equivalence, universally required structural context, universal zero error, total savings over Structural across models, monetary savings and external/open-web validity remain unsupported.

Post-cohort interpretation is reproducible with `python3 evals/analysis/paper-replication-model2-v1.py` under the pinned Node environment. It uses the frozen statistical implementation and does not rerun trials or write parent artifacts. The final verification artifact records all checks and the matched initial-prompt audit. Raw JSONL and source archives are retained locally under `evals/results/`, which follows the repository ignore policy.
