# Interpretation of the fixed-model benchmark

Primary data: `pilot.jsonl` (288 runs) and `main.jsonl` (480 runs). All completed
failures are retained. The invalid 273-run preflight attempt and other setup smoke runs
are archived and excluded. The final connectivity smoke is separate.

Both primary stages used glm-5.3-flash via OpenCode Go, temperature 0, the same
system/task prompt format, Chrome/153.0.8010.12, viewport 1120 × 780, eight executed
actions, two HTTP retries, five stale retries where enabled, max_tokens 8192,
provider-default reasoning, and a 240-second task deadline. Source, fixture, task and
prompt controls match. Sidecars confirm complete planned schedules; step/summary
counters reconcile.

The main cohort supports a stale-recovery benefit on the injected dynamic tasks. It does
not establish that indexing outperforms selector generation. Disabling structural
validation improved reported success for this generative policy; validation prevented
malformed distributions from executing, but this did not translate into higher task
success. Neither finding establishes the production TypeSafe model's behavior.

## Overall success

| Variant                 | Pilot (3 repeats) | Main (5 repeats) | Main difference versus full                     |
| ----------------------- | ----------------: | ---------------: | ----------------------------------------------- |
| prism-full              |     84.7% (61/72) |  83.3% (100/120) | reference                                       |
| prism-no-stale-recovery |     73.6% (53/72) |   74.2% (89/120) | -9.2 pp; task-cluster 95% CI -27.5 pp to 5.8 pp |
| prism-no-validation     |     91.7% (66/72) |  93.3% (112/120) | 10.0 pp; task-cluster 95% CI 2.5 pp to 17.5 pp  |
| raw-selector            |     84.7% (61/72) |   82.5% (99/120) | -0.8 pp; task-cluster 95% CI -10.8 pp to 7.5 pp |

## Goal attainment versus reported run success

Reported run success requires no runtime exception plus the final oracle checks, zero
wrong-target events and the required fixture mutation. A model-output error after the
requested browser state was reached still fails the run. The separate final-oracle
metric below counts goal attainment from retained evidence, including the same
wrong-target and mutation checks; it does not turn failed runs into successes.

| Variant                 | Pilot reported success | Pilot final oracle attained | Main reported success | Main final oracle attained |
| ----------------------- | ---------------------: | --------------------------: | --------------------: | -------------------------: |
| prism-full              |          84.7% (61/72) |                       61/72 |       83.3% (100/120) |                    102/120 |
| prism-no-stale-recovery |          73.6% (53/72) |                       54/72 |        74.2% (89/120) |                     90/120 |
| prism-no-validation     |          91.7% (66/72) |                       68/72 |       93.3% (112/120) |                    115/120 |
| raw-selector            |          84.7% (61/72) |                       62/72 |        82.5% (99/120) |                    100/120 |

This distinction separates failure to reach the requested page state from a later
protocol/termination failure. Both matter, but they support different conclusions about
validation.

## Stale recovery

| Variant                 | Main dynamic success (6 tasks) | Dynamic success excluding reordering control (5 tasks) |
| ----------------------- | -----------------------------: | -----------------------------------------------------: |
| prism-full              |                  80.0% (24/30) |                                          76.0% (19/25) |
| prism-no-stale-recovery |                   16.7% (5/30) |                                            0.0% (0/25) |
| prism-no-validation     |                  80.0% (24/30) |                                          76.0% (19/25) |
| raw-selector            |                  83.3% (25/30) |                                          80.0% (20/25) |

On dynamic tasks, no-stale-recovery minus full is -63.3 pp; task-cluster 95% CI -96.7 pp
to -30.0 pp. This comparison includes failures before a mutation was encountered. It
supports an effect only on these deliberately injected local perturbations, not
arbitrary dynamic web pages. Recovery-enabled agents still fail; recovery progress is
not the same as task success.

20 main runs failed the delayed-modal task; 15 of those repeated an identical
model-input hash. The agent history contains executed actions, so rejected stale
attempts do not provide explicit failed-action feedback to the policy. Repeated
selection of the occluded background control can stall recovery. This is a
trace-supported failure hypothesis; richer context or feedback require a separate
intervention study.

## Indexed versus selector grounding

The minimal selector baseline resolves one CSS match in the original DOM and then uses
the same observed-node executor and guards. Visible-only evidence omits hidden siblings
that CSS matching can still find. Therefore the hidden-control fixture is a baseline
information/visibility limitation, not clean evidence of semantic grounding superiority.

