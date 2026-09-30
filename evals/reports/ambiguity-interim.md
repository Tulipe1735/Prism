# Ambiguity Study — Incomplete Cohort Audit

Offline audit of the interrupted Milestone 3 ambiguity / action-representation study. No
model or API calls were made, no runs were resumed or repeated, no task/prompt/
extractor/formatting files were changed, and no raw result files were modified. All
findings below are recomputed from the persisted artifacts on disk.

Audit inputs:

- `evals/results/ambiguity-initial.jsonl` and `.meta.json` (the study under audit)
- `evals/cohorts/ambiguity-initial.json`, `evals/cohorts/ambiguity-protocol.md`
- `evals/tasks/ambiguity-study.json`
- `evals/fixtures/ambiguity-study/*.html`
- `evals/results/modal-before.jsonl`, `evals/results/modal-after.jsonl`,
  `evals/results/main.jsonl` (delayed-modal diagnosis only)
- `evals/runners/ambiguity-report.ts`, `statistics.ts`, `run.ts`, `cohort.ts`,
  `representation.ts`, `schema.ts`, `success.ts`, `failures.ts` (semantics only)

---

## 1. Cohort status

The current ambiguity/action-representation study is the `ambiguity-initial` cohort.

| Item                  | Value                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------- |
| Result file           | `evals/results/ambiguity-initial.jsonl`                                                  |
| Sidecar plan          | `evals/results/ambiguity-initial.jsonl.meta.json`                                        |
| Cohort config         | `evals/cohorts/ambiguity-initial.json`                                                   |
| Frozen protocol       | `evals/cohorts/ambiguity-protocol.md`                                                    |
| Task file             | `evals/tasks/ambiguity-study.json` (16 tasks, all `category: ambiguity`)                 |
| Frozen source archive | `evals/results/ambiguity-source.tar.gz`                                                  |
| Frozen source hash    | `ccdf08a9cce7d2286d8613cb98058f519fb3c6958a13d009a37b3762f4eb52cd`                       |
| Fixture hash          | `3833559d80aaa99e8e0e5946fc5a3354da114d362ee79ab9b275336576e2f42c`                       |
| Model / settings      | `glm-5.3-flash`, temperature 0, top_p 1, max_tokens 8192, provider-default reasoning     |
| Runtime               | Chrome/153.0.8010.12, viewport 1120x780, fixture port 9841, concurrency 4                |
| Budgets               | 8 executed actions, 2 HTTP retries, 5 stale retries, 240 s wall clock                    |
| Observation           | `action-representation`, `modalPolicy: observed`                                         |
| Variants              | `indexed-compact`, `indexed-role`, `indexed-local`, `indexed-structural`, `raw-selector` |
| Planned design        | 16 tasks x 10 repeats x 5 variants = **800 runs**                                        |
| Persisted completions | **373 summaries** (`completed_runs: 373` in the sidecar)                                 |
| Persisted steps       | 862 step records (1,235 JSONL records total)                                             |
| Sidecar status        | `incomplete`                                                                             |
| Recorded stop reason  | `Endpoint failure: Eval decision model returned HTTP 500; no action executed.`           |

All persisted controls are homogeneous: one experiment id, one cohort hash, one
source/fixture/system/task-prompt hash, one model, one browser version, one `max_steps`.
No step record exists without a matching summary and none vice versa. There are no
duplicate `run_id`s and no duplicate `task/variant/repeat` cells. `stale_events` and
`stale_recoveries` are 0 for every run: the fixtures have `mutateAfterDecision: false`,
so this cohort contains no stale/dynamic-state trajectory by construction.

### The "371 completed runs" claim

The stored data does **not** contain 371 completed runs; it contains **373**. The
sidecar explicitly records `completed_runs: 373`, and all 373 summaries have step
records and terminal statuses (`done` 228, `blocked` 25, `failed` 120).

The number 371 is not present in any manifest, plan, or result file. The closest
reconstruction available from the append order is:

- the one provider-endpoint failure (`d512b4b9...`, HTTP 500) was the **370th** summary
  appended to the file;
- three further summaries were appended after it (two `indexed-role`/`indexed-compact`
  runs on `grounding-study-011` that were already in flight when the stop flag was
  raised, plus one earlier-timed-out run that finished later).

A live progress counter polled around the stop event could therefore have shown any
value from 370 to 373. There is no basis in the data for excluding exactly two runs. If
a strict 371 reporting target is desired, the only defensible candidate is the single
HTTP-500 infrastructural failure, which still leaves 372. This audit treats **373
persisted summaries as the audited completed set**; every completed outcome is intact on
disk and none is lost.

---

## 2. Completion audit and matrix

### Inventory

| Metric                           |                                            Value |
| -------------------------------- | -----------------------------------------------: |
| JSONL records                    |                                            1,235 |
| Step records                     |                                              862 |
| Summary records                  |                                              373 |
| Unique run IDs                   |                                              373 |
| Unique task/variant/repeat cells |                                              373 |
| Duplicate cells                  |                                                0 |
| Unique tasks                     |                                               16 |
| Variants present                 |                                                5 |
| Repeat indices present           | 0, 1, 2, 3 (complete), 4 (partial), 5-9 (absent) |
| Planned runs                     |                                              800 |
| Missing runs                     |                                              427 |

Per-variant completion: compact 75, role 75, raw-selector 75, local 74, structural 74.
Completion is wave-ordered by repeat index: repeats 0-3 are 80/80 each; repeat 4 is
53/80; repeats 5-9 are 0/80 each.

