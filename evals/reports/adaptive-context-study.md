# Adaptive Context Expansion Study

## Outcome and scope

Frozen pilot: **144/144 runs**, 12 tasks × 3 repeats × four variants; sidecar status
`incomplete`. All outcomes, including failures, are retained. No extension or failed-run
rerun was performed.

Adaptive success: **91.7%**; structural: **97.2%**; local: **66.7%**. Adaptive estimated
target-representation savings versus structural: **37.8%** across all observations and
**36.7%** on initial observations.

The original runner marked its sidecar incomplete after an endpoint failure:
`Endpoint failure: Eval decision model connection failed; no action executed.`. All 144
planned cells nonetheless have summaries because dispatch had already completed. Exit
status was 1. No cells were resumed or rerun and the sidecar was not rewritten. Provider
health is **not clean**, so this is a fully populated pilot with infrastructure
contamination, not a clean confirmation of reliability equivalence.

## Method and deterministic ambiguity detector

All eligible indexed candidates start compact. Within each operation, format the actual
candidate descriptions with a constant empty index, collapse whitespace, and trim.
Preserve casing, existing value fields, and existing truncation. Two or more identical
normalized descriptions form a collision group. Promote only the colliding candidates to
role, then local semantic context, then structural context, checking the mixed candidate
descriptions again after each expansion. Stop at uniqueness or report unresolved
structural collisions. IDs do not count as semantic evidence. Decisions never depend on
the goal, oracle, model, embeddings, or benchmark outcomes.

Formats reuse the historical formatter: compact = name; role = role + name; local =
role + nearest semantic-container text (80 characters); structural = role + container
type + nearby text (120 characters) + section heading (48 characters, omitted if
duplicated). The unchanged extractor bounds ancestry to six levels and traversal to 200
text nodes. Structural is the existing richer format rather than a new cumulative
string.

Hidden/disabled candidates remain excluded by the existing snapshot. No eligibility
filter, browser behavior, executor, agent loop, stale handling, validation, retries,
success evaluator or production CLI/MCP default was changed. `indexed-adaptive` is an
additional eval treatment.

Each adaptive observation persists initial/final level, candidate count, fixed-level
collision booleans/counts/groups, actual per-candidate levels, structural use,
unresolved groups, characters and estimated tokens. Fixed-level diagnostics are
counterfactual descriptions over the entire eligible set; per-candidate levels record
actual expansion. Final observation level is the maximum used level. Audit metadata and
representation names are removed from model requests.

## Cohort design

Nine mechanism tasks reuse historical fixtures, goals and oracle semantics under new
task IDs. Three new unique-target fixtures reuse the historical support script and
feedback convention. Tasks and target positions were fixed before any model calls. The
set deliberately includes all three known nested/section cases and is not a held-out
generalization benchmark.

| Task         | Goal                                            | Predefined mechanism                     |
| ------------ | ----------------------------------------------- | ---------------------------------------- |
| adaptive-001 | Delete Item B.                                  | local: item rows                         |
| adaptive-005 | Delete the order numbered 408.                  | local: order numbers                     |
| adaptive-007 | Delete the Draft entry in Team Beta.            | structural: nested Draft/team            |
| adaptive-008 | Delete the visible Archive item.                | hidden duplicate + eligible distractor   |
| adaptive-009 | Submit the enabled Renewal form.                | disabled duplicate + eligible distractor |
| adaptive-012 | Continue the account in the West region.        | structural: Account/region               |
| adaptive-013 | Use the Open link, rather than the Open button. | role: Open link vs button                |
| adaptive-015 | Open the Atlas East project link.               | local: similar Atlas entities            |
| adaptive-016 | Submit the Personal invoice form.               | structural: Invoice/legend               |
| adaptive-101 | Save profile.                                   | unique button                            |
| adaptive-102 | Open dashboard.                                 | unique link                              |
| adaptive-103 | Export report.                                  | unique button                            |

## Frozen controls and integrity

