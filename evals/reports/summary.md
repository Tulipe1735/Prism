# Prism evaluation summary

Pilot, main, smoke and scripted experiments are reported separately. These local tasks
measure this fixed policy and benchmark; they do not establish general browser-agent
performance.

## main: 4de00718-e984-406d-85e5-2820d9c8ce74

Model: `glm-5.3-flash`; temperature: 0; browser: `Chrome/153.0.8010.12`; viewport: 1120
× 780; max steps: 8.

Source: `7c923b14708441e9ea01fc078fd094175ec58c1bdb705d9b1ab739caf1147fc8`. Fixtures:
`de0375d93fe935793de2830e151e431fdac6bd2a73b56cd65b07ddf4d14f5860`. System prompt:
`c40b40cd952a0540cc616ac6b491b9e5ee11f84ac6f614cc55585ac116ae9fa4`. Cohort:
`93f03cfea754d79b8e9b793a33a3493e94943ffdb817456822e42b8748e932b0`.

| Variant                 | Tasks | Runs |    Success Rate | Task-cluster 95% CI | Per-task SD | Avg Steps | Avg Steps to Success | Retries | LLM Calls | Avg Latency (ms) |
| ----------------------- | ----: | ---: | --------------: | ------------------- | ----------: | --------: | -------------------: | ------: | --------: | ---------------: |
| prism-full              |    24 |  120 | 83.3% (100/120) | 72.5–92.5%          |     24.1 pp |      0.88 |                 1.03 |      46 |       269 |         26885.37 |
| prism-no-stale-recovery |    24 |  120 |  74.2% (89/120) | 57.5–88.3%          |     39.8 pp |      0.80 |                 1.04 |       2 |       218 |         21651.32 |
| prism-no-validation     |    24 |  120 | 93.3% (112/120) | 84.2–99.2%          |     21.0 pp |      1.00 |                 1.04 |      49 |       285 |         26397.92 |
| raw-selector            |    24 |  120 |  82.5% (99/120) | 70.0–93.3%          |     30.8 pp |      0.85 |                 1.02 |      49 |       267 |         33566.94 |

| Variant                 | Invalid Actions | Invalid Action Rate | Invalid Outputs | Invalid Selector Rate | Wrong Target Rate | Correct Target Rate | Grounding Error Rate | Stale Detections | Stale Recovery Rate | Input / Output / Total Tokens |
| ----------------------- | --------------: | ------------------: | --------------: | --------------------: | ----------------: | ------------------: | -------------------: | ---------------: | ------------------: | ----------------------------- |
| prism-full              |               2 |        1.2% (2/164) |              17 |                   n/a |      0.0% (0/105) |    100.0% (148/148) |         0.0% (0/149) |               43 |       44.2% (19/43) | 175955 / 99069 / 275024       |
| prism-no-stale-recovery |               1 |        0.8% (1/126) |               6 |                   n/a |       1.0% (1/96) |     99.2% (119/120) |         0.8% (1/120) |               24 |         0.0% (0/24) | n/a / n/a / n/a               |
| prism-no-validation     |               3 |        1.7% (3/172) |              13 |                   n/a |      0.0% (0/120) |    100.0% (169/169) |         0.0% (0/169) |               49 |       40.8% (20/49) | 188513 / 118973 / 307486      |
| raw-selector            |               6 |        3.7% (6/164) |              10 |          3.2% (5/155) |      0.0% (0/102) |    100.0% (149/149) |         3.2% (5/154) |               47 |       42.6% (20/47) | n/a / n/a / n/a               |

### Paired success differences versus prism-full

| Variant                 | Macro success difference | Paired task-cluster 95% CI |
| ----------------------- | -----------------------: | -------------------------- |
| prism-no-stale-recovery |                  -9.2 pp | -27.5–5.8%                 |
| prism-no-validation     |                  10.0 pp | 2.5–17.5%                  |
| raw-selector            |                  -0.8 pp | -10.8–7.5%                 |

### Category outcomes

| Category   | Variant                 |   Success Rate |
| ---------- | ----------------------- | -------------: |
| ambiguity  | prism-full              |  89.1% (49/55) |
| ambiguity  | prism-no-stale-recovery |  96.4% (53/55) |
| ambiguity  | prism-no-validation     |  96.4% (53/55) |
| ambiguity  | raw-selector            |  89.1% (49/55) |
| form       | prism-full              |    40.0% (2/5) |
| form       | prism-no-stale-recovery |    80.0% (4/5) |
| form       | prism-no-validation     |   100.0% (5/5) |
| form       | raw-selector            |    40.0% (2/5) |
| grounding  | prism-full              |  84.0% (21/25) |
| grounding  | prism-no-stale-recovery |  88.0% (22/25) |
| grounding  | prism-no-validation     | 100.0% (25/25) |
| grounding  | raw-selector            |  76.0% (19/25) |
| navigation | prism-full              |    80.0% (4/5) |
| navigation | prism-no-stale-recovery |   100.0% (5/5) |
| navigation | prism-no-validation     |   100.0% (5/5) |
| navigation | raw-selector            |    80.0% (4/5) |
| stale      | prism-full              |  80.0% (24/30) |
| stale      | prism-no-stale-recovery |   16.7% (5/30) |
| stale      | prism-no-validation     |  80.0% (24/30) |
| stale      | raw-selector            |  83.3% (25/30) |

