# Paper Confirmatory Study v1

## Experimental Setup

**COMPLETE AND AUDITED: 240/240 unique planned terminal summaries.**

Historical ambiguity-initial, adaptive pilot, stale/validation and delayed-modal studies
are exploratory evidence. Their raw results, reports, tasks, fixtures and cohort files
were preserved; none are pooled here.

Preregistered 12 new controlled tasks (4 unique, 4 local, 4 structural) × 5 repeats × 4
variants. Model glm-5.3-flash, temperature 0, top_p 1, max_tokens 8192, provider-default
reasoning; OpenCode Go; Chrome/153.0.8010.12; Node v22.23.2; viewport 1120×780; 8
actions; 240s task deadline; 120s request timeout; up to 2 preregistered HTTP retries, 5
stale retries, 4 concurrent tabs, cohort cap6500 calls. Freeze 2026-10-01T03:14:08.358Z.

Primary causal contrasts: Adaptive versus Local, Adaptive versus Structural.
Raw-selector-reference receives extra public locator DOM and generates CSS; it is a
descriptive reference arm. Indexed arms share status-only page text and differ in action
descriptions. The pilot policy/extractor/formatter/prompts are unchanged.

Grounding Success scores the first audited target execution independently of later
termination. Strict Task Success requires DONE, no runtime error, full final oracle and
zero wrong inputs. Correct-click/later-provider-error runs remain grounding successes.
Five repeats are matched by task and repetition; 95% CIs resample 12 task clusters
(2,000 bootstrap draws, seed1735), and strata resample their 4 task clusters. No
non-inferiority margin or equivalence claim.

Protected historical audit: 119 files, 0 changed. Exact snapshot:
evals/results/paper-confirmatory-v1-source.tar.gz (SHA256
70f9216fae88778483c16aa9e6b5b437c3834c5ad19ceef1bb10c8d6bcc59408).
Freeze/config/task/source/prompt/fixture controls are verified before execution/resume
and each dispatch.

