# Prism evaluation summary

Pilot, main, smoke and scripted experiments are reported separately. These local tasks
measure this fixed policy and benchmark; they do not establish general browser-agent
performance.

## smoke: f54bc798-0fba-421f-8d28-a388c689994c

Model: `glm-5.3-flash`; temperature: 0; browser: `Chrome/153.0.8010.12`; viewport: 1120
× 780; max steps: 8.

Source: `7c923b14708441e9ea01fc078fd094175ec58c1bdb705d9b1ab739caf1147fc8`. Fixtures:
`de0375d93fe935793de2830e151e431fdac6bd2a73b56cd65b07ddf4d14f5860`. System prompt:
`c40b40cd952a0540cc616ac6b491b9e5ee11f84ac6f614cc55585ac116ae9fa4`. Cohort:
`a32829279f8cd1ef41e0bcefe9ac9a7ff01139acddde44c07d37d2c1cbbc98da`.

| Variant                 | Tasks | Runs | Success Rate | Task-cluster 95% CI | Per-task SD | Avg Steps | Avg Steps to Success | Retries | LLM Calls | Avg Latency (ms) |
| ----------------------- | ----: | ---: | -----------: | ------------------- | ----------: | --------: | -------------------: | ------: | --------: | ---------------: |
| prism-full              |     2 |    2 | 100.0% (2/2) | 100.0–100.0%        |      0.0 pp |      1.00 |                 1.00 |       1 |         5 |          9048.68 |
| prism-no-stale-recovery |     2 |    2 |  50.0% (1/2) | 0.0–100.0%          |     70.7 pp |      0.50 |                 1.00 |       0 |         3 |          6477.20 |
| prism-no-validation     |     2 |    2 | 100.0% (2/2) | 100.0–100.0%        |      0.0 pp |      1.00 |                 1.00 |       1 |         5 |         20564.13 |
| raw-selector            |     2 |    2 | 100.0% (2/2) | 100.0–100.0%        |      0.0 pp |      1.00 |                 1.00 |       1 |         5 |         50430.61 |

| Variant                 | Invalid Actions | Invalid Action Rate | Invalid Outputs | Invalid Selector Rate | Wrong Target Rate | Correct Target Rate | Grounding Error Rate | Stale Detections | Stale Recovery Rate | Input / Output / Total Tokens |
| ----------------------- | --------------: | ------------------: | --------------: | --------------------: | ----------------: | ------------------: | -------------------: | ---------------: | ------------------: | ----------------------------- |
| prism-full              |               0 |          0.0% (0/3) |               0 |                   n/a |        0.0% (0/2) |        100.0% (3/3) |           0.0% (0/3) |                1 |        100.0% (1/1) | 3115 / 1096 / 4211            |
| prism-no-stale-recovery |               0 |          0.0% (0/2) |               0 |                   n/a |        0.0% (0/1) |        100.0% (2/2) |           0.0% (0/2) |                1 |          0.0% (0/1) | 1863 / 668 / 2531             |
| prism-no-validation     |               0 |          0.0% (0/3) |               0 |                   n/a |        0.0% (0/2) |        100.0% (3/3) |           0.0% (0/3) |                1 |        100.0% (1/1) | 3115 / 811 / 3926             |
| raw-selector            |               0 |          0.0% (0/3) |               0 |            0.0% (0/3) |        0.0% (0/2) |        100.0% (3/3) |           0.0% (0/3) |                1 |        100.0% (1/1) | 3131 / 1864 / 4995            |

### Paired success differences versus prism-full

| Variant                 | Macro success difference | Paired task-cluster 95% CI |
| ----------------------- | -----------------------: | -------------------------- |
| prism-no-stale-recovery |                 -50.0 pp | -100.0–0.0%                |
| prism-no-validation     |                   0.0 pp | 0.0–0.0%                   |
| raw-selector            |                   0.0 pp | 0.0–0.0%                   |

### Category outcomes

| Category  | Variant                 | Success Rate |
| --------- | ----------------------- | -----------: |
| grounding | prism-full              | 100.0% (1/1) |
| grounding | prism-no-stale-recovery | 100.0% (1/1) |
| grounding | prism-no-validation     | 100.0% (1/1) |
| grounding | raw-selector            | 100.0% (1/1) |
| stale     | prism-full              | 100.0% (1/1) |
| stale     | prism-no-stale-recovery |   0.0% (0/1) |
| stale     | prism-no-validation     | 100.0% (1/1) |
| stale     | raw-selector            | 100.0% (1/1) |

### Failure distribution

| Variant                 | Failure Type | Count |
| ----------------------- | ------------ | ----: |
| prism-full              | None         |     0 |
| prism-no-stale-recovery | STALE_TARGET |     1 |
| prism-no-validation     | None         |     0 |
| raw-selector            | None         |     0 |

### Repeat variance

0/8 task/variant groups have mixed success outcomes. 0/8 vary in success, failure,
steps, calls, wrong targets, validation or stale events. Temperature 0 did not guarantee
identical behavior. Latency differences alone do not flag variance.

| Task | Variant | Runs | Mixed success | Mixed behavior |
| ---- | ------- | ---: | ------------- | -------------- |

### Per-task success rates

| Task          | Variant                 | Runs | Success Rate | Wilson 95% CI |
| ------------- | ----------------------- | ---: | -----------: | ------------- |
| grounding-002 | prism-full              |    1 | 100.0% (1/1) | 20.7–100.0%   |
| grounding-002 | prism-no-stale-recovery |    1 | 100.0% (1/1) | 20.7–100.0%   |
| grounding-002 | prism-no-validation     |    1 | 100.0% (1/1) | 20.7–100.0%   |
| grounding-002 | raw-selector            |    1 | 100.0% (1/1) | 20.7–100.0%   |
| stale-002     | prism-full              |    1 | 100.0% (1/1) | 20.7–100.0%   |
| stale-002     | prism-no-stale-recovery |    1 |   0.0% (0/1) | 0.0–79.3%     |
| stale-002     | prism-no-validation     |    1 | 100.0% (1/1) | 20.7–100.0%   |
| stale-002     | raw-selector            |    1 | 100.0% (1/1) | 20.7–100.0%   |

Confidence intervals resample tasks (2,000 draws, fixed seed) and preserve repeated runs
within tasks. Per-task SD describes benchmark heterogeneity, not a standard error.
Per-task Wilson intervals assume independent repeats; shared provider effects can
violate that assumption. Small local convenience samples do not represent the web.

Invalid Action Rate counts invalid nonterminal proposals; Invalid Outputs counts
distribution/argmax failures separately. Wrong Target Rate counts executed
click/fill/select actions with known fixture audits. Correct Target Rate counts scored
target selections, including abandoned stale selections; neutral controls are excluded.
Grounding Error Rate counts wrong scored selections and invalid selectors over mapped
target attempts plus invalid selectors. Stale Recovery Rate means a later input executed
at the same agent step, not that the task succeeded. Token totals are n/a if any turn
lacks reported usage. LLM Calls includes actual HTTP attempts and retries. Latency
includes setup and cleanup.

Validation rejects structural inconsistency; it cannot reject a semantically wrong
target with a valid distribution. Confidence is self-reported, not calibrated. The
matched DOM supplement is supplied to all four arms. This evaluates a shared generative
policy with Prism's parser/loop/executor, not the production TypeSafe model. Raw
selectors resolve uniquely to eligible observed nodes before injected mutation, then use
the same executor and stale guards. Richer local-context representations remain
deferred.