### Failure distribution

| Variant                 | Failure Type           | Count |
| ----------------------- | ---------------------- | ----: |
| prism-full              | MODEL_OUTPUT_ERROR     |    17 |
| prism-full              | STALE_TARGET           |     3 |
| prism-no-stale-recovery | ACTION_GROUNDING_ERROR |     1 |
| prism-no-stale-recovery | MODEL_OUTPUT_ERROR     |     6 |
| prism-no-stale-recovery | STALE_TARGET           |    24 |
| prism-no-validation     | MODEL_OUTPUT_ERROR     |     4 |
| prism-no-validation     | STALE_TARGET           |     4 |
| raw-selector            | BUDGET_EXCEEDED        |     2 |
| raw-selector            | INVALID_ACTION         |     5 |
| raw-selector            | MODEL_OUTPUT_ERROR     |    10 |
| raw-selector            | STALE_TARGET           |     4 |

### Repeat variance

27/96 task/variant groups have mixed success outcomes. 37/96 vary in success, failure,
steps, calls, wrong targets, validation or stale events. Temperature 0 did not guarantee
identical behavior. Latency differences alone do not flag variance.

| Task           | Variant                 | Runs | Mixed success | Mixed behavior |
| -------------- | ----------------------- | ---: | ------------- | -------------- |
| ambiguity-002  | prism-full              |    5 | true          | true           |
| ambiguity-002  | prism-no-validation     |    5 | false         | true           |
| ambiguity-003  | raw-selector            |    5 | true          | true           |
| ambiguity-004  | prism-no-validation     |    5 | true          | true           |
| ambiguity-004  | raw-selector            |    5 | true          | true           |
| ambiguity-006  | prism-full              |    5 | true          | true           |
| ambiguity-006  | raw-selector            |    5 | true          | true           |
| ambiguity-007  | prism-full              |    5 | true          | true           |
| ambiguity-008  | prism-full              |    5 | true          | true           |
| ambiguity-008  | prism-no-stale-recovery |    5 | true          | true           |
| ambiguity-008  | prism-no-validation     |    5 | true          | true           |
| ambiguity-008  | raw-selector            |    5 | true          | true           |
| ambiguity-011  | prism-full              |    5 | true          | true           |
| ambiguity-011  | prism-no-stale-recovery |    5 | true          | true           |
| form-001       | prism-full              |    5 | true          | true           |
| form-001       | prism-no-stale-recovery |    5 | true          | true           |
| form-001       | raw-selector            |    5 | true          | true           |
| grounding-001  | prism-no-stale-recovery |    5 | true          | true           |
| grounding-002  | prism-full              |    5 | true          | true           |
| grounding-003  | prism-full              |    5 | false         | true           |
| grounding-003  | prism-no-stale-recovery |    5 | true          | true           |
| grounding-003  | raw-selector            |    5 | true          | true           |
| grounding-004  | prism-full              |    5 | true          | true           |
| grounding-004  | prism-no-stale-recovery |    5 | true          | true           |
| grounding-005  | prism-full              |    5 | true          | true           |
| grounding-005  | prism-no-stale-recovery |    5 | false         | true           |
| navigation-001 | prism-full              |    5 | true          | true           |
| navigation-001 | raw-selector            |    5 | true          | true           |
| stale-001      | prism-full              |    5 | false         | true           |
| stale-001      | prism-no-validation     |    5 | false         | true           |
| stale-002      | prism-full              |    5 | true          | true           |
| stale-002      | prism-no-stale-recovery |    5 | false         | true           |
| stale-002      | prism-no-validation     |    5 | false         | true           |
| stale-004      | prism-full              |    5 | false         | true           |
| stale-004      | prism-no-validation     |    5 | false         | true           |
| stale-004      | raw-selector            |    5 | false         | true           |
| stale-006      | prism-no-validation     |    5 | true          | true           |

### Per-task success rates

