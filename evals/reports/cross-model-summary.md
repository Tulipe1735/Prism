# Cross-Model Summary

Two separately frozen cohorts; no pooled estimates. Parent glm-5.3-flash; replication deepseek-v4.1-flash. Same twelve synthetic tasks and method.

| Finding | glm-5.3-flash | deepseek-v4.1-flash | Replication status |
|---|---|---|---|
| Structural > Local on structural ambiguity | Structural 90.0% (18/20); Local 25.0% (5/20) | Structural 100.0% (20/20); Local 25.0% (5/20) | Replicated |
| Local sufficient on local ambiguity | 90.0% (18/20) | 100.0% (20/20) | Replicated; all four local tasks 5/5 under both Local and Structural |
| Adaptive zero/low wrong-target inputs | 0 | 0 | Replicated (observed zero only) |
| Adaptive versus Structural grounding | 93.3% vs 88.3% | 96.7% vs 100% | Descriptively close; formal preservation inconclusive |
| Adaptive versus Structural strict success | 88.3% vs 83.3% | 86.7% vs 100% | Model-sensitive reversal |
| Adaptive initial representation cost < Structural | 35.4% less | 35.4% less | Replicated |
| Adaptive total tokens < Local | 1423 vs 3117 | 1748 vs 4178 | Replicated |
| Adaptive total tokens < Structural | 1423 vs 1616; unresolved | 1748 vs 1772 | Inconclusive; cross-model savings unsupported |

## Effect directions and magnitudes

Difference [95% task-cluster CI]. Each model analyzed independently.

| Contrast | GLM | DeepSeek |
|---|---|---|
| Structural − Local grounding (structural), pp | 65.00 [10.00, 100.00] | 75.00 [40.00, 100.00] |
| Adaptive − Structural grounding, pp | 5.00 [-5.00, 15.00] | -3.33 [-8.33, 0.00] |
| Adaptive − Local total tokens/task | -1693.47 [-3410.57, -288.13] | -2429.85 [-5487.85, -361.65] |
| Adaptive − Structural total tokens/task | -192.10 [-440.80, 18.02] | -24.27 [-131.87, 115.85] |

## Failure distribution

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

## Interpretation and next milestone

RQ1 replicated; RQ2 qualitatively replicated on grounding/context exposure, while
reliability preservation is inconclusive and strict completion is worse for Adaptive
under DeepSeek. RQ3 replicated the pattern: Adaptive used 58.2% fewer total tokens
than Local with a negative task-cluster CI, while Adaptive versus Structural remained
unresolved. No raw runs were pooled.

MODEL_OUTPUT_ERROR fell 33→3, and all eight new DECISION_ERROR cases grounded correctly
before valid BLOCKED responses. The shared Local/structural-class semantic count was
14 in each cohort. Reasoning exhaustion occurred under both models (4→2), confined to
Local/structural ambiguity here; its frequency and final-content convention differ.

Cross-model evidence now supports the structural scope advantage, local sufficiency
on these local tasks, lower Adaptive initial representation exposure, observed zero
Adaptive wrong targets, and lower Adaptive total usage versus Local. Statistical
non-inferiority, general preservation of strict success, total savings versus Structural,
universal necessity and open-web validity remain unsupported. The evidence justifies
external/open-web validation as the next study, without assuming external success.

The unchanged static policy explains identical initial cost/minimum-match/expansion
counts; those are not independent evidence on a new task distribution. The relative
grounding direction and termination behavior are model-sensitive. All 240 initial
message hashes match the parent's matched cells; runtime/source hashes match and all
202 protected files remain unchanged. Required final checks are recorded separately.
