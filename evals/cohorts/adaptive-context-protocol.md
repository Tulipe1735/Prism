# Adaptive context expansion v1: frozen pilot protocol

Defined before model calls. Stop and analyze after 12 tasks × 3 repeats × 4 arms = 144
runs. Do not extend, replace failures, select tasks using new outcomes, tune the policy,
alter fixtures, or resume the historical ambiguity-initial cohort.

## Method

Eval-only indexed-adaptive uses the existing actionSpace eligible candidates and
formatTarget formats. All candidates initially use compact. Within each operation,
compare formatted descriptions with an empty constant index (IDs cannot resolve semantic
ambiguity), collapse whitespace, and trim. Preserve casing. Values remain in every
format exactly as before. Compare actual truncated descriptions, not richer source
strings. Any group of at least two equal descriptions is a collision. Promote only
candidates in colliding groups to role, then local, then structural; recompute
collisions over the mixed representation after each promotion. Stop when unique or when
no candidate can expand further. Report remaining collisions as unresolved; do not
modify model decisions, execution or retry behavior.

Operation scopes mirror existing target distributions. Hidden/disabled eligibility
belongs to the unchanged snapshot; no extra filtering, oracle attributes, task goal,
embedding, LLM, or result-driven heuristics enter the detector. Local and structural
formats/extractor limits are unchanged. Structural reuses container + nearby_text +
section rather than inventing a new format. Thus format levels are the historical
formats, not a new cumulative representation. An observation's final level is its
maximum candidate level. Candidate levels remain separately logged.

Each observation logs initial/final level, count, booleans and number of collision
groups at compact/role/local, full counterfactual collision groups at all four levels,
per-candidate final levels, whether any candidate needed structural, remaining
mixed-format unresolved groups, exact representation characters and estimated tokens.
Counterfactual collision counts describe the whole candidate set at a fixed level;
actual candidate_levels describe the adaptive path. Audit metadata and representation
names are omitted from model requests. Representation tokens = ceil(UTF-8 bytes/4),
including serialized target map syntax, plus public DOM only for the selector reference.
This is a cost estimate, not a GLM tokenizer count.

## Fixed task design

| Task         | Mechanism                                   | Origin                          |
| ------------ | ------------------------------------------- | ------------------------------- |
| adaptive-001 | Repeated Delete, distinct item text         | historical task 001 unchanged   |
| adaptive-005 | Repeated Delete, order numbers              | historical task 005 unchanged   |
| adaptive-007 | Draft nested inside team sections           | historical task 007 unchanged   |
| adaptive-008 | Hidden duplicate with eligible distractor   | historical task 008 unchanged   |
| adaptive-009 | Disabled duplicate with eligible distractor | historical task 009 unchanged   |
| adaptive-012 | Account local label, region section         | historical task 012 unchanged   |
| adaptive-013 | Open button vs link                         | historical task 013 unchanged   |
| adaptive-015 | Similar Atlas entities                      | historical task 015 unchanged   |
| adaptive-016 | Invoice local label, fieldset legend        | historical task 016 unchanged   |
| adaptive-101 | Unique Save profile button                  | new fixed unique-target fixture |
| adaptive-102 | Unique Open dashboard link                  | new fixed unique-target fixture |
| adaptive-103 | Unique Export report button                 | new fixed unique-target fixture |

The three new easy fixtures reuse the historical support script, oracle convention,
status feedback and budgets; target positions are counterbalanced. No historical fixture
changes. New task IDs distinguish cohort cells. Selection is based on stated mechanism
categories and the prior study's known structural cases, before new runs. This is a
focused convenience set, not a held-out or unbiased open-web sample.

## Controls and freezing

indexed-local, indexed-structural, indexed-adaptive and raw-selector reference.
glm-5.3-flash, temperature 0, top_p 1, 8192 output tokens, provider-default reasoning,
Chrome/153.0.8010.12, viewport 1120×780, 8 action steps, 240 s per run, 2 HTTP retries,
5 stale retries, fixture port 9841, concurrency 4, original chat-heads-v2 system/task
prompt format, original agent loop/executor/oracle/modalPolicy observed. Cohort call
ceiling 1500 is a pilot stop guard (historical 6000 for 800 planned runs); per-run
budgets remain identical. Existing runner endpoint/model-drift stop behavior is
retained. No automatic rerun of failed tasks. Preserve all outcomes and HTTP retries.

Before model calls, save a freeze manifest with task-file/config/source/fixture/prompt
hashes, model settings, browser/runtime, historical file hashes and environment drift.
Archive source, tests, new tasks/config/protocol, fixtures and dependency lockfile. The
runner also saves its control hash and ordered planned cells before scheduling. Never
mutate source, policy, tasks, configuration or fixtures after this freeze.
Analysis/report artifacts may be produced after outcomes, without policy changes.

## Metrics and interpretation

Report all planned/completed cells, task success, correct scored target selections /
scored target attempts, wrong executed target inputs / audited executed inputs, any
wrong-target run rate, semantic ambiguity failures / completed runs, invalid choices /
action attempts, invalid output runs separately, averages of steps/calls/latency over
all completed runs, representation tokens / all policy observations (including terminal
and failed requests), and total arm representation tokens / successful task (including
failed-run overhead). Also give successful-runs-only tokens / successful task.

Show initial-observation cost and adaptive levels separately: after a successful click
one eligible target disappears and terminal observations can become cheaper. Level
fractions use observations, supplemented by candidate-level fractions. Escalation means
collision-driven use, not proof that richer context was causally necessary. Compare
matched task/repeat cells; report per-task outcomes, task-cluster bootstrap intervals
for adaptive-minus-structural success and run-level wrong-target differences, and
initial-observation representation savings. With only 12 tasks/3 repeats, matching point
estimates does not establish noninferiority or universal reliability.

For each adaptive failure inspect raw output, formatted candidates, collisions, level,
chosen/executed target, and oracle. Classify detector false negative/false positive,
insufficient local/structural context, output-format failure, decision error, execution
error, or unrelated infrastructure. Preserve a trace for every failure and explain
causal uncertainty; failure co-occurrence alone cannot establish detector causation.
Identify suspected unnecessary structural expansions or premature stopping without
claiming counterfactual proof. Raw-selector remains a reference arm because it receives
DOM and uses a different target interface. No larger cohort is authorized automatically.