| Task           | Variant                 | Runs | Success Rate | Wilson 95% CI |
| -------------- | ----------------------- | ---: | -----------: | ------------- |
| ambiguity-001  | prism-full              |    5 | 100.0% (5/5) | 56.6–100.0%   |
| ambiguity-001  | prism-no-stale-recovery |    5 | 100.0% (5/5) | 56.6–100.0%   |
| ambiguity-001  | prism-no-validation     |    5 | 100.0% (5/5) | 56.6–100.0%   |
| ambiguity-001  | raw-selector            |    5 | 100.0% (5/5) | 56.6–100.0%   |
| ambiguity-002  | prism-full              |    5 |  80.0% (4/5) | 37.6–96.4%    |
| ambiguity-002  | prism-no-stale-recovery |    5 | 100.0% (5/5) | 56.6–100.0%   |
| ambiguity-002  | prism-no-validation     |    5 | 100.0% (5/5) | 56.6–100.0%   |
| ambiguity-002  | raw-selector            |    5 | 100.0% (5/5) | 56.6–100.0%   |
| ambiguity-003  | prism-full              |    5 | 100.0% (5/5) | 56.6–100.0%   |
| ambiguity-003  | prism-no-stale-recovery |    5 | 100.0% (5/5) | 56.6–100.0%   |
| ambiguity-003  | prism-no-validation     |    5 | 100.0% (5/5) | 56.6–100.0%   |
| ambiguity-003  | raw-selector            |    5 |  80.0% (4/5) | 37.6–96.4%    |
| ambiguity-004  | prism-full              |    5 | 100.0% (5/5) | 56.6–100.0%   |
| ambiguity-004  | prism-no-stale-recovery |    5 | 100.0% (5/5) | 56.6–100.0%   |
| ambiguity-004  | prism-no-validation     |    5 |  80.0% (4/5) | 37.6–96.4%    |
| ambiguity-004  | raw-selector            |    5 |  80.0% (4/5) | 37.6–96.4%    |
| ambiguity-005  | prism-full              |    5 | 100.0% (5/5) | 56.6–100.0%   |
| ambiguity-005  | prism-no-stale-recovery |    5 | 100.0% (5/5) | 56.6–100.0%   |
| ambiguity-005  | prism-no-validation     |    5 | 100.0% (5/5) | 56.6–100.0%   |
| ambiguity-005  | raw-selector            |    5 | 100.0% (5/5) | 56.6–100.0%   |
| ambiguity-006  | prism-full              |    5 |  60.0% (3/5) | 23.1–88.2%    |
| ambiguity-006  | prism-no-stale-recovery |    5 | 100.0% (5/5) | 56.6–100.0%   |
| ambiguity-006  | prism-no-validation     |    5 | 100.0% (5/5) | 56.6–100.0%   |
| ambiguity-006  | raw-selector            |    5 |  80.0% (4/5) | 37.6–96.4%    |
| ambiguity-007  | prism-full              |    5 |  80.0% (4/5) | 37.6–96.4%    |
| ambiguity-007  | prism-no-stale-recovery |    5 | 100.0% (5/5) | 56.6–100.0%   |
| ambiguity-007  | prism-no-validation     |    5 | 100.0% (5/5) | 56.6–100.0%   |
| ambiguity-007  | raw-selector            |    5 | 100.0% (5/5) | 56.6–100.0%   |
| ambiguity-008  | prism-full              |    5 |  80.0% (4/5) | 37.6–96.4%    |
| ambiguity-008  | prism-no-stale-recovery |    5 |  80.0% (4/5) | 37.6–96.4%    |
| ambiguity-008  | prism-no-validation     |    5 |  80.0% (4/5) | 37.6–96.4%    |
| ambiguity-008  | raw-selector            |    5 |  40.0% (2/5) | 11.8–76.9%    |
| ambiguity-009  | prism-full              |    5 | 100.0% (5/5) | 56.6–100.0%   |
| ambiguity-009  | prism-no-stale-recovery |    5 | 100.0% (5/5) | 56.6–100.0%   |
| ambiguity-009  | prism-no-validation     |    5 | 100.0% (5/5) | 56.6–100.0%   |
| ambiguity-009  | raw-selector            |    5 | 100.0% (5/5) | 56.6–100.0%   |
| ambiguity-010  | prism-full              |    5 | 100.0% (5/5) | 56.6–100.0%   |
| ambiguity-010  | prism-no-stale-recovery |    5 | 100.0% (5/5) | 56.6–100.0%   |
| ambiguity-010  | prism-no-validation     |    5 | 100.0% (5/5) | 56.6–100.0%   |
| ambiguity-010  | raw-selector            |    5 | 100.0% (5/5) | 56.6–100.0%   |
| ambiguity-011  | prism-full              |    5 |  80.0% (4/5) | 37.6–96.4%    |
| ambiguity-011  | prism-no-stale-recovery |    5 |  80.0% (4/5) | 37.6–96.4%    |
| ambiguity-011  | prism-no-validation     |    5 | 100.0% (5/5) | 56.6–100.0%   |
| ambiguity-011  | raw-selector            |    5 | 100.0% (5/5) | 56.6–100.0%   |
| form-001       | prism-full              |    5 |  40.0% (2/5) | 11.8–76.9%    |
| form-001       | prism-no-stale-recovery |    5 |  80.0% (4/5) | 37.6–96.4%    |
| form-001       | prism-no-validation     |    5 | 100.0% (5/5) | 56.6–100.0%   |
| form-001       | raw-selector            |    5 |  40.0% (2/5) | 11.8–76.9%    |
| grounding-001  | prism-full              |    5 | 100.0% (5/5) | 56.6–100.0%   |
| grounding-001  | prism-no-stale-recovery |    5 |  80.0% (4/5) | 37.6–96.4%    |
| grounding-001  | prism-no-validation     |    5 | 100.0% (5/5) | 56.6–100.0%   |
| grounding-001  | raw-selector            |    5 | 100.0% (5/5) | 56.6–100.0%   |
| grounding-002  | prism-full              |    5 |  80.0% (4/5) | 37.6–96.4%    |
| grounding-002  | prism-no-stale-recovery |    5 | 100.0% (5/5) | 56.6–100.0%   |
| grounding-002  | prism-no-validation     |    5 | 100.0% (5/5) | 56.6–100.0%   |
| grounding-002  | raw-selector            |    5 | 100.0% (5/5) | 56.6–100.0%   |
| grounding-003  | prism-full              |    5 | 100.0% (5/5) | 56.6–100.0%   |
| grounding-003  | prism-no-stale-recovery |    5 |  80.0% (4/5) | 37.6–96.4%    |
| grounding-003  | prism-no-validation     |    5 | 100.0% (5/5) | 56.6–100.0%   |
| grounding-003  | raw-selector            |    5 |  80.0% (4/5) | 37.6–96.4%    |
| grounding-004  | prism-full              |    5 |  80.0% (4/5) | 37.6–96.4%    |
| grounding-004  | prism-no-stale-recovery |    5 |  80.0% (4/5) | 37.6–96.4%    |
| grounding-004  | prism-no-validation     |    5 | 100.0% (5/5) | 56.6–100.0%   |
| grounding-004  | raw-selector            |    5 |   0.0% (0/5) | 0.0–43.4%     |
| grounding-005  | prism-full              |    5 |  60.0% (3/5) | 23.1–88.2%    |
| grounding-005  | prism-no-stale-recovery |    5 | 100.0% (5/5) | 56.6–100.0%   |
| grounding-005  | prism-no-validation     |    5 | 100.0% (5/5) | 56.6–100.0%   |
| grounding-005  | raw-selector            |    5 | 100.0% (5/5) | 56.6–100.0%   |
| navigation-001 | prism-full              |    5 |  80.0% (4/5) | 37.6–96.4%    |
| navigation-001 | prism-no-stale-recovery |    5 | 100.0% (5/5) | 56.6–100.0%   |
| navigation-001 | prism-no-validation     |    5 | 100.0% (5/5) | 56.6–100.0%   |
| navigation-001 | raw-selector            |    5 |  80.0% (4/5) | 37.6–96.4%    |
| stale-001      | prism-full              |    5 | 100.0% (5/5) | 56.6–100.0%   |
| stale-001      | prism-no-stale-recovery |    5 |   0.0% (0/5) | 0.0–43.4%     |
| stale-001      | prism-no-validation     |    5 | 100.0% (5/5) | 56.6–100.0%   |
| stale-001      | raw-selector            |    5 | 100.0% (5/5) | 56.6–100.0%   |
| stale-002      | prism-full              |    5 |  80.0% (4/5) | 37.6–96.4%    |
| stale-002      | prism-no-stale-recovery |    5 |   0.0% (0/5) | 0.0–43.4%     |
| stale-002      | prism-no-validation     |    5 | 100.0% (5/5) | 56.6–100.0%   |
| stale-002      | raw-selector            |    5 | 100.0% (5/5) | 56.6–100.0%   |
| stale-003      | prism-full              |    5 | 100.0% (5/5) | 56.6–100.0%   |
| stale-003      | prism-no-stale-recovery |    5 | 100.0% (5/5) | 56.6–100.0%   |
| stale-003      | prism-no-validation     |    5 | 100.0% (5/5) | 56.6–100.0%   |
| stale-003      | raw-selector            |    5 | 100.0% (5/5) | 56.6–100.0%   |
| stale-004      | prism-full              |    5 |   0.0% (0/5) | 0.0–43.4%     |
| stale-004      | prism-no-stale-recovery |    5 |   0.0% (0/5) | 0.0–43.4%     |
| stale-004      | prism-no-validation     |    5 |   0.0% (0/5) | 0.0–43.4%     |
| stale-004      | raw-selector            |    5 |   0.0% (0/5) | 0.0–43.4%     |
| stale-005      | prism-full              |    5 | 100.0% (5/5) | 56.6–100.0%   |
| stale-005      | prism-no-stale-recovery |    5 |   0.0% (0/5) | 0.0–43.4%     |
| stale-005      | prism-no-validation     |    5 | 100.0% (5/5) | 56.6–100.0%   |
| stale-005      | raw-selector            |    5 | 100.0% (5/5) | 56.6–100.0%   |
| stale-006      | prism-full              |    5 | 100.0% (5/5) | 56.6–100.0%   |
| stale-006      | prism-no-stale-recovery |    5 |   0.0% (0/5) | 0.0–43.4%     |
| stale-006      | prism-no-validation     |    5 |  80.0% (4/5) | 37.6–96.4%    |
| stale-006      | raw-selector            |    5 | 100.0% (5/5) | 56.6–100.0%   |

