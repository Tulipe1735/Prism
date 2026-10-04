# Relation ablation v1 — prospective protocol (P0-A / P0-B)

Status: pre-call protocol. The locally frozen version is identified by the file hashes
in `freeze.json`, not by this document's title. No service-model calls have been made
for this block. Scripted controls and mocked HTTP responses are instrument checks only.
This is a post-hoc mechanism hypothesis followed by a prospective evaluation. It is not
an externally registered preregistration.

Historical cohorts, source snapshots and result files stay unchanged. New instruments
live in `evals/relation-ablation/`. Do not append to or resume a historical cohort.

## 1. Research questions

- RQ1: Does target choice follow the requested identity as target position and
  entity–group association change?
- RQ2 (primary): On group-required goals, does an explicit candidate–group reference
  improve first grounding compared with the same group lexemes with unknown references?
- Secondary: Does the R−U effect depend on whether the goal names a local entity or a
  group? How do the original Local and Structural descriptions behave on the same
  states?

H2 predicts positive R−U grounding on group-required goals. Both models are analyzed
separately. A wide interval or a null effect is informative and does not trigger more
repeats. Similar point estimates are not evidence of equivalence or non-inferiority.

## 2. Complete paired design

Eight base pages: four DOM families (section, legend, nested, table), two skeletons
each. Each base page has three position states and two goal conditions. This gives 24
generated HTML pages and 48 task definitions. URLs use opaque content-independent
identifiers. Task IDs and design annotations never enter model payloads.

Each state offers Item 7, Item 12 and Item 31 in Alpha, Beta and Gamma scopes. The
entity–group mapping changes across the three states: every entity appears in every
group, every group visits every candidate position, and each requested group and target
position appears once per base page and condition. The requested entity stays fixed
within a base page, with 3/3/2 base-page counts (9/9/6 cells per condition) across the
three entity names. This lexical imbalance is identical in all arms; per-page pairing
and family sensitivity are retained. The local goal names an entity; the group goal
names its currently associated group. They request the same target in that state. Local
goals are lexical controls; accessible names alone can resolve them. They are not
claimed to require Local context.

Every task runs in all four arms. Each model has 48 × 4 = 192 cells; two models have 384
cells. Within each task, arm dispatch order rotates. Each arm therefore has the same
task, condition, identity and position coverage. Concurrent completion order need not
match dispatch order. There is no random model seed and no additional repeat.

The generator validates all position and association constraints. Generated files must
match `generate.ts --check`. Model metadata has no access to the answer key.

## 3. Treatments

All arms use the same candidate set, page state, shared prompt, historical parser,
executor, validation and budgets. The model-facing payload does not contain the arm
name.

| Arm                   | Description                                                            |
| --------------------- | ---------------------------------------------------------------------- |
| L: indexed-local      | Original Local formatter and original context extractor                |
| U: indexed-unbound    | L plus the canonical group list and unknown `belongs_to` references    |
| R: indexed-bound      | The same list and format, with the candidate's actual group references |
| S: indexed-structural | Original Structural formatter and original context extractor           |

Example for a control that belongs to Beta:

```text
U: groups: [R1: Alpha] [R2: Beta] [R3: Gamma]
   belongs_to: ??
R: groups: [R1: Alpha] [R2: Beta] [R3: Gamma]
   belongs_to: R2
```

Group IDs and list order are canonical by public group text, never by candidate order.
Changing entity–group mapping leaves U unchanged when candidate order is held fixed; R's
reference follows the new mapping. No arm is padded with irrelevant words. Unknown
reference markers may also affect abstention or confidence; local-goal controls and raw
response traces diagnose that boundary. This is not a representation-independent
cognitive-mechanism proof. R/U have identical group-name occurrences, candidate keys and
UTF-8 serialization lengths on every prepared state. Reference symbols necessarily
differ; equal bytes do not establish equal tokenizer cost. Actual provider receipts are
reported separately. The causal treatment is an explicit relation reference, including
its syntax. Do not claim all possible relation representations were isolated or proved
optimal.

The goal-blind public extractor walks up to six ancestors through semantic group scopes
(section, article, fieldset, row, list-item, role=group/row). It reads visible
direct-child headings, legends or group text. It does not read goals or oracle
attributes. Local and Structural do not use this new extractor. Structural is a boundary
comparator: its original heuristic may fail to extract a group on a new skeleton. Do not
silently replace its section field with R's extractor output.

## 4. Models and environment

