# External Validation Study

The strongest reproduced finding is reduced representation exposure: Adaptive used 66.8% less estimated representation per task than Structural for GLM and 68.4% less for DeepSeek. Structural's overall grounding advantage was small and uncertain. Adaptive's reliability transfer was mixed: GLM had no wrong-target executions, while DeepSeek had three. Total inference-cost advantage remains unresolved. These conclusions apply to this externally authored demo/component sample, including two live dynamic pages.

## Experimental Setup

Frozen 15 tasks × 3 repeats × 4 unchanged variants × 2 models; **360/360 terminal runs**. Freeze: 2026-10-02T03:59:40.091Z. Models are analyzed separately; no pooled population.

Node 22.23.2; Chrome for Testing 153.0.8010.12; viewport 1120×780; eight executed actions; 240-second task deadline; existing HTTP/stale retries, model settings and prompts unchanged. A passive external target/DOM audit replaces private synthetic fixture annotations only. Frozen legal targets and independent state checks allow valid fill orders; wrong executions remain monotonic.

All effects below average repeats within tasks and bootstrap tasks (2,000 seeded draws, 95% CI). Representation tokens are utf8-bytes-div-4 estimates. Inference tokens are provider receipts including retried attempts. Grounding Success follows the first scored execution definition; no-scored-execution coverage is shown separately.

Percentage-formatted differences in tables are absolute rate differences (percentage points), not relative percentage improvements. Rows for Correct/Wrong Target Rate with fewer matched tasks reflect absent scored attempts; they are conditional descriptive rates, not evidence that omitted runs were correctly grounded.

The frozen design and evaluation rules are in [the protocol](/home/tulipe/projects/prism/evals/cohorts/external-validation-v1.protocol.md), [task definitions](/home/tulipe/projects/prism/evals/tasks/external-validation-v1.json), and [freeze manifest](/home/tulipe/projects/prism/evals/cohorts/external-validation-v1.freeze.json). Requested temperature was 0, top_p 1, output limit 8,192 tokens, and reasoning configuration remained provider default. The cohort made 481 GLM and 538 DeepSeek request attempts; model identities and prompt hashes reconcile to every recorded call. Every request began after the freeze, between 04:00:29 and 04:52:58 UTC on 2 October 2026. No completed failure was rerun, no task was replaced, and no method was patched.

## Environment Characteristics

Thirteen tasks replay original published component/example files byte for byte; two use live external dynamic URLs. This validates transfer to externally authored DOMs/components, not open-web or production-app generalization. DataTables 1.9.4 is deliberately reported as an old-release limitation; Bootstrap compiled examples and jQuery UI 1.14.1 retain their actual layouts, scripts, validation and modal behavior. Source commits, archives, hashes, task URLs and evaluator definitions are frozen.

| Task | Page type | DOM elements / depth, median | Candidates, median | Runs with local collisions | Runtime structure changes |
|---|---|---|---|---|---|
| external-table-search | table/filter | 318.00 / 11.00 | 8.00 | 0/24 | 6 |
| external-table-length | table/pagination | 318.00 / 11.00 | 8.00 | 0/24 | 21 |
| external-table-next | table/pagination | 318.00 / 11.00 | 8.00 | 0/24 | 2 |
| external-multiple-tables | multiple tables | 410.00 / 11.00 | 12.00 | 24/24 | 0 |
| external-column-filter | table/repeated fields | 524.00 / 11.00 | 18.00 | 0/24 | 1 |
| external-album-navigation | cards/navigation | 217.00 / 11.00 | 8.00 | 0/24 | 0 |
| external-billing-name | checkout form/cards | 191.00 / 10.00 | 16.00 | 0/24 | 0 |
| external-billing-address | form/repeated fields | 191.00 / 10.00 | 16.00 | 0/24 | 0 |
| external-signin-fields | sign-in form | 71.00 / 7.00 | 5.00 | 0/24 | 0 |
| external-modal-create | modal/form/edit-save | 83.00 / 6.00 | 8.00 | 0/24 | 58 |
| external-modal-dismiss | modal/overlay | 62.00 / 5.00 | 1.00 | 0/24 | 44 |
| external-accordion | nested sections/list | 41.00 / 5.00 | 4.00 | 0/24 | 23 |
| external-tabs | tabbed sections | 33.00 / 5.00 | 6.00 | 0/24 | 21 |
| external-dynamic-enable | live/delayed dynamic form | 51.00 / 7.00 | 4.00 | 0/24 | 46 |
| external-delayed-content | live/delayed hidden content | 40.00 / 6.00 | 1.00 | 0/24 | 23 |