Environment drift from pilot:
{"node":{"previous":"v22.23.2","current":"v22.23.2"},"browser":{"previous":"Chrome/153.0.8010.12","current":"Chrome/153.0.8010.12"},"model":{"previous":"glm-5.3-flash","current":"glm-5.3-flash"},"source":"Eval-only
confirmatory instrumentation/runner/report; adaptive policy, extractor, formatter,
prompt and production runtime retained.","fixtures":"Twelve new controlled fixtures;
historical files protected by pre-edit inventory.","provider_internals":"Not
reproducibly controlled; fingerprints and returned model IDs retained per response."}.

| Task                | Class      | Expected minimum | Goal                              |
| ------------------- | ---------- | ---------------- | --------------------------------- |
| paper-unique-01     | unique     | compact          | Save profile.                     |
| paper-unique-02     | unique     | compact          | Open dashboard.                   |
| paper-unique-03     | unique     | compact          | Export report.                    |
| paper-unique-04     | unique     | compact          | Archive project.                  |
| paper-local-01      | local      | local            | Delete item Cedar.                |
| paper-local-02      | local      | local            | Submit the Museum application.    |
| paper-local-03      | local      | local            | Open order 7302.                  |
| paper-local-04      | local      | local            | Edit the Atlas workspace.         |
| paper-structural-01 | structural | structural       | Delete Draft in Team South.       |
| paper-structural-02 | structural | structural       | Submit the Supplier invoice.      |
| paper-structural-03 | structural | structural       | Open Account in Region East.      |
| paper-structural-04 | structural | structural       | Continue Setup in Project Harbor. |

local-04 intentionally includes unrelated hierarchical Help collisions; its requested
Edit target needs only local context. Final level is the maximum across all candidates.
This can expose unnecessary policy expansion. Positions are globally balanced; these
authored fixtures are not a held-out natural-web sample.

## RQ1 — Action Representation and Grounding

Structural context helped where headings/legends were required: structural-class
grounding was 18/20 with Structural and 18/20 with Adaptive, versus 5/20 with Local.
Structural minus Local was 65.00 [10.00, 100.00] percentage points (95% task-cluster
CI); Adaptive minus Local was 65.00 [20.00, 95.00] pp. On local-class tasks, Local
already achieved 18/20 grounding and no wrong inputs; richer context did not show a
consistent advantage. Unique-class rate differences included response-format failures
rather than observed wrong inputs. Overall Adaptive minus Local grounding was 26.67
[6.67, 50.00] pp. The evidence supports matching semantic scope to the ambiguity class,
within these fixtures, rather than universal improvement from richer descriptions.

| Class      | Variant                | Grounding Success | Correct Target Rate | Wrong Target Rate | Any wrong run | Semantic ambiguity failure | Invalid Action Rate | Strict Task Success |
| ---------- | ---------------------- | ----------------- | ------------------- | ----------------- | ------------- | -------------------------- | ------------------- | ------------------- |
| overall    | indexed-local          | 66.7% (40/60)     | 56.8% (46/81)       | 43.2% (35/81)     | 23.3% (14/60) | 23.3% (14/60)              | 0.0% (0/94)         | 60.0% (36/60)       |
| overall    | indexed-structural     | 88.3% (53/60)     | 88.3% (53/60)       | 11.7% (7/60)      | 1.7% (1/60)   | 1.7% (1/60)                | 0.0% (0/67)         | 83.3% (50/60)       |
| overall    | indexed-adaptive       | 93.3% (56/60)     | 100.0% (56/56)      | 0.0% (0/56)       | 0.0% (0/60)   | 0.0% (0/60)                | 1.7% (1/60)         | 88.3% (53/60)       |
| overall    | raw-selector-reference | 95.0% (57/60)     | 100.0% (57/57)      | 0.0% (0/57)       | 0.0% (0/60)   | 0.0% (0/60)                | 1.6% (1/61)         | 88.3% (53/60)       |
| unique     | indexed-local          | 85.0% (17/20)     | 100.0% (17/17)      | 0.0% (0/17)       | 0.0% (0/20)   | 0.0% (0/20)                | 0.0% (0/20)         | 75.0% (15/20)       |
| unique     | indexed-structural     | 90.0% (18/20)     | 100.0% (18/18)      | 0.0% (0/18)       | 0.0% (0/20)   | 0.0% (0/20)                | 0.0% (0/20)         | 85.0% (17/20)       |
| unique     | indexed-adaptive       | 95.0% (19/20)     | 100.0% (19/19)      | 0.0% (0/19)       | 0.0% (0/20)   | 0.0% (0/20)                | 0.0% (0/20)         | 90.0% (18/20)       |
| unique     | raw-selector-reference | 95.0% (19/20)     | 100.0% (19/19)      | 0.0% (0/19)       | 0.0% (0/20)   | 0.0% (0/20)                | 4.8% (1/21)         | 75.0% (15/20)       |
| local      | indexed-local          | 90.0% (18/20)     | 100.0% (18/18)      | 0.0% (0/18)       | 0.0% (0/20)   | 0.0% (0/20)                | 0.0% (0/20)         | 85.0% (17/20)       |
| local      | indexed-structural     | 85.0% (17/20)     | 70.8% (17/24)       | 29.2% (7/24)      | 5.0% (1/20)   | 5.0% (1/20)                | 0.0% (0/27)         | 75.0% (15/20)       |
| local      | indexed-adaptive       | 95.0% (19/20)     | 100.0% (19/19)      | 0.0% (0/19)       | 0.0% (0/20)   | 0.0% (0/20)                | 5.0% (1/20)         | 90.0% (18/20)       |
| local      | raw-selector-reference | 100.0% (20/20)    | 100.0% (20/20)      | 0.0% (0/20)       | 0.0% (0/20)   | 0.0% (0/20)                | 0.0% (0/20)         | 100.0% (20/20)      |
| structural | indexed-local          | 25.0% (5/20)      | 23.9% (11/46)       | 76.1% (35/46)     | 70.0% (14/20) | 70.0% (14/20)              | 0.0% (0/54)         | 20.0% (4/20)        |
| structural | indexed-structural     | 90.0% (18/20)     | 100.0% (18/18)      | 0.0% (0/18)       | 0.0% (0/20)   | 0.0% (0/20)                | 0.0% (0/20)         | 90.0% (18/20)       |
| structural | indexed-adaptive       | 90.0% (18/20)     | 100.0% (18/18)      | 0.0% (0/18)       | 0.0% (0/20)   | 0.0% (0/20)                | 0.0% (0/20)         | 85.0% (17/20)       |
| structural | raw-selector-reference | 90.0% (18/20)     | 100.0% (18/18)      | 0.0% (0/18)       | 0.0% (0/20)   | 0.0% (0/20)                | 0.0% (0/20)         | 90.0% (18/20)       |

Correct target rates are conditional on scored accepted selections, including stale
proposals. Wrong-target rates count executed audited inputs; any-wrong run rate exposes
trajectory contamination. Missing oracle coverage is not zero. Primary semantic-failure
counts may coexist with later infrastructure events.

### Per-task results

Each cell: grounding / strict / runs; W = wrong executed inputs.

| Task                | Local       | Structural | Adaptive   | Selector reference |
| ------------------- | ----------- | ---------- | ---------- | ------------------ |
| paper-unique-01     | 5/3/5; W=0  | 3/3/5; W=0 | 5/4/5; W=0 | 4/3/5; W=0         |
| paper-unique-02     | 2/2/5; W=0  | 5/5/5; W=0 | 5/5/5; W=0 | 5/4/5; W=0         |
| paper-unique-03     | 5/5/5; W=0  | 5/4/5; W=0 | 5/5/5; W=0 | 5/3/5; W=0         |
| paper-unique-04     | 5/5/5; W=0  | 5/5/5; W=0 | 4/4/5; W=0 | 5/5/5; W=0         |
| paper-local-01      | 5/5/5; W=0  | 5/5/5; W=0 | 5/5/5; W=0 | 5/5/5; W=0         |
| paper-local-02      | 5/5/5; W=0  | 5/4/5; W=7 | 5/5/5; W=0 | 5/5/5; W=0         |
| paper-local-03      | 4/4/5; W=0  | 3/2/5; W=0 | 5/4/5; W=0 | 5/5/5; W=0         |
| paper-local-04      | 4/3/5; W=0  | 4/4/5; W=0 | 4/4/5; W=0 | 5/5/5; W=0         |
| paper-structural-01 | 0/0/5; W=5  | 5/5/5; W=0 | 4/4/5; W=0 | 4/4/5; W=0         |
| paper-structural-02 | 5/4/5; W=0  | 4/4/5; W=0 | 5/4/5; W=0 | 4/4/5; W=0         |
| paper-structural-03 | 0/0/5; W=6  | 5/5/5; W=0 | 5/5/5; W=0 | 5/5/5; W=0         |
| paper-structural-04 | 0/0/5; W=24 | 4/4/5; W=0 | 4/4/5; W=0 | 5/5/5; W=0         |

### Matched grounding effects

Adaptive minus comparator, percentage points; 95% task-cluster CI. Positive means higher
adaptive grounding rate.

| Class      | Contrast                      | Grounding difference [95% CI] | Strict difference [95% CI] | Any-wrong difference [95% CI] |
| ---------- | ----------------------------- | ----------------------------- | -------------------------- | ----------------------------- |
| overall    | Adaptive − indexed-local      | 26.67 [6.67, 50.00]           | 28.33 [8.33, 51.67]        | -23.33 [-48.33, 0.00]         |
| overall    | Adaptive − indexed-structural | 5.00 [-5.00, 15.00]           | 5.00 [-5.00, 15.00]        | -1.67 [-5.00, 0.00]           |
| unique     | Adaptive − indexed-local      | 10.00 [-15.00, 45.00]         | 15.00 [-10.00, 45.00]      | 0.00 [0.00, 0.00]             |
| unique     | Adaptive − indexed-structural | 5.00 [-15.00, 30.00]          | 5.00 [-10.00, 20.00]       | 0.00 [0.00, 0.00]             |
| local      | Adaptive − indexed-local      | 5.00 [0.00, 15.00]            | 5.00 [0.00, 15.00]         | 0.00 [0.00, 0.00]             |
| local      | Adaptive − indexed-structural | 10.00 [0.00, 30.00]           | 15.00 [0.00, 30.00]        | -5.00 [-15.00, 0.00]          |
| structural | Adaptive − indexed-local      | 65.00 [20.00, 95.00]          | 65.00 [20.00, 95.00]       | -70.00 [-100.00, -25.00]      |
| structural | Adaptive − indexed-structural | 0.00 [-15.00, 15.00]          | -5.00 [-15.00, 0.00]       | 0.00 [0.00, 0.00]             |

Fixed scope comparison: Structural minus Local Grounding Success, percentage points [95%
task-cluster CI]: overall: 21.67 [-3.33, 48.33]; unique: 5.00 [-30.00, 45.00]; local:
-5.00 [-15.00, 0.00]; structural: 65.00 [10.00, 100.00].

Per-task paired effects (all metrics and strata) are retained in
paper-confirmatory-v1-analysis.json. A degenerate empirical interval is not proof of
zero population uncertainty.

## RQ2 — Adaptive Context Expansion

Adaptive's initial representation averaged 48.67 estimated tokens, versus 75.33 for
Structural: 35.4% less. Adaptive grounded 56/60 runs versus Structural's 53/60, with
zero observed wrong inputs versus Structural's seven wrong inputs in one trajectory
after a correct first click. The reliability-gap interval permits Adaptive to be up to 5
pp worse under this empirical analysis; the study does not establish non-inferiority.
The five over-expansions were all local-04's preregistered unrelated Help collision; no
initial under-expansion was observed.

Structural Grounding Success: 88.3% (53/60). Adaptive: 93.3% (56/60). Absolute
reliability gap (Structural − Adaptive): -5.00 pp [-15.00, 5.00]. No non-inferiority
margin was preregistered.

### Context cost and paired savings

Adaptive minus comparator in estimated tokens; negative means less context.

| Class      | Contrast                      | Initial tokens difference [95% CI] | Tokens/observation difference [95% CI] |
| ---------- | ----------------------------- | ---------------------------------- | -------------------------------------- |
| overall    | Adaptive − indexed-local      | 5.92 [-8.92, 20.50]                | 4.14 [-8.26, 16.32]                    |
| overall    | Adaptive − indexed-structural | -26.67 [-39.83, -13.75]            | -22.98 [-34.24, -12.05]                |
| unique     | Adaptive − indexed-local      | -25.25 [-27.25, -23.50]            | -21.82 [-23.90, -19.75]                |
| unique     | Adaptive − indexed-structural | -54.50 [-58.00, -51.00]            | -46.95 [-50.22, -43.63]                |
| local      | Adaptive − indexed-local      | 6.00 [0.00, 18.00]                 | 5.70 [-0.90, 18.00]                    |
| local      | Adaptive − indexed-structural | -25.50 [-33.00, -19.00]            | -21.96 [-29.24, -15.82]                |
| structural | Adaptive − indexed-local      | 37.00 [35.50, 38.50]               | 28.55 [26.30, 31.20]                   |
| structural | Adaptive − indexed-structural | 0.00 [0.00, 0.00]                  | -0.03 [-1.88, 1.80]                    |

### Escalation distribution

| Observation set   | N   | Compact        | Role         | Local          | Structural     | Any escalation |
| ----------------- | --- | -------------- | ------------ | -------------- | -------------- | -------------- |
| Initial (primary) | 60  | 33.3% (20/60)  | 0.0% (0/60)  | 25.0% (15/60)  | 41.7% (25/60)  | 66.7% (40/60)  |
| All pre-grounding | 60  | 33.3% (20/60)  | 0.0% (0/60)  | 25.0% (15/60)  | 41.7% (25/60)  | 66.7% (40/60)  |
| Post-grounding    | 56  | 33.9% (19/56)  | 0.0% (0/56)  | 26.8% (15/56)  | 39.3% (22/56)  | 66.1% (37/56)  |
| All observations  | 116 | 33.6% (39/116) | 0.0% (0/116) | 25.9% (30/116) | 40.5% (47/116) | 66.4% (77/116) |

### Expected minimum versus Adaptive final level (initial observations)

| Expected   | Compact | Role | Local | Structural |
| ---------- | ------- | ---- | ----- | ---------- |
| compact    | 20      | 0    | 0     | 0          |
| role       | 0       | 0    | 0     | 0          |
| local      | 0       | 0    | 15    | 5          |
| structural | 0       | 0    | 0     | 20         |

Minimum match 91.7% (55/60); over-expansion 8.3% (5/60); under-expansion 0.0% (0/60).
Structural escalation precision 80.0% (20/25); recall 100.0% (20/20).

These primary diagnostics score the requested target's frozen minimum on the initial
observation. The all-observation distribution includes cheap terminal turns; terminal
levels are not evidence of under-expansion. Every adaptive observation's collisions,
phase, candidate levels, expected-level match and cost are saved in the analysis
artifact.

## RQ3 — End-to-End Context Efficiency

Usage was reported for all 496 actual calls; there were zero HTTP/stale retries or
infrastructure failures. Adaptive used 1423.40 provider tokens/task, versus Local's
3116.87 (54.3% lower; paired difference -1693.47 [-3410.57, -288.13] tokens). Structural
averaged 1615.50; Adaptive's 11.9% lower point estimate had paired CI -192.10 [-440.80,
18.02], which crosses zero. Thus end-to-end token savings are supported versus Local,
and remain unestablished versus Structural. Adaptive actually exposes more initial
context than Local on structural tasks, while using fewer calls and fewer output tokens
there. This directly shows why per-observation size alone is an inadequate efficiency
measure.