## pilot: d047f305-0fb6-4f62-ad34-3de73bcb04ae

Model: `glm-5.3-flash`; temperature: 0; browser: `Chrome/153.0.8010.12`; viewport: 1120
× 780; max steps: 8.

Source: `7c923b14708441e9ea01fc078fd094175ec58c1bdb705d9b1ab739caf1147fc8`. Fixtures:
`de0375d93fe935793de2830e151e431fdac6bd2a73b56cd65b07ddf4d14f5860`. System prompt:
`c40b40cd952a0540cc616ac6b491b9e5ee11f84ac6f614cc55585ac116ae9fa4`. Cohort:
`9e2bba26b4b05613ccdf0339519d430d797210c8dc9ec42b2c319190d3c9294e`.

| Variant                 | Tasks | Runs |  Success Rate | Task-cluster 95% CI | Per-task SD | Avg Steps | Avg Steps to Success | Retries | LLM Calls | Avg Latency (ms) |
| ----------------------- | ----: | ---: | ------------: | ------------------- | ----------: | --------: | -------------------: | ------: | --------: | ---------------: |
| prism-full              |    24 |   72 | 84.7% (61/72) | 73.6–93.1%          |     26.0 pp |      0.92 |                 1.05 |      21 |       158 |         30570.10 |
| prism-no-stale-recovery |    24 |   72 | 73.6% (53/72) | 56.9–88.9%          |     40.5 pp |      0.79 |                 1.06 |       1 |       130 |         27273.96 |
| prism-no-validation     |    24 |   72 | 91.7% (66/72) | 81.9–100.0%         |     24.6 pp |      0.99 |                 1.05 |      29 |       170 |         34753.82 |
| raw-selector            |    24 |   72 | 84.7% (61/72) | 73.6–94.4%          |     27.8 pp |      0.89 |                 1.03 |      27 |       161 |         39121.65 |