### Completion matrix (completed repeats per task/variant)

| Task                | compact | role | local | structural | raw |
| ------------------- | ------: | ---: | ----: | ---------: | --: |
| grounding-study-001 |       5 |    5 |     5 |          5 |   5 |
| grounding-study-002 |       5 |    5 |     5 |          5 |   5 |
| grounding-study-003 |       5 |    5 |     5 |          5 |   5 |
| grounding-study-004 |       5 |    5 |     5 |          5 |   5 |
| grounding-study-005 |       5 |    5 |     5 |          5 |   5 |
| grounding-study-006 |       5 |    5 |     5 |          5 |   5 |
| grounding-study-007 |       5 |    5 |     5 |          5 |   5 |
| grounding-study-008 |       5 |    5 |     5 |          5 |   5 |
| grounding-study-009 |       5 |    5 |     5 |          5 |   5 |
| grounding-study-010 |       5 |    5 |     5 |          5 |   5 |
| grounding-study-011 |       5 |    5 |     4 |          4 |   5 |
| grounding-study-012 |       4 |    4 |     4 |          4 |   4 |
| grounding-study-013 |       4 |    4 |     4 |          4 |   4 |
| grounding-study-014 |       4 |    4 |     4 |          4 |   4 |
| grounding-study-015 |       4 |    4 |     4 |          4 |   4 |
| grounding-study-016 |       4 |    4 |     4 |          4 |   4 |

- Fully completed cells (all 10 repeats): none. The study stopped inside repeat 4.
- Fully balanced sub-block: all 16 tasks x all 5 variants x repeats 0-3.
- Partially completed cells: every task/variant cell that has 4 or 5 repeats.
- Completely missing cells: all repeats 5-9 for all 16 tasks x 5 variants (400 runs),
  plus 27 repeat-4 cells (`011/local`, `011/structural`, and all five variants of
  `012`-`016`).

Task category is `ambiguity` for all 16 tasks, so there is no category-level contrast
inside this cohort.

---

## 3. Matched-subset methodology

Because the cohort is incomplete, unmatched aggregate success rates are not a fair
comparison: variant completion differs slightly (74-75 runs) and, more importantly,
different tasks have different numbers of repeats. The comparison below uses only units
in which every compared variant shares the same task, repeat index, model, temperature,
browser/environment, task definition, and success oracle.

**Matching rule.** A task-repeat unit is eligible when every variant in the comparison
has a persisted, terminal summary for that exact `(task_id, repetition)`. Units are then
pooled across tasks. Within a unit, model, temperature, environment, prompt format,
budgets, executor, and evaluator are identical by construction (all controls are
verified homogeneous in Section 1). This is a complete-case, unit-matched design, not a
post-hoc weighting of the unbalanced file.

Two useful subsets:

| Subset                     | Tasks   | Repeats | Variants  | Runs | Units |
| -------------------------- | ------- | ------: | --------- | ---: | ----: |
| **M320** (primary)         | all 16  |     0-3 | 5         |  320 |    64 |
| M256 (causal indexed-only) | all 16  |     0-3 | 4 indexed |  256 |    64 |
| **M250** (secondary)       | 001-010 |     0-4 | 5         |  250 |    50 |
| M200 (causal indexed-only) | 001-010 |     0-4 | 4 indexed |  200 |    50 |

M320 is the largest subset in which all five variants are simultaneously matched; M250
is the largest subset that uses the partial repeat-4 data, at the cost of dropping the
six tasks (`011`-`016`) whose repeat 4 is incomplete. Both are reported; the M320 and
M250 conclusions agree in ordering and magnitude.

`raw-selector` is included for reference but is not a causal arm: it receives public
locator DOM and generates CSS selectors, so its costs and its hidden-element failure
mode are not representation-treatment effects.

---

## 4. Interim metrics for the matched subset

### 4.1 Headline table (M320, 64 runs per variant)

Task Success Rate uses the study's strict definition: all checks pass, zero wrong
targets on the monotonic counter, and mutation count matches. Correct Target is the
first accepted, scored target per run (runs with no accepted target count as not
correct); "accepted" is the conditional
`correct_target_selections / scored_target_attempts`. Wrong Target is the share of runs
with at least one wrong executed input (`wrong_target_actions > 0`); the action-level
rate is given in parentheses. Ambiguity Failures are runs labelled `SEMANTIC_AMBIGUITY`.
Rep tokens are the study's `ceil(utf8 bytes / 4)` estimator per observation.

| Variant            | Runs |       Success | Correct Target (first) | Accepted targets |  Wrong Target | Ambiguity Failures | Invalid Actions | Avg Steps | Avg Calls | Avg Retries | Avg Latency | Rep Tokens/obs | First-obs Tokens |
| ------------------ | ---: | ------------: | ---------------------: | ---------------: | ------------: | -----------------: | --------------: | --------: | --------: | ----------: | ----------: | -------------: | ---------------: |
| indexed-compact    |   64 |  14.1% (9/64) |                  14.1% |            20.7% | 59.4% (79.3%) |              59.4% |            0.0% |      2.00 |      3.33 |       0.375 |     167.1 s |           16.9 |             16.6 |
| indexed-role       |   64 | 18.8% (12/64) |                  18.8% |            25.0% | 50.0% (75.0%) |              50.0% |            0.0% |      1.83 |      3.23 |       0.422 |     158.6 s |           24.1 |             25.1 |
| indexed-local      |   64 | 75.0% (48/64) |                  76.6% |            77.8% | 10.9% (22.2%) |              10.9% |            0.0% |      1.05 |      2.14 |       0.109 |      57.2 s |           36.9 |             42.1 |
| indexed-structural |   64 | 90.6% (58/64) |                  92.2% |           100.0% |   0.0% (0.0%) |               0.0% |            1.6% |      0.92 |      1.92 |       0.000 |      32.8 s |           61.6 |             71.3 |
| raw-selector (ref) |   64 | 90.6% (58/64) |                  92.2% |           100.0% |   0.0% (0.0%) |               0.0% |            6.3% |      0.92 |      1.94 |       0.016 |      50.2 s |          198.3 |            198.0 |