Models: glm-5.3-flash and deepseek-v4.1-flash. One plan per model. Requested settings:
temperature 0, top_p 1, max_tokens 8192, provider-default reasoning, JSON-object
response. The probability-head parser is the shared historical parser, including
choice/argmax, finite confidence, key membership and normalization checks. There is no
output repair.

Viewport 1120×780; eight decision attempts per task; timeout 240000 ms; up to two HTTP
retries; concurrency four. The HTTP-attempt ceiling is 4200 per model, checked before
each attempt. The serving endpoint and non-secret credential label are recorded. A
changed endpoint is a new serving condition, not an identical historical replication. Do
not silently replace a model. Missing/changed returned model identity stops dispatch.

Preparation machine: Chrome/153.0.8010.52, Node v22.23.2. Historical confirmatory runs
used Chrome/153.0.8010.12. This version difference must be reported; no historical raw
record is rewritten to the new version.

## 5. Dispatch gates and preservation

Before the first real model call:

1. Generated artifacts and offline checks pass. Browser checks cover all pages and
   mock-model execution, plus independent external oracle checks.
2. Both plans pin the tested browser. A null pin is allowed only for scripted
   preparation.
3. Source/configuration, protocol, fixtures, tests and dependency lock have an archive
   and manifest. A verification receipt is tied to the same preparation hash.
4. `--freeze` names that manifest. Dispatch verifies source hashes, archive, Node and
   live browser version before sending a request. A changed file requires a new freeze.
5. Output files must not already exist. Completed cells are appended immediately; an
   interrupted run does not silently overwrite or substitute an earlier cell.

A freeze is a local provenance record, not authorization to spend money. In this
quota-free preparation phase, only scripted or mocked transports are used.

## 6. Endpoints and logs

Primary: first scored executed input is correct, on group-required goals. Invalid
outputs, no-attempt runs and wrong-but-valid choices stay in the planned denominator.
Secondary: strict success (goal oracle, no wrong actions, and explicit policy DONE),
whole-trajectory wrong actions, status, executed steps, provider calls, receipt usage.

Each run stores its first actual payload and per-decision request/response receipt,
model identity, prompt hash, raw content, usage, HTTP-attempt counts and error. Later
HTTP retries can have missing usage; total tokens are unknown in that case, not zero. A
response-format failure is not classified as a semantic wrong action.

Scripted runs select the known control and verify the page oracle. They have zero model
calls and cannot demonstrate policy DONE or model performance. Mock-model browser tests
exercise parsing/execution but are not research trials. Their outputs stay separate.

## 7. Analysis

- Primary R−U on group goals: pair identical task cells, then average three position
  differences within each base page. Bootstrap the eight page clusters, seed 1735, 2000
  draws. Positions and actions are not independent samples.
- Report all per-page effects, family means and leave-one-family-out sensitivity.
- Secondary interaction: within each page, group-goal R−U minus local-goal R−U.
- Report incomplete cells separately from completed failed cells. Partial paired
  comparisons are diagnostic; a complete prospective claim requires the planned block.
- Report original S−L and R−S as secondary contrasts. S can lack required identity; that
  is an extractor boundary, not proof that richer information harms the model.
- No aggregate iid Wilson interval is used as the primary evidence. No adaptive
  non-inferiority, cost superiority, SOTA or general-browser claim follows from this
  block.

## 8. Decision and stopping rules

Stop at 384 planned cells, or a provider, identity, budget or frozen-control failure.
Keep interrupted artifacts. Do not tune tasks, representations or repeat counts based on
interim results. Changing a control or hypothesis creates a new study version.

If R−U is positive on both models, its page-cluster interval excludes zero and dropping
one family does not flip the direction, the results support this explicit relation
reference in these controlled states. If R≈U, retain an inconclusive mechanism result;
only if both also improve on L can shared group exposure remain a plausible explanation.
If R cannot follow mapping changes, downgrade the proposed mechanism. A negative S
result is interpreted with its observed extractor coverage. No outcome licenses broad
web generalization. The separate small external transfer plan remains necessary to
expand the claim's scope.

## 9. Offline endpoint audit

Existing confirmatory/replication/external trajectories are analyzed separately.
Original raw labels remain next to derived labels. Multiple legitimate targets in a
multi-step contract are not automatically an oracle defect. An ancestor coverage gap
requires an independent activation check; a hidden future-step control is not a
permanent capability gap. These checks consume no model quota.
