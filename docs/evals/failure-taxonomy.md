# Evaluation failure taxonomy

`evals/schema.ts` owns the typed names; `evals/failures.ts` assigns the primary task
failure. Failed attempts keep their own classification even when a later attempt
succeeds. This is an initial taxonomy, not a complete causal diagnosis.

| Failure type             | Meaning and initial evidence                                                                                                                                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACTION_GROUNDING_ERROR` | An input reached the wrong semantic target. A fixture's monotonic wrong-target counter provides concrete evidence. An offered/valid index does not imply the correct target.                                                                              |
| `SEMANTIC_AMBIGUITY`     | An audited wrong input occurred in an ambiguity task with indistinguishable or similar controls. This task-level label does not prove the model's internal cause.                                                                                         |
| `INVALID_ACTION`         | A decision references an action unavailable in the observed action space. Runtime `InvalidActionError` distinguishes it from malformed output. The raw-selector arm also records syntax, no-match, multiple-match, and ineligible resolution errors here. |
| `STALE_TARGET`           | Target identity, state, availability, or occlusion changed before input, or repeated freshness recovery could not progress.                                                                                                                               |
| `NAVIGATION_RACE`        | A detected document/URL change interrupted a decision or execution. A document-related `StalePageError` provides the initial signal.                                                                                                                      |
| `OBSERVATION_ERROR`      | The browser snapshot or read-only success oracle could not be obtained or validated. Missing expected elements normally fail the success check rather than throw.                                                                                         |
| `DECISION_ERROR`         | Decision generation failed, the model reported `BLOCKED`, or the model reported `DONE` while the machine oracle failed, without stronger target/error evidence.                                                                                           |
| `EXECUTION_ERROR`        | Browser input could not be confirmed or failed for a reason other than recognized staleness. Uses `ExecutionError` or the execution phase.                                                                                                                |
| `BUDGET_EXCEEDED`        | Action, model-call, or evaluation wall-clock budget was exhausted before a successful verified outcome.                                                                                                                                                   |
| `MODEL_OUTPUT_ERROR`     | Model/TypeSafe output failed its parser or distribution validation. A structurally offered target with invalid probabilities belongs here, not automatically to `INVALID_ACTION`.                                                                         |
| `UNKNOWN`                | Available evidence cannot support a more specific classification, including some setup failures and unexplained unsuccessful terminal states.                                                                                                             |

Concrete wrong-target evidence takes priority over later runtime/terminal failures.
Budgets and typed errors then take priority over generic execution phase. Successful
summaries have `failure_type: null`; they can still contain recovered stale attempts.
Missing audit coverage is unknown, never proof that no wrong target was selected. Keep
original error messages, oracle evidence, and per-step records available when revising
classification.

Live-model runs preserve provider error code/type/message separately from raw model
output. A transport or endpoint failure may be classified as `DECISION_ERROR` by runtime
phase; it remains an infrastructure health failure, not evidence of model reasoning or
grounding quality. Read the original reason and `provider_error` before interpreting
taxonomy counts. A missing or truncated model answer is `MODEL_OUTPUT_ERROR`; usage
objects can show whether reasoning consumed the completion budget.

Target selection and execution are separate measurements. `target_assessment` records
correct/wrong/neutral selection using fixture annotations that never enter the prompt. A
wrong selection prevented by a stale guard is not a wrong-target execution. The primary
taxonomy prioritizes audited executed wrong targets; analysis retains both selection and
execution evidence.