Supplemental oracle attainment (goal state visibly reached, zero wrong inputs, zero
required mutations, even when a later model call failed): compact 14.1%, role 18.8%,
local 76.6%, structural 92.2%, raw 92.2%. Gaps versus strict success are 0 pp for
compact/role and 1.6 pp for local/structural/raw (runs that reached the goal but were
failed by a malformed later head or a termination error).

Average candidate count at the first observation is identical across all five variants
(3.19); all-observation averages are 3.24/3.04/2.76/2.73/2.75 for
compact/role/local/structural/raw, i.e. candidate count is a shared environment
property, not a treatment difference.

### 4.2 Secondary matched subset (M250, tasks 001-010, repeats 0-4)

| Variant            | Runs | Success | Wrong Target | Ambiguity Failures | Avg Tokens/obs |
| ------------------ | ---: | ------: | -----------: | -----------------: | -------------: |
| indexed-compact    |   50 |   18.0% |        54.0% |              54.0% |           14.8 |
| indexed-role       |   50 |   16.0% |        44.0% |              44.0% |           22.1 |
| indexed-local      |   50 |   84.0% |        10.0% |              10.0% |           32.3 |
| indexed-structural |   50 |   90.0% |         0.0% |               0.0% |           50.2 |
| raw-selector (ref) |   50 |   86.0% |         2.0% |               2.0% |          171.4 |

### 4.3 Failure-type distribution (M320, failed runs)

| Variant            | SEMANTIC_AMBIGUITY | DECISION_ERROR | MODEL_OUTPUT_ERROR | BUDGET_EXCEEDED | INVALID_ACTION |
| ------------------ | -----------------: | -------------: | -----------------: | --------------: | -------------: |
| indexed-compact    |                 38 |              7 |                  2 |               8 |              0 |
| indexed-role       |                 32 |              7 |                  3 |              10 |              0 |
| indexed-local      |                  7 |              2 |                  5 |               2 |              0 |
| indexed-structural |                  0 |              0 |                  6 |               0 |              0 |
| raw-selector (ref) |                  0 |              0 |                  2 |               0 |              4 |

Structural's six failures are all malformed-output failures, never wrong-target
failures. Compact/role failures are wrong-target dominated; their budget/deadline
failures are the downstream result of repeated wrong selections.

### 4.4 Per-task metrics (M320, successes per variant)

| Task                                                     | compact | role | local | structural | raw |
| -------------------------------------------------------- | ------: | ---: | ----: | ---------: | --: |
| grounding-study-001 delete Item B                        |     0/4 |  0/4 |   4/4 |        4/4 | 4/4 |
| grounding-study-002 submit Orion                         |     0/4 |  0/4 |   4/4 |        3/4 | 4/4 |
| grounding-study-003 continue Gamma                       |     0/4 |  0/4 |   4/4 |        3/4 | 4/4 |
| grounding-study-004 submit Account settings              |     0/4 |  0/4 |   4/4 |        4/4 | 4/4 |
| grounding-study-005 delete order 408                     |     0/4 |  0/4 |   4/4 |        3/4 | 4/4 |
| grounding-study-006 open Vega link                       |     4/4 |  4/4 |   3/4 |        4/4 | 4/4 |
| grounding-study-007 nested Draft in Team Beta            |     1/4 |  0/4 |   0/4 |        4/4 | 4/4 |
| grounding-study-008 visible Archive (hidden duplicate)   |     0/4 |  1/4 |   3/4 |        4/4 | 0/4 |
| grounding-study-009 enabled Renewal (disabled duplicate) |     1/4 |  2/4 |   4/4 |        2/4 | 4/4 |
| grounding-study-010 delete Item A (reordered)            |     1/4 |  0/4 |   4/4 |        4/4 | 3/4 |
| grounding-study-011 submit Vega (rerendered)             |     0/4 |  0/4 |   4/4 |        4/4 | 4/4 |
| grounding-study-012 account in West region               |     0/4 |  1/4 |   1/4 |        4/4 | 3/4 |
| grounding-study-013 Open link vs Open button             |     2/4 |  4/4 |   4/4 |        4/4 | 4/4 |
| grounding-study-014 delete Item H (nine rows)            |     0/4 |  0/4 |   3/4 |        4/4 | 4/4 |
| grounding-study-015 Atlas East (similar entities)        |     0/4 |  0/4 |   2/4 |        3/4 | 4/4 |
| grounding-study-016 Personal invoice (legend)            |     0/4 |  0/4 |   0/4 |        4/4 | 4/4 |

Wrong executed targets (sum over repeats; ambiguity failures in parentheses):

