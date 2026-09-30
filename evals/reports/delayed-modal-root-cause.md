# Delayed-modal diagnosis

Diagnosis recorded before implementing an intervention. The original fixture is
unchanged.

The first main cohort retained 20 failures: 16 STALE_TARGET, three MODEL_OUTPUT_ERROR,
and one BUDGET_EXCEEDED. In the inspected repeat-2 traces, recovery-enabled full,
no-validation and selector policies each repeatedly chose Save draft six times; the
executor rejected it as covered. No-recovery stopped on the first rejection.

An independent browser probe on the same fixture confirms:

- The dialog is open and matches `:modal` immediately after the acknowledged mutation.
- Save draft still passes `checkVisibility`, is not disabled, and remains in the
  snapshot.
- Hit testing its center returns DIALOG. Input is correctly rejected.
- Dismiss update notice is present in that same observation.
- Dismissing the notice and then selecting Save draft reaches Draft saved with the
  existing executor. See `delayed-modal-diagnostic.json`.

The dominant mechanism is a mismatch between observed eligibility and executable
eligibility under a native modal, combined with policy reselection of a blocked action.
The new target is not missing. Random timing, insufficient waits, and an executor input
failure are not needed to explain this reproduction. Recovery exhausts its retry bound;
that bound is a consequence, not the originating fault. Failed attempts are not included
in executed-action history, which can reinforce repeated identical model inputs.
Model-output errors remain a separate contributing failure.

The smallest experiment is an eval-only observation filter that removes candidates
outside the active native dialog. It retains the production snapshot, freshness guards,
executor, budgets, prompts and fixture. The intervention is kept separate from the
ambiguity study and is not a general occlusion solver or a production default change. A
fresh, fixed-model before/after comparison will report all failures and costs.

## Fresh fixed-model intervention results

Both ten-run cohorts use the same frozen source, fixture, model/settings, prompt format,
validation, browser/viewport, budgets and executor. Only modalPolicy differs (observed
vs active-dialog). These fresh runs use schema-v3 formatted role descriptions; the
original schema-v2 main failures are diagnostic history and are not pooled into this
comparison. Cohorts ran sequentially, so provider load and temporal effects remain
possible.

| Treatment                    | Success | Final oracle attained | Repeat-level Wilson 95% CI | Executed actions | Stale detections | LLM HTTP calls | Avg latency (s) |
| ---------------------------- | ------: | --------------------: | -------------------------- | ---------------: | ---------------: | -------------: | --------------: |
| Original observed candidates |    0/10 |                  0/10 | 0.0% to 27.8%              |                0 |               50 |             57 |          134.11 |
| Active-dialog candidates     |    9/10 |                 10/10 | 59.6% to 98.2%             |               20 |               10 |             41 |           68.24 |

| Treatment     | Failure            | Count |
| ------------- | ------------------ | ----: |
| Original      | BUDGET_EXCEEDED    |     2 |
| Original      | MODEL_OUTPUT_ERROR |     4 |
| Original      | STALE_TARGET       |     4 |
| Active-dialog | MODEL_OUTPUT_ERROR |     1 |

The intervention directly tests candidate eligibility under the native modal. It does
not change waits, failed-action feedback, success criteria or execution. Successful
traces must dismiss the notice and then save the draft; residual format/budget failures
remain visible. These ten repeats support conclusions only about this fixture and
generative policy. Wilson intervals assume independent repeats, which provider effects
may violate. The filter is implemented in the eval observation adapter; production
CLI/MCP and the byte-identical vendored snapshot are unchanged. Multiple modal stacks,
custom aria-modal overlays and general occlusion are untested.

All fresh runs:

| Treatment | Repeat | Success | Failure            | Run id                               |
| --------- | -----: | ------- | ------------------ | ------------------------------------ |
| before    |      1 | false   | STALE_TARGET       | a03cbef0-e59a-4cec-b70e-8131e58e2a55 |
| before    |      3 | false   | STALE_TARGET       | 84254601-d5cf-4d8b-b77a-39457c64a85d |
| before    |      0 | false   | MODEL_OUTPUT_ERROR | ac2504b8-e0d8-4243-a337-528633bc51cc |
| before    |      2 | false   | MODEL_OUTPUT_ERROR | 3af92580-e7a8-4c35-a79d-fe78a826f30d |
| before    |      4 | false   | MODEL_OUTPUT_ERROR | 12dfc375-f080-4b15-8a3f-cd926513486a |
| before    |      7 | false   | STALE_TARGET       | 36756329-ede2-44b9-92b4-60764f348091 |
| before    |      5 | false   | BUDGET_EXCEEDED    | 0a3abb24-b7f6-4e87-a55e-c6b89d5e0f35 |
| before    |      6 | false   | BUDGET_EXCEEDED    | 2fca0a34-8b9f-4274-b04b-dcda1cd88e00 |
| before    |      8 | false   | MODEL_OUTPUT_ERROR | a08b2762-ccd7-4ec9-b763-1d92281234fd |
| before    |      9 | false   | STALE_TARGET       | b8cabb52-f02a-4291-8239-6e6e0ef959dc |
| after     |      1 | true    | —                  | 03b8d521-0fe1-4c42-8aa3-13d4399c0cff |
| after     |      3 | true    | —                  | 89f45e38-50e8-4f81-a620-46596406690e |
| after     |      2 | false   | MODEL_OUTPUT_ERROR | 39afbac2-411f-4af8-bd14-1ac1e5d2aad2 |
| after     |      0 | true    | —                  | 42442551-2570-40ba-9f7d-a2783310e2cf |
| after     |      5 | true    | —                  | 30a80630-7f31-48e2-a53e-bb08fa542aa2 |
| after     |      7 | true    | —                  | c893046a-10df-4657-b6a5-0982a90a5d4b |
| after     |      4 | true    | —                  | 26211f4e-03a3-4546-9763-cb9615cfb2ac |
| after     |      6 | true    | —                  | cdf4a431-7a76-4662-904a-95c09a177e8f |
| after     |      8 | true    | —                  | 21453b3b-7bbc-4a33-b6fd-e22203e5b57c |
| after     |      9 | true    | —                  | a55241b8-46c1-4371-92a0-0aa21dc2142f |
