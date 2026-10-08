# Prism CLI contract and binding studies

These are new research methods for the current external-agent CLI. They do not replace
the historical internal-agent cohorts, freezes or results.

| Block                                         | Method                                                               | Planned records | Real model requests |
| --------------------------------------------- | -------------------------------------------------------------------- | --------------: | ------------------: |
| Observation and gate mechanisms               | [protocol.md](protocol.md), [run.ts](run.ts)                         |             720 |                   0 |
| First choice under Bound/Unbound observations | [model-protocol.md](model-protocol.md), [model-run.ts](model-run.ts) |             192 |         at most 192 |
| Selected evidence after a richer observation  | [scope-protocol.md](scope-protocol.md), [scope-run.ts](scope-run.ts) |              24 |                   0 |

Node 22.23.2, existing project dependencies, and a dedicated Chrome CDP endpoint are
required. The completed 2026-10-05 blocks used Chrome/153.0.8010.12 and the local source
CLI at package version 0.1.6. The model block used the existing OpenCode Go endpoint,
GLM-5.3-flash and DeepSeek-v4.1-flash; all 192 requests are accounted for, with no
retry.

## Reproducibility and interpretation

Each output directory is exclusive. It contains a pre-execution source archive and hash
manifest, plan, raw records, receipts, derived results and end-of-block integrity
checks. `work/` is Git-ignored; a repository checkout does not preserve these research
artifacts. The source tarballs deliberately omit credentials, dependency binaries and
original historical raw results. Preserve the full paper bundle separately.

The 720-record block contains 96 coverage captures, 576 primary action cases, 16
truncation cases and 32 actual CLI parity cases. Its controller knows the initially
correct target. It measures conditional tool behavior, not model success.

The 192-call block uses a minimal one-decision external caller, not a full coding agent.
The model chooses a real observation-bound CLI ref and the caller executes it. Bound and
Unbound projections have identical vocabulary and byte length within a view; only
binding values differ. No goal oracle is provided to the model. Null is valid
abstention. Provider usage is separate from representation bytes and is not a price
estimate.

**Statistical-unit correction:** the four DOM families become only 18 semantic input
classes after the projection removes DOM-specific details. Actual UUIDs/URLs still
differ. Do not treat 192 calls, 24 states or eight DOM skeletons as independent model
tasks. The original planned bootstrap remains recorded, but its degenerate intervals are
not population evidence. Run [semantic-audit.ts](semantic-audit.ts) for the explicit
post-hoc construct audit; it preserves raw data and the original frozen analysis.

The 24-record scope block is a separately frozen post-hoc follow-up. The fixed task-type
rule demonstrates API expressiveness, not autonomous minimal-dependency inference.

## Commands

Choose fresh output directories. Smoke/dry-run artifacts are development checks and must
stay separate from final research records.

```bash
node --experimental-strip-types --disable-warning=ExperimentalWarning \
  evals/cli-contract-v1/run.ts --smoke --out work/cli-contract-development-new

node --experimental-strip-types --disable-warning=ExperimentalWarning \
  evals/cli-contract-v1/run.ts --out work/cli-contract-final-new

node --experimental-strip-types --disable-warning=ExperimentalWarning \
  evals/cli-contract-v1/model-run.ts --dry-run --out work/cli-model-development-new

node --experimental-strip-types --disable-warning=ExperimentalWarning \
  evals/cli-contract-v1/scope-run.ts --out work/cli-selected-evidence-new
```

The real model command below makes up to 192 **additional** requests. The completed
2026-10-05 budget has already been used. Do not rerun it as a routine check. It reads
`TEXT_MODEL_API_KEY` from the environment or local `.env`, never writes the key or
authorization header, and stops scheduling on quota/auth or model-identity errors.

```bash
node --experimental-strip-types --disable-warning=ExperimentalWarning \
  evals/cli-contract-v1/model-run.ts --out work/cli-binding-another-authorized-block

node --experimental-strip-types --disable-warning=ExperimentalWarning \
  evals/cli-contract-v1/semantic-audit.ts --out work/cli-binding-another-authorized-block
```

See
[the audit and next-stage plan](../../docs/research/cli-contract-audit-2026-10-05.md)
for claim boundaries, observed failures and the minimal remaining experiments.