| Task | compact |   role | local | structural | raw |
| ---- | ------: | -----: | ----: | ---------: | --: |
| 001  |   4 (4) |  3 (3) |     0 |          0 |   0 |
| 002  |   2 (2) |      0 |     0 |          0 |   0 |
| 003  |  12 (4) | 11 (4) |     0 |          0 |   0 |
| 004  |  13 (4) | 10 (4) |     0 |          0 |   0 |
| 005  |   1 (1) |      0 |     0 |          0 |   0 |
| 006  |       0 |      0 |     0 |          0 |   0 |
| 007  |   2 (1) |  2 (2) | 9 (4) |          0 |   0 |
| 008  |   3 (3) |  1 (1) |     0 |          0 |   0 |
| 009  |   3 (3) |      0 |     0 |          0 |   0 |
| 010  |       0 |  3 (3) |     0 |          0 |   0 |
| 011  |   1 (1) |  3 (3) |     0 |          0 |   0 |
| 012  |   5 (3) |  5 (3) |     0 |          0 |   0 |
| 013  |   2 (2) |      0 |     0 |          0 |   0 |
| 014  |   8 (4) |  4 (3) |     0 |          0 |   0 |
| 015  |   7 (3) |  5 (2) |     0 |          0 |   0 |
| 016  |   6 (3) |  7 (4) | 5 (3) |          0 |   0 |

Structural and raw-selector executed zero wrong targets on all 16 tasks in M320. Local's
wrong executions are concentrated in the nested/legend tasks: 9 on `007` and 5 on `016`
(14 of its 14 in the subset), while `012` local failures were BLOCKED/ deadline failures
with no wrong execution.

### 4.5 Representation size

| Variant            | First-obs candidates | First-obs chars | First-obs est. tokens | All-obs chars/obs | All-obs est. tokens/obs | Total rep tokens | Rep tokens per strict success |
| ------------------ | -------------------: | --------------: | --------------------: | ----------------: | ----------------------: | ---------------: | ----------------------------: |
| indexed-compact    |                 3.19 |            64.9 |                  16.6 |              66.0 |                    16.9 |            3,188 |                           354 |
| indexed-role       |                 3.19 |            99.1 |                  25.1 |              94.9 |                    24.1 |            4,335 |                           361 |
| indexed-local      |                 3.19 |           166.5 |                  42.1 |             145.7 |                    36.9 |            4,797 |                           100 |
| indexed-structural |                 3.19 |           283.1 |                  71.3 |             244.8 |                    61.6 |            7,579 |                           131 |
| raw-selector (ref) |                 3.19 |           790.5 |                 198.0 |             791.7 |                   198.3 |           24,388 |                           421 |

Token counts are the documented UTF-8-byte/4 heuristic, not a model tokenizer and not a
billable-token claim.

Provider-reported usage (whole prompt+response, lower bounds; coverage counts
usage-bearing turns):

| Variant            | Input tokens | Output tokens | Total tokens | Coverage |
| ------------------ | -----------: | ------------: | -----------: | -------: |
| indexed-compact    |       84,716 |       268,669 |      353,385 |  162/189 |
| indexed-role       |       79,537 |       215,964 |      295,501 |  150/180 |
| indexed-local      |       65,773 |        86,765 |      152,538 |  123/123 |
| indexed-structural |       68,697 |        63,985 |      132,682 |  123/123 |
| raw-selector (ref) |       89,753 |        70,404 |      160,157 |  123/123 |

Compact/role coverage gaps mean their provider totals are less complete lower bounds;
their output-token totals are inflated by retry loops. Per strict success the provider
totals are roughly 39.3k, 24.6k, 3.2k, 2.3k, 2.8k tokens for
compact/role/local/structural/raw respectively.

---

## 5. Action-representation effects

### 5.1 Paired task-cluster differences (M320)

