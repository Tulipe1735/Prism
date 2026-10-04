# Relation ablation preparation

Prospective P0-A/P0-B study. There are 48 tasks × four arms = 192 cells per model, 384
across GLM and DeepSeek. Each task runs in every arm. Historical files stay unchanged.

The generator balances target positions and entity–group assignments. R/U expose the
same group lexemes and equal UTF-8 lengths; only `belongs_to` references differ.
Canonical alphabetical group IDs do not reveal candidate order. Local and Structural
keep the original formatter and extractor. Byte matching does not imply equal tokenizer
cost.

- [Protocol](../cohorts/relation-ablation-v1.protocol.md)
- [Design generator](generate.ts), [design table](plan.json)
- [Public relation rule](relations.ts), [payload builder](input.ts)
- [Model adapter](decision.ts), [run driver](run.ts), [analysis](analyze.ts)
- [Freeze tools](freeze.ts)

## Offline preparation (zero model calls)

```bash
node --experimental-strip-types --disable-warning=ExperimentalWarning \
  evals/relation-ablation/generate.ts --check

node --experimental-strip-types --disable-warning=ExperimentalWarning \
  evals/relation-ablation/cli.ts --provider scripted \
  --output work/relation-preparation-2026-10-04/scripted

PRISM_EVAL_CHROME=1 PRISM_IT_BROWSER_URL=http://127.0.0.1:9333 \
  node node_modules/vitest/vitest.mjs run \
  tests/evals/relation-ablation.browser.integration.test.ts \
  tests/evals/endpoint-coverage.browser.integration.test.ts
```

Scripted runs validate controls/oracles and never demonstrate model success. Mocked
response tests exercise the model parser and executor without contacting a service.

## Freeze and verify

After all recorded checks pass, a verification receipt must include `ok: true`, the
actual `browser_version` and the SHA256 of `JSON.stringify(await preparationFiles())`.
The receipt ties the checks to the exact method state. Create one source archive and
manifest for both model plans:

```bash
node --experimental-strip-types --disable-warning=ExperimentalWarning \
  evals/relation-ablation/freeze.ts \
  --out work/relation-preparation-2026-10-04/frozen \
  --verification work/relation-preparation-2026-10-04/verification.json

node --experimental-strip-types --disable-warning=ExperimentalWarning \
  evals/relation-ablation/freeze.ts \
  --verify work/relation-preparation-2026-10-04/frozen/freeze.json
```

The archive contains the prospective method and shared source dependencies. Historical
ignored raw data and external replay sources remain separate research artifacts; this
preparation archive does not claim to package every historical experiment.

## Real model calls (after quota/budget is available)

```bash
node --experimental-strip-types --disable-warning=ExperimentalWarning \
  evals/relation-ablation/cli.ts --provider model \
  --plan evals/cohorts/relation-ablation-v1-glm.json \
  --freeze work/relation-preparation-2026-10-04/frozen/freeze.json \
  --output evals/results/relation-ablation-v1
```

Run DeepSeek with its own plan and the same source freeze. No model dispatch is allowed
without a browser pin and an unchanged archive/manifest. Existing result files are never
overwritten. Each completed record is saved immediately, with raw response content and
usage; failed output validation never executes an action.
