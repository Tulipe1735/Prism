# External Validation Study v1

Independent validation of frozen representation methods on 15 externally authored tasks.
See `../cohorts/external-validation-v1.protocol.md`. No production or historical study
file is modified. Source replay files live under
`.scratch/external-validation-v1/sources`; the frozen archive retains those files and
their exact bytes. Task/model/runtime/prompt hashes are in the exclusive freeze.

Use Node 22.23.2 and the existing pnpm 9.15.9 dependencies. Start the pinned Chrome for
Testing 153.0.8010.12 with the existing dedicated-profile/headless workflow on
port 9334. Keep the existing `TEXT_MODEL_API_KEY` environment or `.env`; never log it.

```sh
# Before model execution; checks contain no live model calls.
node --experimental-strip-types evals/external/preflight.ts
PRISM_EVAL_CHROME=1 PRISM_IT_CHROME=1 \
  PRISM_IT_BROWSER_URL=http://127.0.0.1:9334 pnpm test
pnpm typecheck
pnpm lint
pnpm build
# Persist verification before freezing. Freeze is exclusive and cannot be replaced.
node --experimental-strip-types evals/external/controls.ts freeze
node --experimental-strip-types evals/external/controls.ts verify
node --experimental-strip-types evals/external/cohort.ts
# Only for an interruption: never repeat a completed failure.
node --experimental-strip-types evals/external/cohort.ts --resume
python3 evals/analysis/external-validation-v1.py
```

Results remain separate per model, with a shared 360-cell plan, passive response log and
external audit JSONL. Resume refuses duplicate cells, changed controls, orphan audits
and missing matching evidence. Interrupted active requests may already consume provider
usage; never silently discard an inconsistent checkpoint.

The report is `evals/reports/external-validation-v1.md`. Retain the ignored raw JSONL
and source archive with the paper artifacts. A checkout alone does not preserve them.
Real-time source snapshots cannot guarantee stable future network responses.