Task-level rates are paired by task and resampled by task cluster (deterministic 2,000
draws, repeats preserved inside each task, matching the study's own interval method).
With 16 clusters, interval endpoints are quantized at 6.25 pp.

| Comparison           | Mean success difference | Task-cluster 95% interval |
| -------------------- | ----------------------: | ------------------------- |
| role - compact       |                 +4.7 pp | -3.1 to +14.1 pp          |
| local - role         |                +56.3 pp | +32.8 to +78.1 pp         |
| structural - local   |                +15.6 pp | -4.7 to +39.1 pp          |
| structural - compact |                +76.6 pp | +62.5 to +89.1 pp         |
| raw - compact        |                +76.6 pp | +59.4 to +92.2 pp         |

The role-to-local step is decisively large. The role-versus-compact step and the
structural-versus-local step are not resolved by this subset. An unclustered
two-proportion test on structural vs local gives z ~ 2.3 (nominal p ~ 0.02), but the
task-clustered interval includes zero and the effect is concentrated in three tasks
(below).

### 5.2 Where the structural advantage actually lives

| Subset (M320)                     | compact |  role | local | structural |   raw |
| --------------------------------- | ------: | ----: | ----: | ---------: | ----: |
| Nested/legend tasks 007, 012, 016 |    8.3% |  8.3% |  8.3% |     100.0% | 91.7% |
| Other 13 tasks                    |   15.4% | 21.2% | 90.4% |      88.5% | 90.4% |

On the 13 non-nested tasks, local and structural are indistinguishable (90.4% vs 88.5%).
Every failure of either arm there is a malformed-output head (local 5, structural 6),
not a wrong-target selection. The entire local-to-structural success gain comes from
tasks where the disambiguating text is a section heading/legend outside the local
container (`007` Team Beta vs other teams, `012` West region, `016` Personal invoice
legend). This is a clear, mechanism-specific effect, but it rests on three task
clusters.

### 5.3 Tasks where richer context clearly helps

- `001`-`005`, `010`, `011`, `014`: repeated identical control labels with the entity
  only in nearby text. Compact/role fail 0-1/4; local succeeds 3-4/4. Differential: up
  to +100 pp.
- `007`, `012`, `016`: section-only disambiguation. Local fails (0-1/4) because all
  local contexts are textually identical; structural succeeds 4/4.
- `015`: similar entity names (Atlas East/North/West). Local 2/4, structural 3/4, raw
  4/4 - a graded case.

### 5.4 Where role information alone helps

- `013` ("Use the Open link, rather than the Open button"): compact 2/4, role 4/4. This
  is the only task with a clean role-only effect; in the full file, role is the only arm
  that reaches 4/4 while compact shows "Open"/"Open" with no role.
- Elsewhere role is statistically indistinguishable from compact (+4.7 pp overall,
  interval includes zero). Role does not fix entity mapping because compact and role
  descriptions still collide on repeated labels (15 of 16 tasks have duplicate
  first-observation descriptions after stripping index ids; compact has 16 of 16).

### 5.5 No-benefit and regression cases

- Already-easy `006`: all arms 4/4 at the task level. Local's single failure is a
  malformed head; this is not a grounding regression.
- Apparent structural regression `009` (2/4 vs local 4/4): both structural failures are
  `Invalid TypeSafe response` malformed heads; the model's chosen target was correct in
  at least one (raw output chose target 2 of 2). Not a semantic regression.
- Reference-arm regression `008` (raw 0/4, local 3/4, structural 4/4): a CSS selector
  matching the hidden duplicate is correctly rejected as `ineligible`. This is the
  documented raw-selector asymmetry, not evidence against context.

### 5.6 Tasks failing under all representations

None in M320. The hardest task cluster (`007`, `012`, `016`) fails under
compact/role/local but is solved 4/4 by structural and 11/12 by raw. No task in this
fixture set is unsolvable by every arm.

### 5.7 Diminishing returns and wrong-target reduction

Marginal steps: compact -> role +4.7 pp (unresolved); role -> local +56.3 pp (large);
local -> structural +15.6 pp (unresolved, concentrated in nested tasks); structural ->
raw-selector +0.0 pp at +211% representation tokens per observation.

Wrong executed inputs fall monotonically and then to zero: compact 79.3% of executed
inputs -> role 75.0% -> local 22.2% -> structural 0.0% -> raw 0.0%. Semantic-ambiguity
failures show the same shape (59.4% / 50.0% / 10.9% / 0.0% / 0.0%). Structural is the
lowest-cost arm that never executed a wrong target.

Latency follows reliability rather than representation size: compact 167.1 s and role
158.6 s average (median ~194 s / ~187 s, dominated by 240 s deadline failures), local
57.2 s, structural 32.8 s, raw 50.2 s. Average LLM calls: 3.33 / 3.23 / 2.14 / 1.92 /
1.94. Richer context reduces total calls and latency because it avoids retry loops.

---

## 6. Reliability versus context cost

M320 (64 matched runs per variant; tokens use the byte/4 estimator per observation;
correct target is the first accepted target per run; wrong target is run-level):

| Representation             | Matched Runs | Success | Correct Target | Wrong Target | Ambiguity Failures | Avg Rep Tokens |
| -------------------------- | -----------: | ------: | -------------: | -----------: | -----------------: | -------------: |
| indexed-compact (baseline) |           64 |   14.1% |          14.1% |        59.4% |              59.4% |           16.9 |
| indexed-role               |           64 |   18.8% |          18.8% |        50.0% |              50.0% |           24.1 |
| indexed-local              |           64 |   75.0% |          76.6% |        10.9% |              10.9% |           36.9 |
| indexed-structural         |           64 |   90.6% |          92.2% |         0.0% |               0.0% |           61.6 |
| raw-selector (reference)   |           64 |   90.6% |          92.2% |         0.0% |               0.0% |          198.3 |

Relative representation-cost increase versus compact, using first-observation estimated
tokens (characters give the same ranking; +51.1% role, +153.0% local, +328.6%
structural, +1091.0% raw in tokens; +52.6%, +156.4%, +336.0%, +1117.3% in characters):

| Representation     | Rep-token cost vs compact | Success gain vs compact | Wrong-target reduction |
| ------------------ | ------------------------: | ----------------------: | ---------------------: |
| indexed-role       |                      +51% |    +4.7 pp (unresolved) |                 9.4 pp |
| indexed-local      |                     +153% |     +60.9 pp (resolved) |                48.5 pp |
| indexed-structural |                     +329% |     +76.6 pp (resolved) |                59.4 pp |
| raw-selector       |                    +1091% |     +76.6 pp (resolved) |                59.4 pp |

Pareto assessment on (success, representation cost):

- `indexed-compact`, `indexed-role`, `indexed-local`, `indexed-structural` are each
  Pareto-efficient against the others: each pays more context for strictly more success
  and fewer wrong executions.
- `raw-selector` is strictly dominated by `indexed-structural`: identical success,
  identical correct/wrong/ambiguity profile, ~3.2x the representation tokens (198.3 vs
  61.6 per observation), and four additional invalid-selector failures.
- If total inference cost rather than static prompt size is used, the ordering inverts:
  provider-reported total tokens per strict success are ~39.3k (compact), 24.6k (role),
  3.2k (local), 2.3k (structural), 2.8k (raw), and average latency is ~5x lower for
  structural than compact. Larger target descriptions correlate with fewer decision
  calls and fewer retries, so representation overhead does not imply higher end-to-end
  cost in this cohort.
- No single variant dominates on both reliability and static context size. The data do
  not justify declaring a winner from raw success rate alone.

---

## 7. Failure patterns

Failure classification was taken from the raw records unchanged. Patterns observed in
this cohort:

1. Repeated-label ambiguity (entity mapping absent). Compact and role almost never
   select the correct entity when several controls share a label; wrong executed targets
   dominate. For compact, 44 of 64 failures in the full file (38 of 55 in M320) are
   `SEMANTIC_AMBIGUITY`. Failure is often preceded by multiple wrong clicks and then a
   deadline/retry termination. Representative: `7021c652...` (`013` compact r0:
   descriptions are bare `[1] Open`, `[2] Open`; model chooses the button 55/45; wrong
   target; wall-clock budget).
2. Context-only distinguishable targets. Local text resolves most repeated labels
   (`001`-`005`, `010`, `011`, `014`). Representative: `14acc6c6...` (`001` local r0:
   `Delete | context: Item B | $29.99` -> correct in one click).
3. Context collisions that need a section. `007`, `012`, `016` keep identical local
   text; local selects the wrong sibling. Representative: `8d860cc1...` (`007` local r0:
   all three `Delete | context: Draft`, two wrong clicks, deadline). Structural adds
   `section: Team Beta`. Representative: `b91eec2b...` (`007` structural r0: correct
   first click, DONE). Same mechanism on `016`: `9d0eeed3...` (local, all contexts
   `Invoice`, two wrong clicks) vs `674d5a54...` (structural, section
   `Personal invoice`, correct).
4. Hidden/disabled duplicates. Indexed arms omit hidden/disabled controls by
   construction. `008` hidden duplicate: raw-selector fails all repeats with
   `Invalid selector: ineligible` (e.g. `3ef4f68d...`, selector
   `#controls article:nth-of-type(2) button`). `009` disabled duplicate: local 4/4;
   structural 2/4 but both failures are malformed heads, not wrong selections.
5. Reordered/re-rendered controls (`010`, `011`). The fixtures permute and re-render
   deterministically before observation; no stale events occur. Failures are the same
   entity-mapping failures as elsewhere. No observation-timing failure was found.
6. Model decision errors. `DECISION_ERROR` (mostly `BLOCKED`) is 7-9 runs for
   compact/role and 2 for local. Representative: `14317924...` (`012` local r1: model
   reports BLOCKED although the target exists, because the local contexts are
   indistinguishable).
7. Model output-format errors (`MODEL_OUTPUT_ERROR`). All six structural failures and
   several local failures are malformed heads: the model emits a compact
   `{"operation":{"CLICK":0.94,...}}` form instead of `{"choice":...}`, or omits
   zero-probability keys from the target distribution that the parser requires.
   Representative: `b6ab4854...` (`009` structural r1) and `9456da23...` (`014` local
   r3, whose malformed output nevertheless contains the correct target id). These are
   not grounding regressions, but they do reduce reported success and correct target
   rates for richer arms.
8. Budget/deadline exhaustion. 22 runs in the full file; 8/64 compact and 10/64 role in
   M320 versus 2/64 local and 0/64 structural. These are downstream of repeated wrong
   selections (some compact runs execute zero valid actions before the 240 s deadline,
   e.g. `2e35e23d...`, `011` compact r0).
9. Execution errors. No executor fault in this cohort. `INVALID_ACTION` occurs only for
   the raw selector reference (`5` runs, all hidden-duplicate `008`). `stale_events = 0`
   throughout.
10. No stale/dynamic-state failures. The protocol deliberately freezes mutations before
    observation for this study; the delayed-modal diagnostic is separate.

---

## 8. Delayed-modal diagnosis (offline)

Relevant traces exist and were inspected: the previous `main` cohort contains the
delayed-modal task `stale-004` (`20` runs: 5 repeats x 4 variants), and the current
repository also preserves the separate 10-run `modal-before` / `modal-after` diagnostic
cohorts.

### Verified facts from raw traces

- All 20 `main` runs failed: 16 `STALE_TARGET`, 3 `MODEL_OUTPUT_ERROR`, 1
  `BUDGET_EXCEEDED`. Verified directly from `evals/results/main.jsonl` (`stale-004`
  summaries, schema v2).
- The mutation (`notice.showModal()`) fires after the first decision. In every
  recovery-enabled trace, the first decision is `CLICK` on `Save draft`; the executor
  rejects it as covered (`Target changed or is covered. Observe again.`).
- From the next observation onward, `Dismiss update notice` is present in the candidate
  set (e.g. `1c0c43ca...` `prism-full` r2: targets `[1] Publish draft`,
  `[2] Save draft`, `[3] Dismiss update notice`), but the policy re-selects `Save draft`
  at every step (six times) until the retry bound / deadline stops it.
- Failed attempts are absent from `history` in subsequent model inputs (empty history in
  the repeated-Save-draft traces), so the policy receives no feedback that its action
  was rejected.
- `prism-no-stale-recovery` stops after the first rejection (one call, stale=1).
- The page text is status-only; nothing in the indexed prompt signals modality, and the
  dialog's own control is offered alongside the covered background control.
- The fresh diagnostic confirms the mechanism: `modal-before` 0/10 success;
  `modal-after` (eval-only active-dialog candidate filter) 9/10 strict success, 10/10
  final-oracle attainment, one residual malformed-output failure. In the after traces,
  the covered background control is removed and only the dialog's control is offered, so
  the policy dismisses and then saves.

### Mechanism ranking

| Candidate mechanism                | Verdict                                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Observation timing                 | Rejected. The dialog is open and observed before the rejected clicks; no race exists.                                                            |
| Missing wait semantics             | Not the cause. `WAIT` was offered and is not required; the dialog is already open and stable.                                                    |
| Stale state                        | Rejected in the fixture sense. The state is deterministic; the "stale" label is the executor's correct covered-target rejection.                 |
| Newly appeared target not observed | Rejected. The dismiss control appears in the very next observation and is re-offered every step.                                                 |
| Premature completion/termination   | Rejected. No run reaches the result state.                                                                                                       |
| Action budget                      | Downstream only. Retry/deadline exhaustion is a consequence of repeated reselection, not the origin.                                             |
| Decision error                     | Contributing. The policy repeatedly chooses the covered `Save draft` and never chooses the visibly offered dismiss control.                      |
| Executor behavior                  | Correct. The executor properly refuses input covered by a native modal; it is the observed candidate set that is wrong.                          |
| Model output format                | Separate contributing failure. 3/20 main runs (and 4/10 before runs) end on malformed heads (missing probability keys), independent of modality. |

**Diagnosis:** the dominant mechanism is a mismatch between observed eligibility and
executable eligibility under a native modal, combined with policy reselection of a
blocked action and the absence of failed-attempt feedback in the model history. The
newly appeared dismiss target is observed but not selected. The smallest experiment that
tests this mechanism is the eval-only active-dialog observation filter already measured
in `modal-after`. No fix is implemented or recommended here; production behavior is
unchanged.

---

## 9. Are the 373 persisted runs already informative?

### 9.1 Is the matched subset large enough to detect a large representation effect?

Yes for large effects, no for moderate ones. M320 gives 64 runs and 16 task clusters per
variant. The local-vs-role difference (+56.3 pp) is far outside its clustered interval.
The structural-vs-local difference (+15.6 pp) is not resolved: the task-cluster interval
crosses zero, and the effect is concentrated in three tasks. The role-vs-compact
difference (+4.7 pp) is undetectable at this sample size. With 16 clusters the clustered
intervals are coarse (endpoints at multiples of 6.25 pp), so absence of a significant
interval is weak evidence of no effect; it mainly means the data cannot rank the
adjacent arms yet.

### 9.2 Clear qualitative patterns already present

- Entity-mapping failures dominate compact/role: repeated labels with no local text
  cannot be resolved, producing wrong executions (59.4% / 50.0% of runs in M320).
- Local semantic text removes most of those failures (75.0% success, 10.9% wrong
  targets).
- Section headings are required exactly where the local container text is identically
  duplicated (`007`, `012`, `016`): local 8.3% vs structural 100% on the nested subset,
  while the other 13 tasks show no structural advantage (90.4% vs 88.5%).
- Structural and raw never execute a wrong target in M320; structural's residual
  failures are malformed output heads, not grounding errors.
- The raw selector reference is dominated by structural (same success, ~3.2x
  representation cost, extra hidden-element invalid-selector failures).
- Repeat 4 results are consistent with repeats 0-3 for tasks 001-010 (e.g. structural
  88% -> 100%, local 85% -> 80%), so the surviving data are not a lucky wave.

### 9.3 Reasonably supported conclusions

1. Adding local semantic context to indexed actions decisively improves grounding
   reliability on this task set (local / structural / raw vs compact / role).
2. Role alone is close to compact on average; the one clean role-only signal is the
   explicit link-vs-button task (`013`).
3. Structural context eliminates wrong-target executions in this cohort, but its success
   advantage over local is confined to nested/section tasks.
4. The raw-selector reference is not a cheaper or more reliable alternative to
   structural; it additionally fails on hidden duplicates.
5. Failures of the richest arms are predominantly output-format errors, not grounding
   errors; failure labels must be read with that in mind.

### 9.4 Still premature

- Whether structural should replace local as the default: the local-to-structural step
  is unresolved and task-cluster concentrated.
- Any precise ordering of role vs compact, and any claim about role's average value.
- Per-task success rates for individual variants: 4-5 repeats per cell, mixed outcomes
  throughout (temperature 0 did not produce deterministic behavior).
- Token-efficiency claims based on the byte/4 estimator, and provider-token comparisons
  where compact/role coverage is incomplete.
- Generalization beyond these 16 local synthetic fixtures, this one model, and this
  provider.

### 9.5 Would completing the cohort materially change the interpretation?

Probably not the headline, but it would settle the open adjacent-arm questions. The
compact/role-to-local gap is so large and repeat-4-consistent that 427 additional runs
are unlikely to reverse it. What full completion adds is: 10 repeats per cell (2-2.5x
the current per-task evidence), resolution of structural-vs-local and role-vs-compact,
and a valid run of the predeclared extension selection rule, which currently cannot
execute because the study's own audit requires a complete cohort. If the remaining runs
were to show a materially different malformed-output rate for structural due to provider
drift, the structural result would weaken; that is the main risk to monitor.

### 9.6 Which tasks/variants most need additional repeats

- Repeat 4 is missing for `012`-`016` all variants and for `011` local/structural;
  repeats 5-9 are missing everywhere.
- Applying the study's predeclared selection rule to the current data (as a projection
  only) ranks `009`, `008`, `015`, `012` as the four tasks that would qualify for the
  10-19 extension (mixed indexed arms and/or close local/structural). This must be
  recomputed after full completion; it is not a result.