### Representation-level cost

| Variant                | Observations | Chars/obs | Est. tokens/obs | Initial est. tokens | Est. tokens/grounding success | Est. tokens/strict success |
| ---------------------- | ------------ | --------- | --------------- | ------------------- | ----------------------------- | -------------------------- |
| indexed-local          | 144          | 148.67    | 37.57           | 42.75               | 135.25                        | 150.28                     |
| indexed-structural     | 119          | 252.36    | 63.55           | 75.33               | 142.68                        | 151.24                     |
| indexed-adaptive       | 116          | 164.16    | 41.38           | 48.67               | 85.71                         | 90.57                      |
| raw-selector-reference | 117          | 834.32    | 208.96          | 211.58              | 428.91                        | 461.28                     |

The aggregate cost table weights observations equally; matched tokens/observation
effects first average inside each run, then compare matched repeats and task clusters.
Initial-observation cost is the common-candidate-set primary scope comparison.

Tokens here are ceil(UTF-8 bytes/4), including target-map syntax; selector-reference
includes DOM. They are estimates, not GLM tokenizer or billed tokens. Cost per success
charges the arm's failed-run overhead. HTTP retransmissions are represented by provider
call counts rather than counted as new observations.

### Provider usage and interaction cost

Exact totals require usage for every actual HTTP attempt. Observed usage lower bounds
remain separate; failed/retry calls may have unreported consumption.