| Control                    | Value                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------ |
| Model                      | `glm-5.3-flash`; temperature 0; top_p 1; max_tokens 8192; provider-default reasoning |
| Browser / Node             | `Chrome/153.0.8010.12` / `v22.23.2`                                                  |
| Viewport / concurrency     | 1120 × 780 / 4                                                                       |
| Per-run budgets            | 8 executed actions; 240 s; 2 HTTP retries; 5 stale retries                           |
| Observation / feedback     | action-representation; observed modal policy; status-only indexed page text          |
| Frozen at                  | `2026-09-30T15:49:55.725Z`                                                           |
| Task file SHA-256          | `ebff6c64314e02d5c21eb5d68f7417f81de678c81e5f29155ab0621562404849`                   |
| Config file SHA-256        | `9aabdd75d3660e5858603fcd7b0228d0c9ccea57eb5e78dc1213343554973f59`                   |
| Source SHA-256             | `f840b3888ad4648ade281a5996c858dcbc57844737e1dd2d13eb96f51671eed1`                   |
| Fixture tree SHA-256       | `c749b42f76633c937d420ea4f0f8e003a7deb63c6d0bc9fabf519e3151079ddf`                   |
| System prompt SHA-256      | `c40b40cd952a0540cc616ac6b491b9e5ee11f84ac6f614cc55585ac116ae9fa4`                   |
| Task prompt format SHA-256 | `92c06502d1024435f95f8709fa636a5beefe0b5b390832bc7db113c28ab50108`                   |
| Runner control SHA-256     | `9b8e35e8c76e324eba02f50a288c31a4bfc20b72e2b0a961a2cf118141d77f48`                   |
| Source archive SHA-256     | `95f4f4f476b03eb1afeb87f043d9d2e16717780a1b3a41324c0cdf63419dccf0`                   |

Full settings and historical hashes are in
`evals/cohorts/ambiguity-adaptive-v1.freeze.json`; the run plan and every planned cell
are in the JSONL sidecar. Source archive:
`evals/results/ambiguity-adaptive-v1-source.tar.gz`.

Environment drift: Node and Chrome match the previous cohort exactly. 15 production
source files were compared byte-for-byte against the historical archive; differing
files: []. Source hash changes reflect eval implementation/schema/integration. Fixture
hash changes reflect three new easy fixtures; all 17 historical ambiguity-study
fixtures/support files are unchanged. The aggregate call ceiling is 1500 for 144 planned
runs versus the historical 6000 for 800; per-run budgets are identical.

Integrity: 144 unique run IDs, 289 step records, 0 duplicate cells, 0 missing cells, 0
unplanned cells, 0 orphan step run IDs, 1 control set(s). Returned-model drift: [].
Historical file hashes unchanged: **True**. Policy/fixture/task/source hashes were
checked after completion against the freeze.

## Overall reliability versus context cost

| Variant      |       Success |  Wrong Target | Avg Rep Tokens / Obs | Avg Calls |
| ------------ | ------------: | ------------: | -------------------: | --------: |
| local        | 66.7% (24/36) | 29.7% (11/37) |                32.62 |      2.36 |
| structural   | 97.2% (35/36) |   0.0% (0/36) |                51.71 |      2.00 |
| adaptive     | 91.7% (33/36) |   0.0% (0/34) |                32.16 |      1.97 |
| raw-selector | 83.3% (30/36) |   0.0% (0/33) |               173.61 |      1.97 |

| Variant      | Correct Target | First Correct / Run | Semantic Ambiguity Failure | Invalid Action | Invalid Output Runs | Avg Steps | Avg Latency (s) |
| ------------ | -------------: | ------------------: | -------------------------: | -------------: | ------------------: | --------: | --------------: |
| local        |  70.3% (26/37) |               69.4% |                      16.7% |           0.0% |                8.3% |      1.17 |           63.32 |
| structural   | 100.0% (36/36) |              100.0% |                       0.0% |           0.0% |                2.8% |      1.00 |           32.15 |
| adaptive     | 100.0% (34/34) |               94.4% |                       0.0% |           0.0% |                5.6% |      0.94 |           33.46 |
| raw-selector | 100.0% (33/33) |               91.7% |                       0.0% |           8.3% |                5.6% |      0.92 |           43.06 |

Correct target rate is conditional on scored accepted selections; first-correct rate
counts all runs, including those failing before acceptance. Wrong Target counts executed
wrong inputs / audited executed inputs. Semantic ambiguity failures use the unchanged
summary taxonomy, which prioritizes a known wrong click over later errors. Invalid
Action counts invalid choices / action attempts; malformed probability heads appear
separately as invalid output runs. Steps, calls and latency average all completed runs,
including failures.