### 9.7 Claim ledger

| Status                | Claim                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Supported             | Local semantic context produces a large, task-clustered success and wrong-target improvement over compact/role.            |
| Supported             | Section-level context is required for the three tasks whose local text is duplicated.                                      |
| Supported             | Role information alone is not enough to resolve repeated-label entities; it only clearly helps the explicit role-cue task. |
| Supported             | Structural never executed a wrong target; its failures are output-format failures.                                         |
| Supported (reference) | Raw-selector is dominated by structural in this cohort and fails on hidden duplicates.                                     |
| Tentative             | Structural is better than local overall (effect concentrated in three task clusters, interval crosses zero).               |
| Tentative             | Richer arms are cheaper end-to-end despite larger prompts (fewer retries; provider totals are lower bounds).               |
| Unsupported           | Any "richer is universally better" claim.                                                                                  |
| Unsupported           | Any production default change based on this partial cohort.                                                                |
| Unsupported           | Transfer of these effects to open-web pages or other models.                                                               |

---

## 10. Resume plan

The cohort can be resumed without rerunning any completed trial. The runner's `--resume`
path loads existing summaries, computes `plan - completed`, and dispatches only missing
`(task, variant, repetition)` pairs. It refuses to start if the frozen control hash
differs (cohort, tasks, source, fixtures, system/task prompts) and refuses duplicate
pairs. Completed trials are never replaced.