| Variant                 | Invalid Actions | Invalid Action Rate | Invalid Outputs | Invalid Selector Rate | Wrong Target Rate | Correct Target Rate | Grounding Error Rate | Stale Detections | Stale Recovery Rate | Input / Output / Total Tokens |
| ----------------------- | --------------: | ------------------: | --------------: | --------------------: | ----------------: | ------------------: | -------------------: | ---------------: | ------------------: | ----------------------------- |
| prism-full              |               1 |         1.1% (1/94) |               9 |                   n/a |       1.5% (1/66) |       98.8% (85/86) |          1.2% (1/86) |               20 |       55.0% (11/20) | n/a / n/a / n/a               |
| prism-no-stale-recovery |               1 |         1.4% (1/74) |               4 |                   n/a |       0.0% (0/57) |      100.0% (72/72) |          0.0% (0/72) |               15 |         0.0% (0/15) | 85664 / 48807 / 134471        |
| prism-no-validation     |               2 |        2.0% (2/100) |               7 |                   n/a |       0.0% (0/71) |      100.0% (98/98) |          0.0% (0/98) |               27 |       44.4% (12/27) | n/a / n/a / n/a               |
| raw-selector            |               3 |         3.0% (3/99) |               6 |           3.2% (3/94) |       0.0% (0/64) |      100.0% (90/90) |          3.2% (3/94) |               27 |       55.6% (15/27) | 106872 / 88486 / 195358       |

### Paired success differences versus prism-full

| Variant                 | Macro success difference | Paired task-cluster 95% CI |
| ----------------------- | -----------------------: | -------------------------- |
| prism-no-stale-recovery |                 -11.1 pp | -27.8–2.8%                 |
| prism-no-validation     |                   6.9 pp | -1.4–15.3%                 |
| raw-selector            |                   0.0 pp | -13.9–12.5%                |

### Category outcomes