| Variant      | Initial Rep Tokens | Total Rep Tokens | Tokens / Success incl. Failures | Tokens / Success, Successful Runs Only | Observations | HTTP Retries |
| ------------ | -----------------: | ---------------: | ------------------------------: | -------------------------------------: | -----------: | -----------: |
| local        |              36.75 |             2544 |                          106.00 |                                  57.88 |           78 |            7 |
| structural   |              62.92 |             3723 |                          106.37 |                                 102.69 |           72 |            0 |
| adaptive     |              39.83 |             2251 |                           68.21 |                                  63.79 |           70 |            1 |
| raw-selector |             173.75 |            11979 |                          399.30 |                                 357.07 |           69 |            2 |

| Variant      | Any Wrong-Target Run | Oracle Attainment, Supplemental |
| ------------ | -------------------: | ------------------------------: |
| local        |                16.7% |                           69.4% |
| structural   |                 0.0% |                          100.0% |
| adaptive     |                 0.0% |                           94.4% |
| raw-selector |                 0.0% |                           91.7% |

Oracle attainment is supplemental: checks pass with zero wrong inputs and mutations,
even when a subsequent request failed. It does not replace task success or exclude
failures.

Representation tokens are ceil(UTF-8 bytes / 4), including target-map serialization;
raw-selector also includes public DOM. These are estimated representation costs, not
model-tokenizer or billable savings. One observation is one policy request, including
terminal/failed requests; HTTP retransmissions count as calls but do not create a new
observation. Initial observations control candidate-set differences caused by later
actions.

## Per-task results

Cells show successful runs / completed runs; parentheses give total wrong executed
inputs. All tasks were planned for three repeats per arm.

| Task         |         Local |    Structural |      Adaptive | Raw reference | Adaptive Initial Level |
| ------------ | ------------: | ------------: | ------------: | ------------: | ---------------------- |
| adaptive-001 | 3/3 (0 wrong) | 3/3 (0 wrong) | 3/3 (0 wrong) | 3/3 (0 wrong) | local: 3               |
| adaptive-005 | 2/3 (0 wrong) | 3/3 (0 wrong) | 3/3 (0 wrong) | 3/3 (0 wrong) | local: 3               |
| adaptive-007 | 0/3 (4 wrong) | 3/3 (0 wrong) | 2/3 (0 wrong) | 3/3 (0 wrong) | structural: 3          |
| adaptive-008 | 3/3 (0 wrong) | 3/3 (0 wrong) | 2/3 (0 wrong) | 0/3 (0 wrong) | local: 3               |
| adaptive-009 | 3/3 (0 wrong) | 3/3 (0 wrong) | 3/3 (0 wrong) | 1/3 (0 wrong) | local: 3               |
| adaptive-012 | 1/3 (0 wrong) | 2/3 (0 wrong) | 3/3 (0 wrong) | 3/3 (0 wrong) | structural: 3          |
| adaptive-013 | 3/3 (0 wrong) | 3/3 (0 wrong) | 3/3 (0 wrong) | 3/3 (0 wrong) | role: 3                |
| adaptive-015 | 2/3 (0 wrong) | 3/3 (0 wrong) | 2/3 (0 wrong) | 3/3 (0 wrong) | local: 3               |
| adaptive-016 | 0/3 (7 wrong) | 3/3 (0 wrong) | 3/3 (0 wrong) | 3/3 (0 wrong) | structural: 3          |
| adaptive-101 | 3/3 (0 wrong) | 3/3 (0 wrong) | 3/3 (0 wrong) | 3/3 (0 wrong) | compact: 3             |
| adaptive-102 | 2/3 (0 wrong) | 3/3 (0 wrong) | 3/3 (0 wrong) | 3/3 (0 wrong) | compact: 3             |
| adaptive-103 | 2/3 (0 wrong) | 3/3 (0 wrong) | 3/3 (0 wrong) | 2/3 (0 wrong) | compact: 3             |

## Adaptive escalation distribution

