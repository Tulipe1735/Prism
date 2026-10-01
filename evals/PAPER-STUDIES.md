# Paper study registry

The paper has three primary research questions: action representation and grounding,
adaptive context expansion, and end-to-end context efficiency. See the frozen
[confirmatory preregistration](cohorts/paper-confirmatory-v1.protocol.md) for exact RQs,
outcome definitions, denominators, matched analysis and claim limits.

| Evidence status | Study                                           | Treatment in this milestone                                               |
| --------------- | ----------------------------------------------- | ------------------------------------------------------------------------- |
| Exploratory     | ambiguity-initial                               | Historical raw results/reports/config/tasks/fixtures preserved; no resume |
| Exploratory     | ambiguity-adaptive-v1 pilot                     | Historical raw results/reports/freeze/source archive preserved; no resume |
| Exploratory     | Previous stale-recovery / validation pilot/main | Historical evidence, excluded from confirmatory estimates                 |
| Exploratory     | Delayed-modal diagnostic                        | Historical diagnostic, excluded from confirmatory estimates               |
| Confirmatory    | paper-confirmatory-v1                           | New 12-task, 5-repeat, 4-arm preregistered cohort; 240 cells only         |

No historical reports have been rewritten to apply the new framing. The pre-edit SHA256
inventory is `cohorts/paper-confirmatory-v1.historical.json`; the new runner audits it.

Use Node v22.23.2 and Chrome for Testing 153.0.8010.12 on loopback port9333 with a
dedicated headless browser profile. Use the existing TEXT_MODEL_API_KEY environment
variable/.env without logging it. No second model or automatic repeat extension.

```sh
# Before freeze: execute unit, browser, type, lint and build checks, save verification.
node --experimental-strip-types evals/runners/confirmatory-controls.ts freeze
node --experimental-strip-types evals/runners/confirmatory-controls.ts verify
pnpm eval:cohort --config evals/cohorts/paper-confirmatory-v1.json
# Only if interrupted: preserve completed failures and run missing cells.
pnpm eval:cohort --config evals/cohorts/paper-confirmatory-v1.json --resume
python3 evals/analysis/paper-confirmatory-v1.py
```

The runner requires the frozen manifest and canonical output, verifies controls before
every dispatch, checkpoints complete run batches, and refuses changed controls on
resume. The freeze is exclusive and cannot be replaced. Report generation writes only
the new report, analysis and integrity artifacts. It performs no model calls.

Primary deliverable: `reports/paper-confirmatory-v1.md`. Supporting artifacts: the
freeze/verification/integrity manifests, full analysis including paired per-task effects
and every adaptive observation, canonical raw JSONL/sidecar and exact source archive.
Raw result JSONL and source archives follow the repository's existing Git-ignore policy;
retain them with the paper's research artifacts rather than assuming Git preserves them.
