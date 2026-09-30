# Prism reliability evaluations

The eval system records where Prism fails and tests whether its reliability mechanisms
help. It reuses `runAgent`, `BrowserSession`, `actionSpace`, the production decision
parser/validator, HTTP transport, stale guards, budgets, and executor. A model saying
`DONE` is insufficient: an independent DOM oracle checks the goal and a monotonic
wrong-target counter. An execution/model error makes the run unsuccessful even if
intermediate state briefly satisfied the goal.

## Current benchmarks

- `tasks/core.json`: 14 scripted mechanism tasks (including a deliberate malformed
  distribution). These are regression controls, not live-model evidence.
- `tasks/primary.json`: 24 live-model tasks: five grounding, six dynamic/stale, eleven
  ambiguity, one form, and one single-page navigation task. Repeated Delete, Submit, and
  Continue controls appear in table rows, forms, cards, and sections. Correct controls
  vary in position. There are no random timers or external fixture requests.
- Reordering is a negative control: moving the same node need not invalidate its
  identity. Other dynamic fixtures replace nodes, rerender, change a value, introduce a
  modal, or remove and replace a control. Each mutation is acknowledged and runs once
  after the first targeted decision, before execution. A model can fail before
  encountering the perturbation; record this lack of exposure rather than infer a
  recovery effect from every task labelled stale.

The independent browser integration test verifies all 24 fixture success conditions
using known correct inputs. That fixture verification is not a model benchmark.

## Reproduce the fixed-model cohort

Use Node >=22.19 and the existing pnpm dependencies. Start Chrome/Chromium with a
separate profile on the same machine as the loopback fixture server:

```sh
google-chrome --headless --remote-debugging-port=9333 \
  --user-data-dir=/tmp/prism-eval-chrome about:blank
pnpm install --frozen-lockfile
pnpm eval:cohort --config evals/cohorts/smoke.json --smoke \
  --output evals/results/smoke.jsonl
pnpm eval:cohort --config evals/cohorts/pilot.json \
  --output evals/results/pilot.jsonl
pnpm eval:report evals/results/pilot.jsonl --output evals/reports/pilot.md
```