Remaining work for the initial balanced cohort:

| Group                                            | Missing runs |
| ------------------------------------------------ | -----------: |
| Repeat 4, tasks 011-016 (27 cells)               |           27 |
| Repeats 5-9, all 16 tasks x 5 variants (80 each) |          400 |
| **Total**                                        |      **427** |

Missing by variant: compact 85, role 85, local 86, structural 86, raw-selector 85.
Missing by task: tasks 001-010 = 25 each (repeats 5-9); task 011 = 27; tasks 012-016 =
30 each.

Repeat-4 cells explicitly missing:

- `grounding-study-011/indexed-local/4`, `grounding-study-011/indexed-structural/4`
- `grounding-study-012/{indexed-compact,indexed-role,indexed-local,indexed-structural,raw-selector}/4`
- `grounding-study-013/{...all five...}/4`
- `grounding-study-014/{...all five...}/4`
- `grounding-study-015/{...all five...}/4`
- `grounding-study-016/{...all five...}/4`

Exact future run identifiers are not recoverable: `run_id` is a UUID generated at
dispatch time, and no pending-run IDs are stored. The sidecar's `planned_pairs` list
contains all 800 exact pair keys and is the authoritative schedule; after resume the
sidecar is rewritten with the updated `completed_runs` and `stop_reason`.