| Variant      | Main success, all 24 tasks | Main success excluding hidden control | Main grounding + ambiguity success |
| ------------ | -------------------------: | ------------------------------------: | ---------------------------------: |
| prism-full   |            83.3% (100/120) |                        83.5% (96/115) |                      87.5% (70/80) |
| raw-selector |             82.5% (99/120) |                        86.1% (99/115) |                      85.0% (68/80) |

Raw selector minus full after excluding the hidden-control task: 2.6 pp; task-cluster
95% CI -5.2 pp to 9.6 pp. Do not infer an indexing advantage from the hidden-control
task alone. Target generation was isolated; this is not a selector-native locator engine
with automatic re-resolution.

## Validation and bad execution

| Variant                 | Audited invalid outputs | Executed turns with invalid distribution audit | Wrong-target executions |
| ----------------------- | ----------------------: | ---------------------------------------------: | ----------------------: |
| prism-full              |                      17 |                                              0 |                       0 |
| prism-no-stale-recovery |                       6 |                                              0 |                       1 |
| prism-no-validation     |                      13 |                                              6 |                       0 |
| raw-selector            |                      10 |                                              0 |                       0 |

Structural validation blocks inconsistent output heads, but a semantically wrong target
can have a fully valid distribution. Executing a malformed distribution does not itself
prove the browser action was wrong. This study uses actual self-reported generative
probability heads; they are not TypeSafe server logits or constrained decoding.
Interpret format rejection, semantic correctness and task completion separately.

## Ambiguity

| Variant                 | Main ambiguity success (11 tasks) | Correct / scored accepted target selections |
| ----------------------- | --------------------------------: | ------------------------------------------: |
| prism-full              |                     89.1% (49/55) |                                     51 / 51 |
| prism-no-stale-recovery |                     96.4% (53/55) |                                     54 / 54 |
| prism-no-validation     |                     96.4% (53/55) |                                     55 / 55 |
| raw-selector            |                     89.1% (49/55) |                                     49 / 49 |

The earlier scripted repeated-label failure remains preserved. These live runs supplied
full sanitized DOM context to every arm; successful runs do not show that the compact
target-id/label representation alone is sufficient. Local-context representations have
not been implemented or tested. Correct-target rates are conditional on accepted, scored
proposals; malformed heads can fail before assessment.

## Reliability and cost

| Variant                 | Main LLM HTTP attempts | Average latency (s) | Median latency (s) | Reported tokens (observed lower bound) | Usage-bearing / model-call turns |
| ----------------------- | ---------------------: | ------------------: | -----------------: | -------------------------------------: | -------------------------------: |
| prism-full              |                    269 |               26.89 |              17.97 |                                 275024 |                        266 / 266 |
| prism-no-stale-recovery |                    218 |               21.65 |              13.74 |                                 219506 |                        215 / 216 |
| prism-no-validation     |                    285 |               26.40 |              18.62 |                                 307486 |                        285 / 285 |
| raw-selector            |                    267 |               33.57 |              23.02 |                                 320060 |                        263 / 265 |

Usage totals are lower bounds when an attempt times out or a retry lacks usage. Missing
usage is not zero. No dollar-cost estimate is fabricated. Latency includes setup and
cleanup and can vary with provider load. Recovery can spend additional calls; success
per call and total wall time are different objectives.

## Repeat variance and next experiment

pilot: 19/96 task/variant groups have mixed success; 26/96 have different behavior
signatures. Temperature 0 did not guarantee identical runs.

main: 27/96 task/variant groups have mixed success; 37/96 have different behavior
signatures. Temperature 0 did not guarantee identical runs.

Do not automatically increase every task to ten repeats. Candidates for a separate
10–20-repeat follow-up, ranked by summed per-arm observed success variance, are
`ambiguity-008`, `form-001`, `ambiguity-006`, `ambiguity-004`, `ambiguity-011`. Preserve
the balanced main cohort as the primary result; any selective extension should have its
own cohort id and be reported separately.

The next representation study should compare raw selectors, current indexed targets and
indexed targets with local semantic context on focused repeated-label cases. Hold model
and runtime budgets fixed and measure grounding accuracy and token cost. No
richer-context superiority is claimed here. The current result is for a shared
generative policy with Prism’s parser/loop/executor and a DOM supplement; it is not a
measurement of the production TypeSafe model or general open-web reliability.

See `summary.md` for per-task rates, confidence intervals, category results and failure
distributions; `failure-analysis.md` contains the complete failure index and ten diverse
actual traces. Intervals resample tasks rather than treating repeated runs as
independent tasks.

The exact primary sources are retained in `../results/primary-source.tar.gz` (SHA256
`849ea451cc2ebeb8d9c4c4c7eb1cbab3a6c6634033a9dacde558fcc76c83d9f1`). Completed sidecars
point to this snapshot.