`pilot.json` fixes `glm-5.3-flash` via OpenCode Go at temperature 0 and top_p 1,
max_tokens 8192, provider-default reasoning (no unsupported reasoning control is sent),
viewport 1120 × 780, eight executed actions, two HTTP retries, five execution stale
retries, 240-second task deadline, and four concurrent owned tabs. The primary pilot has
24 × 3 × 4 = **288 planned runs**. The browser is pinned to the version used for this
experiment. For a new experiment, install that version or set a new pin before
beginning; do not change it between arms. The per-request timeout is 120 seconds.
Preflight identified unsupported native reasoning controls, a 2,048-token budget
exhausted entirely by reasoning, and dynamic goals describing invisible mutation
preconditions. These setup runs are archived; the primary set uses plain user goals and
the same larger budget for all arms. GLM-5.3-Flash uses forced thinking according to the
[model provider documentation](https://docs.z.ai/guides/capabilities/thinking-mode). The
configs declare requested model settings; provider internals/determinism are not under
the harness's control.

The API key comes from `TEXT_MODEL_API_KEY` in the environment or the repository's
`.env`. Keys and authorization headers are never logged. The existing endpoint-specific
session header is reused; each run has one conversation/session id. See the provider's
[Go documentation](https://opencode.ai/docs/go/) for endpoint setup.

Before the main stage, inspect the pilot for completeness, endpoint/oracle/browser
errors, changed controls, per-task failure types, and repeat variance. Model grounding
or malformed-output failures are findings, not reasons to delete/retry observations.
Infrastructure failures make the primary comparison incomplete or unhealthy. If the
pilot is healthy, run the separate 24 × 5 × 4 = **480-run main cohort**:

```sh
pnpm eval:cohort --config evals/cohorts/main.json \
  --output evals/results/main.jsonl
pnpm eval:report evals/results/pilot.jsonl evals/results/main.jsonl
```

The report keeps stages separate. Five repeats are the planned main cohort, not an
automatic increase to ten. Selective 10–20-repeat extensions for unstable tasks should
use a separate explicit config/output and be identified as follow-up experiments. Do not
pool different models into the primary comparison.

A deterministic balanced rotation interleaves variants across tasks/repeats rather than
running one entire arm first. JSONL writes are serialized as complete run batches. A
sidecar contains the frozen plan, hashes, expected/completed runs, status, and call
budget. Already completed failed runs are retained. Interrupted active runs have no
summary and can be rerun on resume; they must not be mistaken for completed runs:

```sh
pnpm eval:cohort --config evals/cohorts/pilot.json \
  --output evals/results/pilot.jsonl --resume
```

Resume refuses changes to source, fixture, task, prompt, browser or config. Endpoint
400/401/402/403/429, exhausted transient connection/5xx failures, a returned model
mismatch, or the cohort call cap stop new dispatches; already active tasks settle and
remain recorded. Normal task failure does not stop the cohort. A nonzero exit or
incomplete sidecar means the planned comparison has not completed. The separate smoke
run selects two tasks across all four arms; it is excluded from primary estimates.
Preflight prompt and harness debugging results are preserved under `results/preflight/`,
not pooled into pilot/main. The first pilot attempt sent an unsupported reasoning_effort
parameter and is preserved as an invalid preflight cohort; its outcomes are excluded
from primary estimates. Milestone 1 data is preserved under
`results/archive-milestone-1/`.

## Completed fixed-model experiment

The pilot and main completed all 288 and 480 planned runs, respectively, with no
endpoint errors or changed controls. See [interpretation](reports/interpretation.md) for
supported conclusions and limitations, [summary](reports/summary.md) for all metrics and
per-task rates, and [failure analysis](reports/failure-analysis.md) for the failure
index and ten actual traces. Pilot/main health audits are in `reports/`. All raw results
and their frozen plans are retained in `results/`; the exact source snapshot is
`results/primary-source.tar.gz`. Smoke and invalid preflight runs are excluded from the
primary estimates. Richer-context variants and selective repeat extensions remain
separate follow-up experiments.

## Four variants and experimental limits

| Variant                   | Changed mechanism                                      | Retained behavior                                                                        |
| ------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `prism-full`              | None                                                   | Indexed targets, production validation and recovery                                      |
| `prism-no-stale-recovery` | Fail at detected stale state                           | Freshness checks, target mapping, hit testing and observation settling                   |
| `prism-no-validation`     | Skip distribution, argmax and confidence validation    | Operation/target membership, indexed mapping, executor and stale checks                  |
| `raw-selector`            | Model generates CSS selector and selector alternatives | Same model/prompt, task, DOM evidence, budget, validation, oracle, executor and recovery |

The shared live policy uses an OpenAI-compatible chat endpoint and passes actual model
probability heads through Prism's parser. It does **not** invent one-hot probability
heads for indexed decisions. These are self-reported distributions/confidences, not
calibrated probabilities or model logits. The production CLI/MCP TypeSafe transport and
model remain unchanged. Therefore results describe the shared generative policy plus
Prism's mechanisms, not the production TypeSafe model's reliability.

Every arm receives the same page text and sanitized visible DOM, excluding scripts,
hidden oracle counters, `data-*` audit markers, and ground-truth attributes. Indexed
arms also receive target ids; the selector arm receives the same target descriptors
under descriptive candidate names, and must generate CSS itself. That output/action
space difference is the treatment. Full prompt inputs, surrounding DOM context, prompt
hash, raw output, model name, confidence, token usage and provider fingerprint are
retained for inspection. This DOM supplement differs from production's normal compact
observation. Indexing may benefit from DOM order in this controlled setting.

Selectors must match exactly one eligible observed node (and a matching option value for
SELECT). Syntax, no-match, multiple-match, and ineligible selections are recorded
separately. The runner never picks the first of several matches, invents a selector, or
falls back to an indexed choice. It resolves the generated selector before the injected
mutation and then runs the existing indexed executor/guards. This is the smallest
baseline that isolates target generation while retaining execution behavior; it does not
measure an independent agent or a locator engine that automatically re-resolves
selectors after mutation.

Validation checks structural consistency. It cannot identify a semantically wrong
control with a valid distribution. No-validation still rejects unknown target ids, so it
is a narrow validation ablation, not arbitrary unsafe execution.

## Logs, metrics and reports

Strict schema-v3 JSONL rows have experiment, run, task, repetition, category, provider
and variant ids. Steps include every rejected/terminal decision, selected action/node,
selector and its resolution failure, execution status, output validity, wrong-target
execution, target assessment, retries, stale detection/recovery, latency, actual HTTP
calls, raw model output and model input. Summaries include independent oracle evidence,
status/reason, budgets and aggregate metrics. Token fields are null when not reported;
missing audit coverage is unknown, never zero. Private fixture audit reads never enter
model inputs.

Metadata includes task/fixture/runtime-source/dependency hashes, Git revision/dirty
state, browser/Node/Prism versions, actual returned models, cohort config/hash and
system/task prompt hashes. The sidecar records planned pairs and whether the cohort
completed. Data is buffered until each run finishes; an abrupt process exit can lose
active work, while completed run batches remain readable. JSONL and sidecars are
Git-ignored; preserve/copy them with reports when sharing a benchmark. Old schemas are
archived rather than silently migrated.

| Metric                | Definition                                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Task success rate     | Successful oracle-checked runs / completed runs                                                                             |
| Invalid action rate   | Invalid nonterminal proposed actions / nonterminal attempts                                                                 |
| Invalid outputs       | Turns failing distribution/argmax validation, including outputs accepted by the no-validation arm                           |
| Invalid selector rate | Syntax, no-match, multiple-match or ineligible selectors / proposed selector attempts                                       |
| Wrong target rate     | Wrong executed click/fill/select actions / executed actions with fixture audit coverage                                     |
| Correct target rate   | Correct scored target selections / correct-or-wrong scored selections, including abandoned stale selections                 |
| Grounding error rate  | Wrong target selections plus invalid selectors / mapped selected actions (including control actions) plus invalid selectors |
| Stale recovery rate   | Detections followed by executed input at the same agent action step / detections                                            |
| Steps                 | Executed actions; reported for all runs and successful runs separately                                                      |
| Retries               | Agent stale recovery attempts + repeated HTTP attempts; HTTP retries also recorded separately                               |
| LLM calls             | Actual HTTP attempts, including failed attempts and retries                                                                 |
| Tokens                | Provider-reported input/output/total counts; n/a if incomplete                                                              |
| Latency               | Per-attempt/task wall time, including setup/oracles/cleanup                                                                 |
| Failure distribution  | Primary failure per unsuccessful run, with recovered step failures retained                                                 |

Recovery is a mechanism metric, not proof of task success. Internal observation settling
retries are not exposed separately. Grounding errors can be attempted but prevented from
execution. An offered action can be valid and still hit the wrong semantic target.
Report these distinctions rather than conflate all failures.

`pnpm eval:report` requires explicit current-schema JSONL inputs. It writes
`reports/summary.md` and `reports/failure-analysis.md` (5–10 diverse actual failure
traces when available, plus an index of every failure). It rejects duplicate records and
warns about mismatched controls/task-repeat cohorts. Aggregate success intervals use a
deterministic task-cluster bootstrap (2,000 draws); per-task Wilson intervals and
per-task success-rate SD are also reported. Repeated runs are not treated as independent
tasks. Per-task intervals assume independent repeats, which shared provider effects can
violate. These small convenience tasks do not represent the web.

## Scripted controls and individual runs

```sh
pnpm eval --list
pnpm eval --category grounding
pnpm eval --task stale-001 --variant prism-no-stale-recovery
pnpm eval --task grounding-002 --provider model \
  --cohort evals/cohorts/pilot.json --variant raw-selector
```

The default scripted provider makes no model requests and selects from actual observed
actions through the production chooser. Raw selectors require the real-model provider.
The repeated-label scripted driver deliberately chooses the first matching label; its
failure is preserved and does not establish real-model ambiguity performance. Controlled
scripted validation faults are excluded from the live primary cohort.

## Failure taxonomy and extension

The central typed enum is `schema.ts`. See
[the failure taxonomy](../docs/evals/failure-taxonomy.md): `ACTION_GROUNDING_ERROR`,
`SEMANTIC_AMBIGUITY`, `INVALID_ACTION`, `STALE_TARGET`, `NAVIGATION_RACE`,
`OBSERVATION_ERROR`, `DECISION_ERROR`, `EXECUTION_ERROR`, `BUDGET_EXCEEDED`,
`MODEL_OUTPUT_ERROR`, `UNKNOWN`. Classification uses concrete wrong-target evidence,
typed errors, runtime phase and budget reason; it preserves unknowns instead of guessing
a model's intent.

To add a task:

1. Add local HTML under `fixtures/<category>/` with independently observable output and
   a monotonic wrong-target counter. Existing fixtures demonstrate the private
   `data-target`/`data-correct` convention. Do not expose correctness through visible
   names, ids or classes. Private markers must be stripped from policy inputs.
2. Add a unique task in a JSON array: id, relative fixture URL, goal, category,
   machine-checkable success checks (text/value/attribute/URL), optional budget and
   mutation metadata. The scripted plan is optional for live runs.
3. For dynamic tasks add an acknowledged one-shot mutation in `support.js`. Avoid
   randomness and timing lotteries. Oracle-check the mutation count.
4. Verify correct inputs and deliberate wrong inputs in browser tests before using the
   task in a cohort. Change hashes/experiment output for a revised task set.

## Verification and next milestone

```sh
pnpm typecheck
pnpm lint
pnpm test
PRISM_EVAL_CHROME=1 PRISM_IT_CHROME=1 \
  PRISM_IT_BROWSER_URL=http://127.0.0.1:9333 pnpm test
pnpm build
```

Fixed compact, role, local and structural representations and the eval-only adaptive
policy are available in separate representation studies. Keep model and per-run budgets
fixed, measure grounding and representation cost, and use a new frozen cohort for each
method comparison. WebArena, BrowserGym, open-web coverage, calibrated confidence, and
long-horizon generalization remain deferred.

## Milestone 3: controlled action descriptions

Historical setup commands below are retained for provenance. `ambiguity-initial` is
frozen; do not run, resume, extend or regenerate its results during the adaptive study.

The focused cohort has 16 tasks and four indexed formats: `indexed-compact`,
`indexed-role`, `indexed-local`, and `indexed-structural`. A `raw-selector` reference
uses public locator DOM and is labelled separately. See the predeclared
[protocol](cohorts/ambiguity-protocol.md) for extraction bounds, metric denominators,
and selective-repeat criteria. All indexed formats use identical status-only page text;
no global text or DOM dump supplies the missing entity-to-index mapping.

```sh
pnpm eval:cohort --config evals/cohorts/ambiguity-smoke.json
pnpm eval:cohort --config evals/cohorts/ambiguity-initial.json
node --experimental-strip-types evals/runners/ambiguity-report.ts select evals/results/ambiguity-initial.jsonl
pnpm eval:cohort --config evals/cohorts/ambiguity-extension.json
node --experimental-strip-types evals/runners/ambiguity-report.ts report evals/results/ambiguity-initial.jsonl evals/results/ambiguity-extension.jsonl
```

The extension config is generated only if tasks meet the recorded rule. Initial runs
remain the balanced primary comparison; extension repeats use indices 10–19.
`representation_cost` records each observation's candidates, exact characters,
UTF-8-byte/4 estimated tokens and per-candidate costs. Provider usage measures whole
prompts and remains separate. The estimator is not the model tokenizer.

The delayed-modal intervention is separate, uses the unchanged original fixture and
ordinary role descriptions with the existing DOM supplement:

```sh
pnpm eval:cohort --config evals/cohorts/modal-before.json
pnpm eval:cohort --config evals/cohorts/modal-after.json
```

`modalPolicy: active-dialog` is an eval-only candidate filter; production snapshot,
CLI/MCP and executor are unchanged. It is not a general occlusion algorithm. See
[diagnosis](reports/delayed-modal-root-cause.md). The ambiguity cohort rejects this
intervention and reliability ablations.

The first live study's schema-v2 results and reports are preserved. To reproduce that
historical harness, use `results/primary-source.tar.gz`; current parsers read schema v3
and do not silently migrate archived runs. Keep schema-specific raw data and source
snapshots with each experiment. Do not regenerate the old `summary.md` using the new
schema or pool historical wide-DOM results with this bounded study.

## Adaptive context expansion pilot

`indexed-adaptive` is eval-only. It promotes only colliding eligible candidate groups
within an operation through compact → role → local → structural. Comparison uses the
actual bounded formatted descriptions, ignores IDs, normalizes whitespace and preserves
case. Remaining structural collisions are logged rather than resolved by a hidden
heuristic. Production CLI/MCP defaults, execution, validation and retries are unchanged.

The fixed `ambiguity-adaptive-v1` pilot has 12 tasks × 3 repeats × local/structural/
adaptive/raw-selector = 144 runs. See [protocol](cohorts/adaptive-context-protocol.md),
[freeze manifest](cohorts/ambiguity-adaptive-v1.freeze.json), and
[study report](reports/adaptive-context-study.md). The report separates conditional
correct-target accuracy, task success, wrong executed targets, output failures,
initial/all-observation estimated context costs and terminal-observation overhead.

The completed result JSONL, sidecar and source archive are in `results/`. Every adaptive
failure has a complete trace under `reports/adaptive-context-traces/`. Do not rerun
completed failures or automatically expand this pilot; a larger study requires a new
protocol/cohort. Raw-selector remains a reference arm because it receives public DOM and
generates locator syntax.