| Adaptive Final Level | % Observations | Count | Initial Observations | Candidate Count |
| -------------------- | -------------: | ----: | -------------------: | --------------: |
| compact              |          38.6% |    27 |                    9 |              54 |
| role                 |           4.3% |     3 |                    3 |               6 |
| local                |          32.9% |    23 |                   15 |              55 |
| structural           |          24.3% |    17 |                    9 |              43 |

Resolved observations: 70/70; unresolved: 0. Observations reaching each level
(cumulative): `{"compact": 70, "local": 40, "role": 43, "structural": 17}`. Structural
tasks: adaptive-007, adaptive-012, adaptive-016.

Terminal observations can remain compact or resolve at a cheaper level after a correct
control becomes disabled; the initial-observation column shows the original grounding
difficulty. Candidate counts expose mixed levels rather than implying the whole
observation received the maximum level.

## Hypothesis test

Actual initial prompt hashes are byte-identical between adaptive and local on:
adaptive-001, adaptive-005, adaptive-008, adaptive-009, adaptive-013, adaptive-015. They
are byte-identical between adaptive and structural on: adaptive-007, adaptive-012,
adaptive-016. Representation labels/audit metadata do not enter requests. Repeated
identical prompts can still produce different provider outputs at temperature 0; these
observed differences should not be attributed to extra target information.

Matched adaptive/structural cells: 36 across 12 tasks. Mean task success difference
(adaptive − structural): -5.56 percentage points; paired task-cluster 95% bootstrap
interval: [-16.7, +5.6] percentage points. Any-wrong-target run difference: 0.00 points;
interval: [+0.0, +0.0] percentage points. Bootstrap resamples tasks with all their
matched repeats, 10,000 draws, fixed seed 1735.

Observed context savings: 37.8% averaged over observations and 36.7% initially.
Reliability point estimates and intervals must be read together; three repeats per task
cannot establish a noninferiority margin.

The zero-width wrong-run bootstrap interval reflects all sampled observed differences
being zero. It is not a confidence guarantee of zero future wrong-target risk. With
these sample sizes, zero observed errors does not establish equivalence.

## Adaptive failure analysis and preserved traces

Each adaptive failure has a complete JSON trace under
`evals/reports/adaptive-context-traces/`, including raw output, candidates, collision
audit, accepted/executed actions, summary and oracle evidence. The original JSONL
remains authoritative.

| Task / Repeat | Run ID | Classification | Evidence / Limits | |---|---|---| |
adaptive-015 / 0 | `896f6ecc-c05e-421e-a94b-e70dd66f8cbd` | model output-format failure
| Step 1 before any execution. Missing operation probability keys: BLOCKED, DONE, WAIT.
Final level local, unresolved=False. Existing validator rejected the response; no
evidence of detector causation. | | adaptive-007 / 1 |
`74f23b62-1e3a-402d-a2f8-ad74c8f1fbd2` | model output-format failure | Step 1 before any
execution. Missing target confidence. Final level structural, unresolved=False. Existing
validator rejected the response; no evidence of detector causation. | | adaptive-008 / 2
| `6b43a58f-d6d8-4b99-b071-f378372eea8e` | unrelated infrastructure failure | The first
local-context request selected and executed the correct Archive control. The oracle
confirms Completed: Archive with zero wrong inputs. The compact terminal request then
received no model response across two HTTP attempts; its step lasted 235.3 s until the
240 s task budget aborted it. No unresolved collisions or wrong target. Trace supports a
provider/transport timeout, but cannot identify the remote root cause. The failed run is
retained. |

## Provider health

The original taxonomy is retained. There were 3 endpoint connection-failure summaries
and 5 wall-clock budget exhaustions; a wrong click can take priority over a later
connection/budget error in the summary type. These conditions remain in all reliability,
latency and cost denominators. No infrastructure-adjusted success comparison is
substituted.

| Task / Variant / Repeat          | Run ID                                 | Endpoint Failure                                           |
| -------------------------------- | -------------------------------------- | ---------------------------------------------------------- |
| adaptive-016 / indexed-local / 2 | `9559f09d-4dd6-4ba4-bfd6-5dda056be34a` | Eval decision model connection failed; no action executed. |
| adaptive-103 / indexed-local / 2 | `7e1e38d4-9b85-4282-8d74-ddccf67c0d51` | Eval decision model connection failed; no action executed. |
| adaptive-103 / raw-selector / 2  | `a664492c-2c90-4f2b-af2d-ce578bd482b6` | Eval decision model connection failed; no action executed. |