| Variant                | Complete-usage tasks | Usage-bearing calls / actual calls | Input/task | Output/task | Total/task | Observed total lower bound/task | Total/grounding success | Total/strict success | Calls/task | Retries/task | Steps/task | Latency ms/task |
| ---------------------- | -------------------- | ---------------------------------- | ---------- | ----------- | ---------- | ------------------------------- | ----------------------- | -------------------- | ---------- | ------------ | ---------- | --------------- |
| indexed-local          | 60/60                | 144/144                            | 1287.48    | 1829.38     | 3116.87    | 3116.87                         | 4675.30                 | 5194.78              | 2.40       | 0.00         | 1.45       | 18150.48        |
| indexed-structural     | 60/60                | 119/119                            | 1099.63    | 515.87      | 1615.50    | 1615.50                         | 1828.87                 | 1938.60              | 1.98       | 0.00         | 1.00       | 5522.11         |
| indexed-adaptive       | 60/60                | 116/116                            | 1023.37    | 400.03      | 1423.40    | 1423.40                         | 1525.07                 | 1611.40              | 1.93       | 0.00         | 0.93       | 5985.57         |
| raw-selector-reference | 60/60                | 117/117                            | 1436.47    | 677.12      | 2113.58    | 2113.58                         | 2224.82                 | 2392.74              | 1.95       | 0.00         | 0.95       | 8229.52         |

