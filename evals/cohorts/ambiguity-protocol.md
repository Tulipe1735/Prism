# Fixed action-representation protocol

This protocol is recorded before the initial live cohort. Initial: 16 tasks × ten
repeats × four indexed representations, plus a raw-selector reference (800 runs). All
indexed arms keep the same model/settings/system prompt/task prompt format, status-only
page evidence, candidates, validation, recovery, browser/viewport, executor, budgets and
oracle. Only the formatted target descriptions vary. Raw selectors need public locator
DOM and are reported as a reference rather than a causal arm.

- Compact: id + accessible name.
- Role: id + role + accessible name.
- Local: role format + nearest semantic container's visible non-control text, capped at
  80 characters.
- Structural: role format + container type, up to 120 characters of local non-control
  text, and up to 48 characters of the section heading when not duplicated.

Parent search is bounded to six ancestors. Text traversal is bounded to 200 nodes.
Scripts, hidden/inert text, fixture audit markers and private attributes are excluded.
Candidates already omit hidden/disabled controls in every indexed arm. Public state
values remain available identically. Full page text and DOM structure are deliberately
withheld from indexed arms; that information would defeat the intended comparison. The
model cannot infer entity-to-index mappings in some compact cases. BLOCKED and wrong
guesses are both legitimate outcomes and remain in the results.

Candidate count and exact representation characters include target-map JSON syntax.
Estimated tokens use ceiling(UTF-8 bytes / 4), not a model-specific tokenizer. Provider
prompt/output usage measures the whole call and is retained separately. Report initial
and all-observation sizes to distinguish representation cost from state/action effects.
Correct-first-target per run, conditional accepted-target accuracy, wrong executed
inputs, and task success must remain distinct.

Follow-up rule: rank tasks with any indexed-arm success between 20% and 80%, or
local/structural success within 20 percentage points with at least one mixed outcome.
Score = number of mixed indexed arms + close-context indicator + sum of per-arm
Bernoulli variances. Break ties by task id. Extend at most four tasks with ten further
repeats (indices 10–19), for all five arms. Report this selected extension separately;
do not replace outcomes or treat its nonuniform task sample as the balanced primary
comparison. This rule avoids increasing every task uniformly and avoids selection on
whether an intervention produces a favorable result.

Task-cluster bootstrap intervals preserve repeated observations within each task. No
production default changes are part of this study. Recommend a representation only when
the observed grounding/success improvement has a clear cost tradeoff; if adjacent
formats are statistically unresolved or gains occur only in special nested cases, prefer
the simpler default or leave context optional. This small convenience cohort cannot
prove a universal saturation point or open-web performance.

Modal diagnosis is separate: ten fixed-model repeats of the unchanged delayed-modal
fixture before and after an eval-only native-dialog candidate filter. No representation
arms, validation changes, or fixture edits are mixed into that diagnostic comparison.

Pre-primary setup note: the first 15-run connectivity smoke used ordered containers and
generic Completed feedback. It is preserved under `results/preflight/` and excluded from
study estimates. Before the balanced cohort, layouts were deterministically permuted to
reduce semantic-name/ordinal shortcuts. Correct eligible positions are counterbalanced
across the focused tasks. Public post-action messages identify the entity actually acted
on, for correct and wrong actions alike; they are Pending before input. This makes
completion evidence shared and explicit rather than requiring ambiguous target
descriptions to also prove termination. Fixtures, permutations and success checks are
frozen identically for every arm. The representation identifier is logged but omitted
from the model request, so only the formatted descriptions differ between indexed
prompts for the same pre-action state.