## Limitations and larger-study decision

Only glm-5.3-flash, these 12 fixture tasks, three repeats and one frozen environment
were tested. Tasks were chosen using mechanism-level historical evidence, so the three
structural cases are deliberately enriched. Hidden/disabled cases retain eligible
distractors and can legitimately require local context. Structural unresolved collisions
are covered in unit tests but not a dedicated live pilot task.

Terminal overhead: 8 accepted DONE observations still received structural target
context; 9 structural observations had no accepted target selection (also includes
rejected responses). These show avoidable target-description cost when termination
requires no target. They are not false collision detections: eligible descriptions
actually collide. The frozen policy intentionally does not use model decisions to select
representation level.

Exact description uniqueness is a syntactic criterion, not proof of goal-relevant
semantic sufficiency. It can stop too early for relationships requiring context even
when descriptions differ, and expand irrelevant distractor groups. Case-sensitive
normalization and current truncation can influence collisions. The extractor still
gathers full public evidence in all representation arms: this study tests prompt
representation cost, not extraction CPU savings.

Post-action candidate changes can affect average costs, hence initial costs are also
reported. Latency includes provider/browser overhead and concurrent scheduling. HTTP
retries and missing provider usage prevent interpreting representation estimates as
actual spend. Raw-selector receives DOM plus a different target interface and remains a
reference arm.

No production-default change or larger cohort was run. The interpretation and proposed
next study below are based on this completed pilot, not changes to the frozen method.

### What the pilot supports

The context-efficiency part of the hypothesis is supported on this task set: adaptive
uses 32.16 versus 51.71 estimated representation tokens per observation (37.8% less),
and 39.83 versus 62.92 initially (36.7% less). Total representation tokens per
successful task, including failed-run overhead, are 68.21 versus 106.37 (35.9% less).
Adaptive uses 8.4% more initial context than local, reserving that extra information for
the three planned structural cases; all-observation averages are close because
trajectories and failures differ.

Adaptive and structural each have zero wrong executed targets and 100% conditional
accepted-target accuracy. Adaptive resolved every observed collision and initially
stopped below structural on 27/36 observations (75%). Local succeeds in 24/36 runs and
executes 11 wrong inputs across six runs; its wrong inputs are confined to the nested
Draft/team and Invoice/legend tasks. Adaptive's three structural tasks are Draft/team,
Account/region and Invoice/legend. No observed adaptive wrong input supports a detector
false-negative finding, but rejected/no-response trials provide no executed target
evidence. No malformed eligible-set collision is observed; eight accepted DONE
observations still receive structural context, showing unnecessary terminal target cost.

### What remains unconfirmed

Adaptive task success is 33/36 (91.7%), below structural's 35/36 (97.2%). The paired
difference is −5.6 percentage points, with a task-cluster bootstrap interval of [−16.7,
+5.6]. This is insufficient to establish structural-level task success or
noninferiority. Adaptive's failures comprise two malformed probability/confidence heads
and one provider/transport timeout after a correct input; none is classified as a proven
detector error. Oracle attainment is 34/36 for adaptive versus 36/36 for structural,
while first accepted correct target per run is 34/36 versus 36/36. These supplemental
measures must not be reported as equal overall task reliability.

The full hypothesis is therefore **promising but not confirmed**: substantial context
savings and the observed grounding tradeoff justify further investigation, while task
completion equivalence is unresolved and provider health contaminated this pilot.
False-positive or false-negative _semantic sufficiency_ beyond these exact-collision
cases cannot be inferred from the absence of observed wrong targets.

### Larger confirmatory study

A new preregistered study is warranted after confirming endpoint stability, with an
explicit success noninferiority margin, sufficient task/repeat coverage and retained
failure denominators. Include held-out relation-dependent and mixed-collision-group
pages and an unresolved-structural case. Keep the v1 method frozen for that
confirmation; any changed detector or output protocol belongs in a separately identified
treatment. Do not adopt adaptive as the production default on this evidence. No larger
cohort was started and no completed failure was retried.