### Matched inference-cost effects

Adaptive minus comparator; 95% task-cluster intervals. Missing usage invalidates the
complete paired token estimate.

| Class      | Contrast                      | Input tokens                | Output tokens                 | Total tokens                  | Calls                | Retries           | Steps                | Latency ms                       |
| ---------- | ----------------------------- | --------------------------- | ----------------------------- | ----------------------------- | -------------------- | ----------------- | -------------------- | -------------------------------- |
| overall    | Adaptive − indexed-local      | -264.12 [-678.48, 24.32]    | -1429.35 [-3037.13, -244.12]  | -1693.47 [-3410.57, -288.13]  | -0.47 [-1.20, 0.07]  | 0.00 [0.00, 0.00] | -0.52 [-1.35, 0.07]  | -12164.91 [-25971.63, -1592.57]  |
| overall    | Adaptive − indexed-structural | -76.27 [-235.03, 34.65]     | -115.83 [-277.25, 29.00]      | -192.10 [-440.80, 18.02]      | -0.05 [-0.32, 0.13]  | 0.00 [0.00, 0.00] | -0.07 [-0.37, 0.13]  | 463.46 [-1307.19, 2021.07]       |
| unique     | Adaptive − indexed-local      | 10.90 [-120.20, 193.90]     | 85.40 [-147.20, 359.10]       | 96.30 [-267.40, 553.00]       | 0.10 [-0.15, 0.45]   | 0.00 [0.00, 0.00] | 0.10 [-0.15, 0.45]   | 2860.20 [160.27, 5233.31]        |
| unique     | Adaptive − indexed-structural | -63.00 [-171.95, 73.45]     | 9.95 [-248.55, 252.90]        | -53.05 [-366.60, 226.60]      | 0.05 [-0.15, 0.30]   | 0.00 [0.00, 0.00] | 0.05 [-0.15, 0.30]   | 1391.19 [-2578.13, 4148.17]      |
| local      | Adaptive − indexed-local      | 37.55 [0.00, 80.25]         | -76.20 [-155.20, -7.70]       | -38.65 [-123.10, 45.80]       | 0.05 [0.00, 0.15]    | 0.00 [0.00, 0.00] | 0.05 [0.00, 0.15]    | -1548.50 [-5886.80, 1112.60]     |
| local      | Adaptive − indexed-structural | -165.65 [-579.00, 124.65]   | -127.85 [-330.00, 74.30]      | -293.50 [-769.40, 151.60]     | -0.20 [-0.90, 0.30]  | 0.00 [0.00, 0.00] | -0.25 [-1.05, 0.30]  | -300.72 [-3036.25, 2434.81]      |
| structural | Adaptive − indexed-local      | -840.80 [-1635.80, -175.30] | -4297.25 [-7091.40, -2610.10] | -5138.05 [-7496.60, -3064.30] | -1.55 [-2.90, -0.40] | 0.00 [0.00, 0.00] | -1.70 [-3.35, -0.40] | -37806.43 [-60431.58, -21125.15] |
| structural | Adaptive − indexed-structural | -0.15 [-82.50, 82.05]       | -229.60 [-519.20, 26.00]      | -229.75 [-521.45, 28.10]      | 0.00 [-0.15, 0.15]   | 0.00 [0.00, 0.00] | 0.00 [-0.15, 0.15]   | 299.90 [-1522.66, 2457.19]       |