| Category   | Variant                 |  Success Rate |
| ---------- | ----------------------- | ------------: |
| ambiguity  | prism-full              | 87.9% (29/33) |
| ambiguity  | prism-no-stale-recovery | 90.9% (30/33) |
| ambiguity  | prism-no-validation     | 97.0% (32/33) |
| ambiguity  | raw-selector            | 87.9% (29/33) |
| form       | prism-full              |  100.0% (3/3) |
| form       | prism-no-stale-recovery |  100.0% (3/3) |
| form       | prism-no-validation     |  100.0% (3/3) |
| form       | raw-selector            |   33.3% (1/3) |
| grounding  | prism-full              | 86.7% (13/15) |
| grounding  | prism-no-stale-recovery | 93.3% (14/15) |
| grounding  | prism-no-validation     | 86.7% (13/15) |
| grounding  | raw-selector            | 80.0% (12/15) |
| navigation | prism-full              |   66.7% (2/3) |
| navigation | prism-no-stale-recovery |  100.0% (3/3) |
| navigation | prism-no-validation     |  100.0% (3/3) |
| navigation | raw-selector            |  100.0% (3/3) |
| stale      | prism-full              | 77.8% (14/18) |
| stale      | prism-no-stale-recovery |  16.7% (3/18) |
| stale      | prism-no-validation     | 83.3% (15/18) |
| stale      | raw-selector            | 88.9% (16/18) |

### Failure distribution

| Variant                 | Failure Type           | Count |
| ----------------------- | ---------------------- | ----: |
| prism-full              | ACTION_GROUNDING_ERROR |     1 |
| prism-full              | MODEL_OUTPUT_ERROR     |     9 |
| prism-full              | STALE_TARGET           |     1 |
| prism-no-stale-recovery | MODEL_OUTPUT_ERROR     |     4 |
| prism-no-stale-recovery | STALE_TARGET           |    15 |
| prism-no-validation     | BUDGET_EXCEEDED        |     1 |
| prism-no-validation     | MODEL_OUTPUT_ERROR     |     3 |
| prism-no-validation     | STALE_TARGET           |     2 |
| raw-selector            | INVALID_ACTION         |     3 |
| raw-selector            | MODEL_OUTPUT_ERROR     |     6 |
| raw-selector            | STALE_TARGET           |     2 |

### Repeat variance

19/96 task/variant groups have mixed success outcomes. 26/96 vary in success, failure,
steps, calls, wrong targets, validation or stale events. Temperature 0 did not guarantee
identical behavior. Latency differences alone do not flag variance.

| Task           | Variant                 | Runs | Mixed success | Mixed behavior |
| -------------- | ----------------------- | ---: | ------------- | -------------- |
| ambiguity-001  | prism-no-stale-recovery |    3 | true          | true           |
| ambiguity-001  | prism-no-validation     |    3 | true          | true           |
| ambiguity-002  | prism-full              |    3 | true          | true           |
| ambiguity-002  | prism-no-stale-recovery |    3 | true          | true           |
| ambiguity-002  | raw-selector            |    3 | true          | true           |
| ambiguity-003  | raw-selector            |    3 | true          | true           |
| ambiguity-005  | raw-selector            |    3 | true          | true           |
| ambiguity-007  | prism-full              |    3 | true          | true           |
| ambiguity-008  | prism-full              |    3 | true          | true           |
| ambiguity-008  | prism-no-stale-recovery |    3 | true          | true           |
| ambiguity-010  | raw-selector            |    3 | true          | true           |
| form-001       | prism-no-validation     |    3 | false         | true           |
| form-001       | raw-selector            |    3 | true          | true           |
| grounding-001  | prism-full              |    3 | true          | true           |
| grounding-001  | prism-no-stale-recovery |    3 | true          | true           |
| grounding-003  | prism-full              |    3 | true          | true           |
| grounding-003  | prism-no-stale-recovery |    3 | false         | true           |
| grounding-003  | prism-no-validation     |    3 | true          | true           |
| grounding-004  | prism-no-validation     |    3 | false         | true           |
| navigation-001 | prism-full              |    3 | true          | true           |
| stale-001      | prism-full              |    3 | true          | true           |
| stale-001      | prism-no-validation     |    3 | false         | true           |
| stale-003      | prism-no-validation     |    3 | false         | true           |
| stale-004      | prism-full              |    3 | false         | true           |
| stale-004      | prism-no-validation     |    3 | false         | true           |
| stale-004      | raw-selector            |    3 | true          | true           |

### Per-task success rates