Operational preconditions for a safe resume (not executed here):

- Environment: same `TEXT_MODEL_API_KEY` and provider quota; dedicated Chrome on the
  configured debug URL; fixture port 9841; Node 22.
- Frozen controls: source hash `ccdf08a9...`, fixture hash `3833559...`, same
  `evals/cohorts/ambiguity-initial.json` and task file. Any source/prompt/fixture edit
  changes the control hash and the runner will refuse the resume.
- Command shape (for the operator, not run in this audit):
  `pnpm eval:cohort --config evals/cohorts/ambiguity-initial.json --resume`
- The predeclared extension cohort (`repeats 10-19`, at most four tasks, all five arms,
  up to 200 runs) is conditional on a complete initial cohort and on the selection rule;
  it does not exist yet. `ambiguity-report.ts select` will refuse the current incomplete
  file by design.

Do not pool `ambiguity-smoke` (15 runs), the `preflight/` setup runs (15 runs), or the
modal diagnostic cohorts (20 runs) into these estimates; they are separate cohorts with
different layouts/policies and are excluded by protocol.

---

## 11. Limitations

- This is an interim, unbalanced-cohort audit. All comparative claims use M320 (and
  M250), not the 373-run aggregate. Unmatched aggregates are reported only as reference.
- 64 (M320) or 50 (M250) matched runs per variant across 16 (or 10) task clusters.
  Cluster intervals are wide and quantized; adjacent-arm rankings remain uncertain.
- Token counts are a UTF-8-byte/4 heuristic, not tokenizer counts. Provider-reported
  totals are lower bounds and are less complete for compact/role (coverage 162/189 and
  150/180 usage-bearing turns).
- `raw-selector` is a reference arm with extra DOM and a different locator mode; its
  failures and costs are not causal context effects.
- The fixtures are 16 small deterministic local pages; the protocol itself bounds
  conclusions to this convenience cohort. No open-web or production claim is made.
- The cohort stopped on an endpoint failure after 373 summaries; per-run provider
  behavior during the run may have varied, and no attempt was made to re-run failures.
- The delayed-modal section diagnoses the previous main cohort plus the preserved
  before/after diagnostic; it is not part of the ambiguity representation comparison.

---

## 12. Audit conclusion

373 completed summaries are on disk and intact (not 371; see Section 1). The largest
fair matched comparison is M320: 16 tasks x repeats 0-3 x 5 variants = 320 runs (256
indexed-only). The strongest observed signal is that local semantic context raises
strict success from 14.1-18.8% to 75.0% and cuts wrong executed targets from 50-59% of
runs to 10.9%, while section-level context (structural) additionally solves the three
nested/legend tasks and removes wrong executions entirely - but the
structural-versus-local difference is unresolved overall and concentrated in those three
tasks. Raw selectors offer no reliability advantage over structural at roughly 3.2x the
representation cost and fail on hidden duplicates. The largest open question is whether
structural's reliability edge generalizes beyond nested/section tasks; completing the
remaining 427 planned runs (without rerunning completed trials) is the right next step
before drawing a default-representation conclusion. No model/API calls, reruns, or
raw-file changes were made during this audit.