Representation cost and inference cost are distinct: initial Adaptive − Structural
representation effect -26.67 [-39.83, -13.75] estimated tokens; total provider-token
effect -192.10 [-440.80, 18.02]. Reduced end-to-end inference usage is not established
by the paired total-token interval (or usage coverage); smaller context alone is
insufficient.

## Failure Analysis

Primary strict failures were 33 MODEL_OUTPUT_ERROR and 15 SEMANTIC_AMBIGUITY. 14
trajectories grounded correctly but later failed strict success. Across failed decision
attempts (including trajectories whose primary label remains semantic), there were 28
operation-distribution key mismatches, 6 missing target confidence fields, 2 wrong
operation-head shapes and 4 missing-content responses. All 4 missing-content responses
were in Local structural-class runs and reported 8,192 output tokens, all as reasoning
tokens, with no action JSON. This is concrete usage evidence of output-budget
exhaustion, rather than a provider timeout. Do not recode their recorded primary labels.

For example, Adaptive unique-01/r0 executed Save profile correctly, then returned DONE
with a probability distribution omitting the still-offered CLICK key. It is grounding
true and strict false. Structural local-02/r0 grounded Museum correctly, then made seven
wrong inputs and reached the eight-action budget: grounding true, strict false, semantic
primary failure, and budget termination. Local structural-02 grounded 5/5 despite
insufficient semantic scope; the requested item occupied the first position.
Position-based selection can succeed without disambiguation, and the balanced
set/per-task analysis exposes this rather than treating final success as proof of
sufficient context.