Candidate, collision, dialog, hidden-element, source-family, goal-length and trajectory records are retained in the external audit JSONL. No known minimum sufficient scope is assigned. DOM structure variation is observational and includes the task's intended changes; it is not automatically a PAGE_STRUCTURE_CHANGE failure.

Source provenance: [DataTables published examples at the frozen commit](https://github.com/DataTables/DataTables/tree/36ba2549ad48f6d56d8e5eb71e5f3f272d6da98b), [Bootstrap compiled examples at the frozen commit](https://github.com/twbs/bootstrap/tree/87d080b9b89bac4ed7d3bb99006c1fc2c073cb6e/docs/5.3/examples), and [jQuery UI 1.14.1 demos](https://github.com/jquery/jquery-ui/tree/1.14.1/demos). The live URLs are [Dynamic Controls](https://the-internet.herokuapp.com/dynamic_controls) and [Dynamic Loading, example 1](https://the-internet.herokuapp.com/dynamic_loading/1). The source archive contains the actual replay files and live reference HTML under `.scratch/external-validation-v1/sources`; the live manifest's older `evals/results/...-sources/live` path is a provenance-path limitation, not the location used by the runner. Hashes and archive contents identify the preserved files without changing the frozen manifest.

Property definitions matter. Candidate counts refer to offered actions, not every human-operable DOM element. Duplicate role/name pairs are normalized formatter descriptors, which can also include state/value, rather than a complete accessible-tree census. Structure changes compare tag/role sequences; they do not capture every attribute, visibility or text change. Disabled controls can be visible and correctly absent from offered actions. The derived diagnostics therefore separate disabled omissions from enabled omissions. The 24 runs per task comprise three repeats of four variants in each of two independently analyzed models; the environment table is descriptive, not a pooled model outcome analysis.

## RQ1 — Representation Scope and Grounding

| Model | Contrast | Grounding difference, 95% CI | Strict success difference, 95% CI | Matched tasks |
|---|---|---|---|---|
| glm-5.3-flash | structural-minus-local | 2.2% [-13.3%, 15.6%] | 6.7% [-13.3%, 26.7%] | 15 |
| glm-5.3-flash | structural-minus-local-collisions | 0.0% [0.0%, 0.0%] | 0.0% [0.0%, 0.0%] | 1 |
| deepseek-v4.1-flash | structural-minus-local | 2.2% [-6.7%, 11.1%] | -6.7% [-20.0%, 4.4%] | 15 |
| deepseek-v4.1-flash | structural-minus-local-collisions | 33.3% [33.3%, 33.3%] | 0.0% [0.0%, 0.0%] | 1 |

The collision subgroup uses observed descriptor collisions, potentially including distractors, not task-required structural ground truth. Per-task outcomes and focal-control coverage must be checked alongside aggregate effects. A no-attempt run lowers the planned Grounding Success endpoint but does not establish a wrong semantic target.

**Answer:** scope effects transfer weakly in the overall endpoint, but the earlier strong structural-ambiguity effect is not established here. Structural exceeded Local by only one grounding-success run out of 45 in each model. Both task-bootstrap confidence intervals include zero. Source-family sensitivity also spans zero: approximately −4.6 to +7.5 percentage points in each separately analyzed model.

Only `external-multiple-tables` had recorded local-descriptor collisions. Local and Structural each achieved 0/3 grounding successes for GLM; DeepSeek achieved 0/3 and 1/3, respectively. Strict success was 0/3 for both scope variants in both models. The subgroup interval based on this single task is degenerate and cannot establish replication beyond that task. The unchanged Structural extractor still rendered the two search controls with identical generic container/context descriptions; reaching a wider level did not reveal their table identity. This is direct distribution-shift evidence about the existing representation, not a reason to change it during validation.

Easy-table and ordinary-field tasks did show useful grounding with Local. That does not establish that Local was minimally sufficient: no external minimum-scope ground truth exists, and differences in output/termination behavior also affect the endpoint.

### glm-5.3-flash

| Task | Local grounding / strict | Structural grounding / strict | Adaptive grounding / strict | Selector grounding / strict |
|---|---|---|---|---|
| external-table-search | 2/3 / 2/3 | 3/3 / 3/3 | 3/3 / 3/3 | 3/3 / 3/3 |
| external-table-length | 2/3 / 1/3 | 3/3 / 3/3 | 3/3 / 2/3 | 1/3 / 1/3 |
| external-table-next | 3/3 / 0/3 | 3/3 / 3/3 | 3/3 / 3/3 | 3/3 / 3/3 |
| external-multiple-tables | 0/3 / 0/3 | 0/3 / 0/3 | 0/3 / 0/3 | 3/3 / 0/3 |
| external-column-filter | 3/3 / 3/3 | 2/3 / 2/3 | 3/3 / 2/3 | 2/3 / 1/3 |
| external-album-navigation | 3/3 / 2/3 | 2/3 / 1/3 | 2/3 / 2/3 | 2/3 / 2/3 |
| external-billing-name | 2/3 / 0/3 | 3/3 / 1/3 | 3/3 / 3/3 | 2/3 / 2/3 |
| external-billing-address | 3/3 / 3/3 | 2/3 / 2/3 | 3/3 / 3/3 | 1/3 / 1/3 |
| external-signin-fields | 3/3 / 0/3 | 3/3 / 0/3 | 3/3 / 0/3 | 3/3 / 0/3 |
| external-modal-create | 2/3 / 0/3 | 3/3 / 0/3 | 3/3 / 0/3 | 3/3 / 0/3 |
| external-modal-dismiss | 2/3 / 2/3 | 1/3 / 1/3 | 2/3 / 2/3 | 3/3 / 3/3 |
| external-accordion | 2/3 / 2/3 | 3/3 / 3/3 | 3/3 / 3/3 | 3/3 / 3/3 |
| external-tabs | 0/3 / 0/3 | 0/3 / 0/3 | 1/3 / 0/3 | 3/3 / 3/3 |
| external-dynamic-enable | 3/3 / 3/3 | 2/3 / 2/3 | 3/3 / 0/3 | 3/3 / 2/3 |
| external-delayed-content | 2/3 / 2/3 | 3/3 / 2/3 | 3/3 / 1/3 | 3/3 / 3/3 |

### deepseek-v4.1-flash

| Task | Local grounding / strict | Structural grounding / strict | Adaptive grounding / strict | Selector grounding / strict |
|---|---|---|---|---|
| external-table-search | 3/3 / 3/3 | 2/3 / 2/3 | 2/3 / 2/3 | 3/3 / 3/3 |
| external-table-length | 3/3 / 3/3 | 3/3 / 3/3 | 3/3 / 2/3 | 3/3 / 3/3 |
| external-table-next | 2/3 / 2/3 | 3/3 / 2/3 | 3/3 / 3/3 | 3/3 / 2/3 |
| external-multiple-tables | 0/3 / 0/3 | 1/3 / 0/3 | 0/3 / 0/3 | 3/3 / 2/3 |
| external-column-filter | 3/3 / 2/3 | 3/3 / 3/3 | 3/3 / 3/3 | 3/3 / 1/3 |
| external-album-navigation | 3/3 / 2/3 | 3/3 / 2/3 | 3/3 / 2/3 | 3/3 / 3/3 |
| external-billing-name | 3/3 / 0/3 | 3/3 / 1/3 | 3/3 / 1/3 | 3/3 / 3/3 |
| external-billing-address | 3/3 / 2/3 | 2/3 / 0/3 | 3/3 / 3/3 | 3/3 / 3/3 |
| external-signin-fields | 3/3 / 0/3 | 3/3 / 0/3 | 1/3 / 0/3 | 3/3 / 0/3 |
| external-modal-create | 2/3 / 0/3 | 3/3 / 0/3 | 2/3 / 0/3 | 3/3 / 0/3 |
| external-modal-dismiss | 3/3 / 3/3 | 3/3 / 3/3 | 3/3 / 3/3 | 3/3 / 3/3 |
| external-accordion | 3/3 / 3/3 | 3/3 / 3/3 | 3/3 / 3/3 | 3/3 / 3/3 |
| external-tabs | 0/3 / 2/3 | 0/3 / 1/3 | 1/3 / 1/3 | 3/3 / 3/3 |
| external-dynamic-enable | 3/3 / 3/3 | 3/3 / 2/3 | 3/3 / 2/3 | 3/3 / 3/3 |
| external-delayed-content | 3/3 / 2/3 | 3/3 / 2/3 | 3/3 / 2/3 | 3/3 / 3/3 |

## RQ2 — Adaptive Context Expansion

| Model | Metric | Adaptive minus Structural, 95% CI | Matched tasks |
|---|---|---|---|
| glm-5.3-flash | Grounding Success | 11.1% [4.4%, 20.0%] | 15 |
| glm-5.3-flash | Strict Task Success | 2.2% [-13.3%, 15.6%] | 15 |
| glm-5.3-flash | Correct Target Rate | 0.0% [0.0%, 0.0%] | 13 |
| glm-5.3-flash | Wrong Target Rate | 0.0% [0.0%, 0.0%] | 13 |
| glm-5.3-flash | Invalid Action Rate | 2.4% [0.0%, 7.1%] | 14 |
| glm-5.3-flash | Representation / observation | -149.26 [-241.79, -70.50] | 15 |
| glm-5.3-flash | Representation / task | -343.16 [-548.82, -172.16] | 15 |
| glm-5.3-flash | Input tokens | -174.06 [-398.36, 84.38] | 15 |
| glm-5.3-flash | Output tokens | 861.81 [-172.84, 1,986.60] | 15 |
| glm-5.3-flash | Total inference tokens | 687.76 [-435.51, 1,844.53] | 15 |
| glm-5.3-flash | LLM calls | 0.38 [0.09, 0.69] | 15 |
| glm-5.3-flash | Retries | 0.04 [0.00, 0.11] | 15 |
| glm-5.3-flash | Latency ms | 20,613.67 [4,824.87, 39,086.75] | 15 |
| glm-5.3-flash | Executed steps | 0.36 [0.07, 0.67] | 15 |
| glm-5.3-flash | Stale events | 0.00 [0.00, 0.00] | 15 |
| glm-5.3-flash | Invalid selectors | 0.00 [0.00, 0.00] | 15 |
| deepseek-v4.1-flash | Grounding Success | -4.4% [-17.8%, 6.7%] | 15 |
| deepseek-v4.1-flash | Strict Task Success | 6.7% [-4.4%, 22.2%] | 15 |
| deepseek-v4.1-flash | Correct Target Rate | -2.0% [-4.8%, 0.0%] | 14 |
| deepseek-v4.1-flash | Wrong Target Rate | 2.0% [0.0%, 4.8%] | 14 |
| deepseek-v4.1-flash | Invalid Action Rate | 1.1% [0.0%, 3.3%] | 15 |
| deepseek-v4.1-flash | Representation / observation | -155.26 [-246.98, -77.47] | 15 |
| deepseek-v4.1-flash | Representation / task | -390.07 [-564.42, -241.93] | 15 |
| deepseek-v4.1-flash | Input tokens | -488.53 [-870.67, -95.16] | 15 |
| deepseek-v4.1-flash | Output tokens | -277.16 [-1,540.40, 962.02] | 15 |
| deepseek-v4.1-flash | Total inference tokens | -765.69 [-2,365.91, 699.67] | 15 |
| deepseek-v4.1-flash | LLM calls | -0.07 [-0.56, 0.49] | 15 |
| deepseek-v4.1-flash | Retries | 0.00 [0.00, 0.00] | 15 |
| deepseek-v4.1-flash | Latency ms | -2,748.91 [-11,061.97, 5,533.78] | 15 |
| deepseek-v4.1-flash | Executed steps | -0.07 [-0.56, 0.49] | 15 |
| deepseek-v4.1-flash | Stale events | 0.00 [0.00, 0.00] | 15 |
| deepseek-v4.1-flash | Invalid selectors | 0.00 [0.00, 0.00] | 15 |

| Model | Adaptive runs with observation | Reached Structural | Max level distribution | Mean expansions per observation |
|---|---|---|---|---|
| glm-5.3-flash | 45/45 | 3/45 | {'compact': 42, 'structural': 3} | 0.07 |
| deepseek-v4.1-flash | 45/45 | 3/45 | {'compact': 42, 'structural': 3} | 0.09 |

Expansion paths and reasons are retained for every adaptive observation, including candidate-level collisions and unresolved groups. Avoiding Structural is not itself proof that sufficient context was exposed. Savings here describe representation estimates; a lower exposure estimate does not guarantee lower full inference usage. No statistical noninferiority claim is made.

**Answer:** representation savings reproduced in both models; preservation of reliable grounding was only partly reproduced. GLM's Adaptive/Structural grounding rates were 38/45 versus 33/45, with zero wrong executions in either arm. DeepSeek's were 36/45 versus 38/45, with three versus two wrong executions. Their strict task-success rates were 24/45 versus 23/45 for GLM and 27/45 versus 24/45 for DeepSeek. The DeepSeek grounding gap is compatible with both loss and improvement, and the sample cannot establish a reliability margin.

Adaptive reached Structural in 3/45 runs per model (6.7%), all on the repeated-table task. All six runs retained unresolved structural collision groups. The other 42/45 runs per model stayed at Compact. Initial expansion behavior was the same across models; observed expansion counts differ because their trajectories differ. This cohort barely exercises Role or Local as final adaptive levels, limiting conclusions about intermediate escalation. Compact-only dynamic runs still made wrong selections, so absence of descriptor collisions is not evidence of adequate task/state context.

Mean estimated representation per task was 170.73 versus 513.89 tokens for GLM and 180.62 versus 570.69 for DeepSeek. These are 66.8% and 68.4% reductions in the task-mean estimates. GLM's total-inference contrast was +687.76 tokens [−435.51, +1,844.53], based on 41/45 matched repeats with complete receipts across all 15 tasks. DeepSeek's was −765.69 [−2,365.91, +699.67], based on all 45 matched repeats. Neither establishes end-to-end savings. GLM's Adaptive also made more calls and had higher latency; lower representation cost did not translate automatically into lower runtime cost.

All 90 adaptive runs have [derived run-level traces](/home/tulipe/projects/prism/evals/reports/external-validation-v1-adaptive-traces.json), with final and maximum level, paths, expansion counts, reasons, candidate assignments, collisions and unresolved groups. These derive from frozen raw observation metadata; expansion paths describe formatting levels within an observation, not additional LLM calls.

## RQ3 — Real-World Failure Analysis

### glm-5.3-flash

Failure domains: {'model_behavior': 60, 'unresolved': 20, 'grounding': 6}. External/prior labels: {'MODEL_OUTPUT_ERROR': 60, 'BUDGET_EXCEEDED': 10, 'SELECTOR_FAILURE': 5, 'DECISION_ERROR': 9, 'ACTION_GROUNDING_ERROR': 1, 'UNKNOWN': 1}.

Grounding scored-execution coverage: 142/180 runs. Visible task-relevant controls omitted from offered actions appeared in 34 runs. Runs with at least one stale event: 0. Runs with invalid selectors: 5. Wrong-target executions: 1.

- `d0ef0bf7-27e0-4297-822d-347b953f06eb`: external-table-length / raw-selector-reference — model_behavior/MODEL_OUTPUT_ERROR; Invalid TypeSafe response; no action executed.
- `3e9d033d-30e7-4e42-8001-407ba8a87e7b`: external-table-length / indexed-local — model_behavior/MODEL_OUTPUT_ERROR; Invalid TypeSafe response; no action executed.
- `9c3fd4db-a80c-479e-a8b2-0601e9479a55`: external-table-next / indexed-local — model_behavior/MODEL_OUTPUT_ERROR; Invalid TypeSafe response; no action executed.
- `8b85d3bf-d883-48b5-997b-5c22839e61ef`: external-multiple-tables / indexed-local — model_behavior/MODEL_OUTPUT_ERROR; Missing model content; no action executed.
- `abc6ebc1-62b8-468a-928e-631b7e6729db`: external-multiple-tables / indexed-structural — model_behavior/MODEL_OUTPUT_ERROR; Missing model content; no action executed.
- `7f5059f2-1556-4775-94db-f348259d1e94`: external-column-filter / raw-selector-reference — model_behavior/MODEL_OUTPUT_ERROR; Invalid TypeSafe response; no action executed.
- `51786d8f-2726-42ad-b56c-ec3f77c0d6ed`: external-multiple-tables / indexed-adaptive — model_behavior/MODEL_OUTPUT_ERROR; Missing model content; no action executed.
- `6e5086b7-a236-46a4-9112-ba3eb918ce0b`: external-column-filter / indexed-adaptive — model_behavior/MODEL_OUTPUT_ERROR; Missing model content; no action executed.

### deepseek-v4.1-flash

Failure domains: {'model_behavior': 45, 'grounding': 13, 'unresolved': 9}. External/prior labels: {'MODEL_OUTPUT_ERROR': 45, 'ACTION_GROUNDING_ERROR': 7, 'DECISION_ERROR': 7, 'SELECTOR_FAILURE': 6, 'UNKNOWN': 2}.

Grounding scored-execution coverage: 161/180 runs. Visible task-relevant controls omitted from offered actions appeared in 34 runs. Runs with at least one stale event: 0. Runs with invalid selectors: 6. Wrong-target executions: 7.

- `6a660dc7-866a-4024-835c-a6e06abee966`: external-multiple-tables / raw-selector-reference — model_behavior/MODEL_OUTPUT_ERROR; Invalid model JSON; no action executed.
- `6e54b165-9c05-4264-bf0e-a5f7c9989947`: external-multiple-tables / indexed-local — model_behavior/MODEL_OUTPUT_ERROR; Invalid model JSON; no action executed.
- `83c34e13-e94a-4338-880c-d157eb82f404`: external-multiple-tables / indexed-structural — grounding/ACTION_GROUNDING_ERROR; The model reported DONE.
- `81506d8b-453b-4513-87d3-717ef64727cc`: external-multiple-tables / indexed-adaptive — model_behavior/MODEL_OUTPUT_ERROR; Invalid TypeSafe response; no action executed.
- `6917b408-af8e-4465-ab49-ecb8b3d699eb`: external-column-filter / raw-selector-reference — model_behavior/MODEL_OUTPUT_ERROR; Invalid TypeSafe response; no action executed.
- `c5478918-51ab-469f-95aa-e15fe9d97652`: external-billing-name / indexed-adaptive — model_behavior/MODEL_OUTPUT_ERROR; Invalid TypeSafe response; no action executed.
- `5cd849c1-0845-49b4-a9b2-0dc80920e5f5`: external-billing-name / indexed-local — model_behavior/MODEL_OUTPUT_ERROR; Invalid TypeSafe response; no action executed.
- `6d0bb0a3-db35-42e4-8a7b-aee6f38c8da0`: external-billing-name / indexed-structural — model_behavior/MODEL_OUTPUT_ERROR; Invalid TypeSafe response; no action executed.

Semantic Ambiguity Failure Rate is **unknown as a primary causal rate**: these tasks have no known minimum context ground truth. The analysis artifact retains a secondary flag for wrong selections co-occurring with observed local collisions; co-occurrence does not prove that ambiguity caused the failure. Dynamic mismatch, hidden elements, page structure changes and modal interference are not automatically labeled from task type. Unseen/unsupported categories remain unestablished, not zero-risk.

**Answer:** realistic pages exposed capability boundaries, asynchronous initialization and dynamic distractors that controlled target fixtures did not adequately test. The following are post-execution descriptive case analyses; frozen success flags, failure labels and denominators remain unchanged.

- **Action-space boundary in forms and dialogs.** Both sign-in and modal-create tasks had 0/12 strict successes per model across variants. The existing snapshot eligibility rule excludes password inputs. Visible, enabled password controls were repeatedly omitted; selector-reference runs that attempted the correct password selector failed as `ineligible`. Example `62a5e8f1-ca3f-4be7-a475-e88a877994e3` correctly opened the modal and filled name/email, then failed on `#password`. This is not evidence that structural context would resolve a semantic ambiguity. The raw `SELECTOR_FAILURE` label describes execution validation; its demonstrated mechanism here is eligibility. No extractor change was made.
- **Initialization before useful observations.** All modal-create, modal-dismiss and accordion runs in each model began with zero offered candidates; tabs did so in 11/12 GLM and 12/12 DeepSeek runs. Some models waited and succeeded; others blocked or produced invalid output. Example `1028db77-d92b-4f11-85bc-dd503cefd99e` blocked on an empty adaptive tabs observation, while a selector-reference trial waited and completed. This exposes asynchronous rendering/readiness behavior. It is not automatically a stale-state or network failure.
- **Dynamic distractions and termination.** DeepSeek Adaptive wrong-target runs were repeated tables (`ee7374a3-2665-49f7-8b8a-9ccbc67f017e`), dynamic enable (`a5c75d55-891a-4920-ae68-78dd2f03a209`), and delayed content (`f6c99076-9415-4ff6-8ec5-bf9a8071f946`). The delayed-content run clicked Start correctly, later clicked the unrelated Elemental Selenium link, and exhausted the eight-action budget despite the final Hello World state passing. The dynamic-enable run eventually filled the correct field and reported DONE, but its earlier wrong click kept strict success false. These failures show why first-target grounding and final task state must be reported alongside whole-trajectory wrong executions.
- **Output and termination behavior remains substantial.** Terminal output failures occurred in 60/180 GLM and 45/180 DeepSeek runs. A length-limited response was present in 23 of those GLM runs and 16 DeepSeek runs; the rest were not established as truncation failures. Invalid JSON, missing content and probability-head validation must not all be counted as semantic grounding errors. Grounding scored-execution coverage was 142/180 and 161/180; absence of an attempted scored target makes failure attribution uncertain.
- **Environment and transport uncertainty.** The retained setup/preflight log records live-page availability/readiness trouble before freezing. No terminal run received a confirmed external network-dependency label during the cohort. Twenty GLM request attempts returned no completed HTTP status/usage receipt in 11 runs; task deadlines and aborts can contribute, and their cause is not established as a page-network failure. Usage is unknown for those runs, never imputed as zero. Provider receipts were complete for 169/180 GLM and 180/180 DeepSeek runs.

The frozen external taxonomy includes `DYNAMIC_STATE_MISMATCH`, `STALE_BROWSER_STATE`, `PAGE_STRUCTURE_CHANGE`, `HIDDEN_ELEMENT`, `MODAL_INTERFERENCE`, `NETWORK_DEPENDENCY`, `AUTHENTICATION_BLOCK`, and `TASK_UNDEFINED`. No causal incidence is established for categories lacking decisive evidence. Password eligibility, empty initialization and later distractor selection are described as mechanisms/coverage limitations; their raw labels are retained. Hidden-element counts or intended rerenders alone do not prove an external failure category. Authenticated workflows were not sampled. Stale events were not observed, so this cohort offers little evidence about stale recovery or modal occlusion failures.

## Cross-Model Comparison

| Model | Local grounding / strict | Structural grounding / strict | Adaptive grounding / strict | Selector grounding / strict |
|---|---|---|---|---|
| glm-5.3-flash | 71.1% / 44.4% | 73.3% / 51.1% | 84.4% / 53.3% | 84.4% / 60.0% |
| deepseek-v4.1-flash | 82.2% / 60.0% | 84.4% / 53.3% | 80.0% / 60.0% | 100.0% / 77.8% |

Each row is a separate model population. Source-family sensitivity intervals and all per-task contrasts are in the analysis JSON. Differences in output/termination behavior are separated from target selection and external environment failure.

The model-robust result is representation savings and selective escalation, not a uniform success ranking. GLM's adaptive grounding was higher than Structural; DeepSeek's was lower, while strict task-success differences favored Adaptive in both models with intervals spanning zero. Raw-selector-reference had more information exposure, so its higher success—particularly on tabs and repeated tables—does not establish an equal-cost representation comparison. Both models were prevented from completing the password-dependent workflows by the unchanged action-space restriction.

Enabled, visible task controls were omitted in 23 GLM runs and 22 DeepSeek runs, confined to the password-dependent tasks. The broader counts of 34 per model also include visible disabled fields on Dynamic Controls; those disabled omissions are expected eligibility behavior and are not counted as capability failures in the case analysis.

## Threats to Validity

- Convenience sample of 15 tasks across four source families; shared page/library templates induce correlation beyond tasks. Task-bootstrap intervals cannot establish population-level open-web validity.
- Most tasks are locally replayed published demos; there are no authenticated production workflows, transactional orders or broad app coverage. The old DataTables release and short/eight-action trajectories limit modern-DOM and long-horizon claims.
- Network instability in live pages can prevent any meaningful grounding exposure. Live sources may drift; failures remain in the planned cohort. No failed tasks or completed runs are silently replaced.
- The fixed action extractor can omit human-operable controls. Independent human-control preflight validates task/evaluator state without repairing the extractor or adding capabilities.
- Frozen target-audit selector coverage excludes neutral controls and scores elements rather than text/option arguments. Task state independently catches wrong arguments. Intermediate successes never erase wrong executions.
- Requested temperature/top_p and deterministic schedules do not guarantee provider determinism. Reasoning/output behavior and sample timing affect inference cost; model cohorts are separate and interleaved.
- Passive audit/property/response recording adds timing/resource overhead. Browser behavior, prompts, retry logic and policy are unchanged.
- Representation token estimates are not exact tokenizer counts; only complete provider receipts support full usage estimates. Three repeats and zero-event samples cannot establish noninferiority or zero wrong-target population risk. All-zero task-bootstrap intervals can be degenerate; per-task grounding/strict Wilson intervals are included in the analysis JSON.
- The preset target audit scores exact elements. Indexed tabs sometimes activate a valid ancestor/tab-role control and pass the state oracle without executing the exact scored anchor. Such runs can have strict success without scored Grounding Success; this is measurement coverage, not demonstrated misgrounding. The scoring selectors were not changed after runs began.
- GLM total-token estimates omit runs with incomplete usage; Adaptive/Structural cost contrasts use 41 matched repeats. Deadline/abort missingness can depend on trajectory and representation, so complete-case inference costs do not establish the full cohort's cost effect.

## Claim Ledger

| Claim | GLM | DeepSeek | Limit |
|---|---|---|---|
| Structural improves grounding over Local | Partially supported | Partially supported | These tasks and observed collisions only; see per-task effects |
| Adaptive reduces representation exposure vs Structural | Supported | Supported | Estimated representation cost, not full inference cost |
| Adaptive reduces total inference usage vs Structural | Unknown | Unknown | Complete receipts and matched CI required |
| Adaptive retains the descriptive reliability/context tradeoff | Supported in this sample | Partially supported | GLM has higher grounding and zero wrong executions; DeepSeek has lower grounding and three wrong executions; no noninferiority claim |
| Adaptive has zero wrong-target executions | Supported in this sample | Not supported | 0/45 versus 3/45 adaptive runs; neither establishes population zero-risk |
| Structural expansion reliably resolves external repeated-table collisions | Not supported in this sample | Not supported in this sample | All adaptive structural-reaching runs still had unresolved collision groups; scope alone did not reveal table identity |
| Adaptive has statistically noninferior reliability | Unknown | Unknown | No preregistered noninferiority margin |
| Local is sufficient whenever labels are locally distinguishable | Unknown | Unknown | External minimum sufficient scope is not known |
| Open-web generalization / universal superiority / production readiness | Unknown | Unknown | Outside this sample and study design |

The descriptive reliability/context tradeoff must be assessed from grounding, wrong targets and exposure together. Future work should broaden independent application families, stabilize external deployments without changing this frozen method, evaluate authenticated and longer workflows in a separate study, and preregister reliability margins. Any extractor/policy/browser improvement belongs to a new version, not these results.

Claim upgrades are therefore limited to Adaptive's lower representation exposure and reproducible selective escalation on these external sources. The earlier strong structural-ambiguity benefit, local minimal sufficiency, model-robust near-zero wrong targets, and full inference-cost advantage cannot be upgraded to general external claims. Newly exposed capability/readiness/trajectory limitations identify where synthetic validation was insufficient. A follow-up study should use more independent application families, modern production-like DOMs and feasible authenticated/long workflows, with separate preregistration for any capability or policy changes; this frozen cohort should remain intact.

Integrity: 360 unique planned cells; 226 historical files checked with no drift; 1019 response attempts reconciled to raw run calls and request prompt hashes. Frozen hash verification is performed by the study controls command. Full analysis and result inventories accompany this report.

Final verification: all 1,370 raw step/summary records pass the existing schemas; 120 task/variant/model groups each have exactly three repeats; 90 Adaptive runs have traces; wrong-execution counters reconcile to final evidence; all budgets and model IDs are checked. The unchanged method's 106 tests, including 10 browser integration tests, and all 15 external known-control browser checks passed before freeze. Typecheck, lint and build passed. Final frozen-hash and historical-file checks passed after execution. See [final verification](/home/tulipe/projects/prism/evals/reports/external-validation-v1-final-verification.json), [raw artifact integrity](/home/tulipe/projects/prism/evals/reports/external-validation-v1-integrity.json), [full task-level analysis](/home/tulipe/projects/prism/evals/reports/external-validation-v1-analysis.json), and [descriptive diagnostics](/home/tulipe/projects/prism/evals/reports/external-validation-v1-diagnostics.json). The diagnostics exporter was added after execution for reporting only and is outside the frozen method.

Original method SHA-256: `979167cfc4cf26c422546b356a60a39685b3a2afbbde19865c019bd466b1a9be`. Frozen source archive SHA-256: `b93a72b21cdcc0704283c47aca76ac528587c1b571546ccf17d0e71a9b68abad`. Raw model JSONL, response/audit logs and the source archive remain persisted locally under `evals/results/`; ignore rules for bulky artifacts were left unchanged. Reproduction commands are in [the frozen study README](/home/tulipe/projects/prism/evals/external/README.md); post-execution diagnostics can be reproduced with `python3 evals/analysis/external-validation-v1-diagnostics.py`. Rerunning the frozen analysis regenerates tables and the preregistered ledger; these evidence-based editorial interpretations belong to this final report.
