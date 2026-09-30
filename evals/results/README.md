# Result retention

Generated JSONL and `.meta.json` plans are ignored by Git. Pilot and main use separate
files; retain every completed run, including failures. Do not replace failed
observations with retries. `--resume` only dispatches planned pairs without a completed
summary and refuses changed controls. Current reports use strict schema v3; historical
v2 data requires its saved source.

- `smoke.jsonl`: connectivity checks, excluded from primary estimates.
- `pilot.jsonl`: 24 tasks × 3 repeats × four variants, 288 planned runs.
- `main.jsonl`: 24 tasks × 5 repeats × four variants, 480 planned runs, conditional on
  pilot health.
- `preflight/`: preserved prompt/transport/harness debugging runs, excluded from primary
  estimates. These precede the final schema and need their original source to parse.
- `archive-milestone-1/`: preserved schema-v1 scripted evidence.

Sidecars contain expected/completed counts, frozen settings, hashes, schedule and final
status. A JSONL with fewer summaries than its plan is incomplete even if a partial
report can be generated. Copy the raw data with reports when sharing results. No API
keys or authorization headers are saved.

`primary-source.tar.gz` preserves the exact runtime, harness, task/fixture definitions,
cohort configs and dependency manifests used by the primary stages. It contains no
`.env`, credentials, browser profile or Git directory. Retain this snapshot with the
JSONL because the recorded Git base has uncommitted evaluation changes.

Milestone 3 outputs are `ambiguity-smoke.jsonl`, `ambiguity-initial.jsonl` (800 planned
runs), `ambiguity-extension.jsonl` (selected tasks, repeats 10–19), and separate
`modal-before.jsonl` / `modal-after.jsonl` diagnostic cohorts. These use schema v3.
Retain `ambiguity-source.tar.gz` with them. The earlier primary JSONL and
`primary-source.tar.gz` remain preserved under their original names.