Counts overlap when a grounding or terminal failure also has infrastructure events. A
successful preregistered retry retains its original event. Grounding failures are runs
without first-target grounding; strict-only failures grounded correctly but fail the
full trajectory.

| Variant                | Grounding failures | Strict-task-only failures | Infrastructure-affected runs | Primary failure distribution                   |
| ---------------------- | ------------------ | ------------------------- | ---------------------------- | ---------------------------------------------- |
| indexed-local          | 20                 | 4                         | 0                            | MODEL_OUTPUT_ERROR: 10; SEMANTIC_AMBIGUITY: 14 |
| indexed-structural     | 7                  | 3                         | 0                            | SEMANTIC_AMBIGUITY: 1; MODEL_OUTPUT_ERROR: 9   |
| indexed-adaptive       | 4                  | 3                         | 0                            | MODEL_OUTPUT_ERROR: 7                          |
| raw-selector-reference | 3                  | 4                         | 0                            | MODEL_OUTPUT_ERROR: 7                          |

Adaptive annotation-relative policy labels: OVER_EXPANSION 5, UNDER_EXPANSION 0 initial
observations. Over-expansion is not an automatic task failure. Required taxonomy
additionally distinguishes SEMANTIC_AMBIGUITY, MODEL_OUTPUT_ERROR, DECISION_ERROR,
INVALID_ACTION, EXECUTION_ERROR, BUDGET_EXCEEDED, PROVIDER_TIMEOUT, PROVIDER_HTTP_ERROR,
ENDPOINT_FAILURE and UNKNOWN. A wrong target has concrete semantic evidence; label
co-occurrence does not identify the causal mechanism. Every failed/infra-affected run is
indexed in the analysis JSON with complete traces available by run_id in the raw JSONL.