| Task           | Variant                 | Runs | Success Rate | Wilson 95% CI |
| -------------- | ----------------------- | ---: | -----------: | ------------- |
| ambiguity-001  | prism-full              |    3 | 100.0% (3/3) | 43.9–100.0%   |
| ambiguity-001  | prism-no-stale-recovery |    3 |  66.7% (2/3) | 20.8–93.9%    |
| ambiguity-001  | prism-no-validation     |    3 |  66.7% (2/3) | 20.8–93.9%    |
| ambiguity-001  | raw-selector            |    3 | 100.0% (3/3) | 43.9–100.0%   |
| ambiguity-002  | prism-full              |    3 |  33.3% (1/3) | 6.1–79.2%     |
| ambiguity-002  | prism-no-stale-recovery |    3 |  66.7% (2/3) | 20.8–93.9%    |
| ambiguity-002  | prism-no-validation     |    3 | 100.0% (3/3) | 43.9–100.0%   |
| ambiguity-002  | raw-selector            |    3 |  66.7% (2/3) | 20.8–93.9%    |
| ambiguity-003  | prism-full              |    3 | 100.0% (3/3) | 43.9–100.0%   |
| ambiguity-003  | prism-no-stale-recovery |    3 | 100.0% (3/3) | 43.9–100.0%   |
| ambiguity-003  | prism-no-validation     |    3 | 100.0% (3/3) | 43.9–100.0%   |
| ambiguity-003  | raw-selector            |    3 |  66.7% (2/3) | 20.8–93.9%    |
| ambiguity-004  | prism-full              |    3 | 100.0% (3/3) | 43.9–100.0%   |
| ambiguity-004  | prism-no-stale-recovery |    3 | 100.0% (3/3) | 43.9–100.0%   |
| ambiguity-004  | prism-no-validation     |    3 | 100.0% (3/3) | 43.9–100.0%   |
| ambiguity-004  | raw-selector            |    3 | 100.0% (3/3) | 43.9–100.0%   |
| ambiguity-005  | prism-full              |    3 | 100.0% (3/3) | 43.9–100.0%   |
| ambiguity-005  | prism-no-stale-recovery |    3 | 100.0% (3/3) | 43.9–100.0%   |
| ambiguity-005  | prism-no-validation     |    3 | 100.0% (3/3) | 43.9–100.0%   |
| ambiguity-005  | raw-selector            |    3 |  66.7% (2/3) | 20.8–93.9%    |
| ambiguity-006  | prism-full              |    3 | 100.0% (3/3) | 43.9–100.0%   |
| ambiguity-006  | prism-no-stale-recovery |    3 | 100.0% (3/3) | 43.9–100.0%   |
| ambiguity-006  | prism-no-validation     |    3 | 100.0% (3/3) | 43.9–100.0%   |
| ambiguity-006  | raw-selector            |    3 | 100.0% (3/3) | 43.9–100.0%   |
| ambiguity-007  | prism-full              |    3 |  66.7% (2/3) | 20.8–93.9%    |
| ambiguity-007  | prism-no-stale-recovery |    3 | 100.0% (3/3) | 43.9–100.0%   |
| ambiguity-007  | prism-no-validation     |    3 | 100.0% (3/3) | 43.9–100.0%   |
| ambiguity-007  | raw-selector            |    3 | 100.0% (3/3) | 43.9–100.0%   |
| ambiguity-008  | prism-full              |    3 |  66.7% (2/3) | 20.8–93.9%    |
| ambiguity-008  | prism-no-stale-recovery |    3 |  66.7% (2/3) | 20.8–93.9%    |
| ambiguity-008  | prism-no-validation     |    3 | 100.0% (3/3) | 43.9–100.0%   |
| ambiguity-008  | raw-selector            |    3 | 100.0% (3/3) | 43.9–100.0%   |
| ambiguity-009  | prism-full              |    3 | 100.0% (3/3) | 43.9–100.0%   |
| ambiguity-009  | prism-no-stale-recovery |    3 | 100.0% (3/3) | 43.9–100.0%   |
| ambiguity-009  | prism-no-validation     |    3 | 100.0% (3/3) | 43.9–100.0%   |
| ambiguity-009  | raw-selector            |    3 | 100.0% (3/3) | 43.9–100.0%   |
| ambiguity-010  | prism-full              |    3 | 100.0% (3/3) | 43.9–100.0%   |
| ambiguity-010  | prism-no-stale-recovery |    3 | 100.0% (3/3) | 43.9–100.0%   |
| ambiguity-010  | prism-no-validation     |    3 | 100.0% (3/3) | 43.9–100.0%   |
| ambiguity-010  | raw-selector            |    3 |  66.7% (2/3) | 20.8–93.9%    |
| ambiguity-011  | prism-full              |    3 | 100.0% (3/3) | 43.9–100.0%   |
| ambiguity-011  | prism-no-stale-recovery |    3 | 100.0% (3/3) | 43.9–100.0%   |
| ambiguity-011  | prism-no-validation     |    3 | 100.0% (3/3) | 43.9–100.0%   |
| ambiguity-011  | raw-selector            |    3 | 100.0% (3/3) | 43.9–100.0%   |
| form-001       | prism-full              |    3 | 100.0% (3/3) | 43.9–100.0%   |
| form-001       | prism-no-stale-recovery |    3 | 100.0% (3/3) | 43.9–100.0%   |
| form-001       | prism-no-validation     |    3 | 100.0% (3/3) | 43.9–100.0%   |
| form-001       | raw-selector            |    3 |  33.3% (1/3) | 6.1–79.2%     |
| grounding-001  | prism-full              |    3 |  66.7% (2/3) | 20.8–93.9%    |
| grounding-001  | prism-no-stale-recovery |    3 |  66.7% (2/3) | 20.8–93.9%    |
| grounding-001  | prism-no-validation     |    3 | 100.0% (3/3) | 43.9–100.0%   |
| grounding-001  | raw-selector            |    3 | 100.0% (3/3) | 43.9–100.0%   |
| grounding-002  | prism-full              |    3 | 100.0% (3/3) | 43.9–100.0%   |
| grounding-002  | prism-no-stale-recovery |    3 | 100.0% (3/3) | 43.9–100.0%   |
| grounding-002  | prism-no-validation     |    3 | 100.0% (3/3) | 43.9–100.0%   |
| grounding-002  | raw-selector            |    3 | 100.0% (3/3) | 43.9–100.0%   |
| grounding-003  | prism-full              |    3 |  66.7% (2/3) | 20.8–93.9%    |
| grounding-003  | prism-no-stale-recovery |    3 | 100.0% (3/3) | 43.9–100.0%   |
| grounding-003  | prism-no-validation     |    3 |  33.3% (1/3) | 6.1–79.2%     |
| grounding-003  | raw-selector            |    3 | 100.0% (3/3) | 43.9–100.0%   |
| grounding-004  | prism-full              |    3 | 100.0% (3/3) | 43.9–100.0%   |
| grounding-004  | prism-no-stale-recovery |    3 | 100.0% (3/3) | 43.9–100.0%   |
| grounding-004  | prism-no-validation     |    3 | 100.0% (3/3) | 43.9–100.0%   |
| grounding-004  | raw-selector            |    3 |   0.0% (0/3) | 0.0–56.1%     |
| grounding-005  | prism-full              |    3 | 100.0% (3/3) | 43.9–100.0%   |
| grounding-005  | prism-no-stale-recovery |    3 | 100.0% (3/3) | 43.9–100.0%   |
| grounding-005  | prism-no-validation     |    3 | 100.0% (3/3) | 43.9–100.0%   |
| grounding-005  | raw-selector            |    3 | 100.0% (3/3) | 43.9–100.0%   |
| navigation-001 | prism-full              |    3 |  66.7% (2/3) | 20.8–93.9%    |
| navigation-001 | prism-no-stale-recovery |    3 | 100.0% (3/3) | 43.9–100.0%   |
| navigation-001 | prism-no-validation     |    3 | 100.0% (3/3) | 43.9–100.0%   |
| navigation-001 | raw-selector            |    3 | 100.0% (3/3) | 43.9–100.0%   |
| stale-001      | prism-full              |    3 |  66.7% (2/3) | 20.8–93.9%    |
| stale-001      | prism-no-stale-recovery |    3 |   0.0% (0/3) | 0.0–56.1%     |
| stale-001      | prism-no-validation     |    3 | 100.0% (3/3) | 43.9–100.0%   |
| stale-001      | raw-selector            |    3 | 100.0% (3/3) | 43.9–100.0%   |
| stale-002      | prism-full              |    3 | 100.0% (3/3) | 43.9–100.0%   |
| stale-002      | prism-no-stale-recovery |    3 |   0.0% (0/3) | 0.0–56.1%     |
| stale-002      | prism-no-validation     |    3 | 100.0% (3/3) | 43.9–100.0%   |
| stale-002      | raw-selector            |    3 | 100.0% (3/3) | 43.9–100.0%   |
| stale-003      | prism-full              |    3 | 100.0% (3/3) | 43.9–100.0%   |
| stale-003      | prism-no-stale-recovery |    3 | 100.0% (3/3) | 43.9–100.0%   |
| stale-003      | prism-no-validation     |    3 | 100.0% (3/3) | 43.9–100.0%   |
| stale-003      | raw-selector            |    3 | 100.0% (3/3) | 43.9–100.0%   |
| stale-004      | prism-full              |    3 |   0.0% (0/3) | 0.0–56.1%     |
| stale-004      | prism-no-stale-recovery |    3 |   0.0% (0/3) | 0.0–56.1%     |
| stale-004      | prism-no-validation     |    3 |   0.0% (0/3) | 0.0–56.1%     |
| stale-004      | raw-selector            |    3 |  33.3% (1/3) | 6.1–79.2%     |
| stale-005      | prism-full              |    3 | 100.0% (3/3) | 43.9–100.0%   |
| stale-005      | prism-no-stale-recovery |    3 |   0.0% (0/3) | 0.0–56.1%     |
| stale-005      | prism-no-validation     |    3 | 100.0% (3/3) | 43.9–100.0%   |
| stale-005      | raw-selector            |    3 | 100.0% (3/3) | 43.9–100.0%   |
| stale-006      | prism-full              |    3 | 100.0% (3/3) | 43.9–100.0%   |
| stale-006      | prism-no-stale-recovery |    3 |   0.0% (0/3) | 0.0–56.1%     |
| stale-006      | prism-no-validation     |    3 | 100.0% (3/3) | 43.9–100.0%   |
| stale-006      | raw-selector            |    3 | 100.0% (3/3) | 43.9–100.0%   |

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