## Threats to Validity

The unchanged extractor can attach the first heading inside its main scope to sibling
controls (e.g. Save profile receives section Cancel; Atlas receives section Support
East). These noisy fields are part of the frozen treatment, not evidence of correct
ancestor semantics. No extractor fix or task replacement was made after outcomes. This
further limits attributing an effect to one individual context field.

Twelve authored synthetic/local fixtures, one model, one provider, one prompt, one
browser/runtime. The five repeats are not independent tasks. Four task clusters per
stratum yield unstable bootstrap tails; zero differences can give degenerate empirical
intervals. Provider serving state, time and concurrency may correlate repetitions;
balanced ordering mitigates but does not eliminate this. Local/structural formats bundle
multiple fields and truncation limits. The target-minimum annotations are designed
sufficiency expectations, not natural-web ground truth. Whole-space collisions can
exceed target needs. Selector reference has extra DOM and different locator syntax.
Static token estimates are heuristic; provider usage can be incomplete. Structured
probability-head errors are policy/protocol failures, not proof of inadequate semantic
context. No open-web, external benchmark, second-model or universal-superiority
inference.

## Confirmatory Conclusions

RQ1: Structural and Adaptive each grounded 90% of structural-class runs, versus Local's
25%; Local remained sufficient for the local-class controls. RQ2: Adaptive reduced
initial representation cost by 35.4% relative to Structural, with grounding 93.3% versus
88.3%, a Structural-minus-Adaptive gap of -5.00 pp [−15.00, 5.00], zero observed wrong
inputs, 91.7% minimum-level matches, five over-expansions and zero under-expansions.
This supports observed context savings alongside high grounding; non-inferiority remains
unestablished. RQ3: Adaptive reduced complete provider tokens/task by 54.3% relative to
Local, with a negative paired CI; its 11.9% lower point estimate versus Structural has
an interval crossing zero. Similar observed grounding/strict success does not establish
equivalence.

A second-model replication must repeat a separately frozen matched design and test
policy/protocol dependence. Open-web/external benchmark replication must test varied
DOMs, real multi-step tasks, dynamic pages and independently audited grounding. Neither
is run in this milestone.

### Paper-style claim ledger

| Status      | Claim and scope                                                                                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supported   | Structural context improved grounding relative to Local on the frozen structural-class tasks (+65.00 pp [10.00, 100.00]); this is stratum-specific evidence.      |
| Supported   | Adaptive improved grounding relative to Local across this balanced cohort (+26.67 pp [6.67, 50.00]).                                                              |
| Supported   | Adaptive reduced complete provider tokens/task relative to Local (-1693.47 [-3410.57, -288.13] tokens; 54.3% point saving).                                       |
| Supported   | Adaptive reduces initial representation cost relative to Structural on these frozen fixtures (-26.67 [-39.83, -13.75] estimated tokens).                          |
| Supported   | Adaptive has zero observed wrong-target inputs in this cohort (observed 0; no universal zero-error claim).                                                        |
| Unsupported | Adaptive reduces complete end-to-end provider token usage relative to Structural (-192.10 [-440.80, 18.02] tokens).                                               |
| Tentative   | Adaptive has similar reliability to Structural only to the extent allowed by the observed gap and task-cluster interval; no preregistered non-inferiority margin. |
| Unsupported | Statistical non-inferiority/equivalence, open-web generalization, cross-model generalization, universal superiority and lower monetary cost.                      |

Post-cohort interpretation and explicit structural-collision counts are reproducible
with `python3 evals/analysis/paper-confirmatory-v1.py` under the pinned Node
environment. This script regenerates the frozen analysis before adding interpretation;
it makes no model calls and does not modify raw results or frozen controls.
