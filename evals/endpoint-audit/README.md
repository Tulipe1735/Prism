# endpoint-audit (P0-C)

Derived endpoint and oracle audit over the frozen confirmatory, replication and external
trajectories. **Zero model calls.** It answers the P0-C question in
[docs/research/research-audit-2026-10-04.md](../../docs/research/research-audit-2026-10-04.md)
§11: "does the mixed-layer claim come from the layers, or from the measurement?"

The tools read the frozen JSONL files, derive endpoints from the recorded steps, and
write only new derived output. They never re-score, edit or replace a frozen record. The
original failure label always stays next to the derived one.

- [ledger.ts](./ledger.ts) — derived ledger and failure classification
- [report.ts](./report.ts) — report tables
- [cli.ts](./cli.ts) — ledger and report CLI
- [coverage.ts](./coverage.ts) — read-only browser coverage check of the external
  selectors
- [coverage-cli.ts](./coverage-cli.ts) — coverage CLI

## Commands

```bash
# 1. Derived ledger and report for the four frozen cohorts (no browser needed)
node --experimental-strip-types --disable-warning=ExperimentalWarning \
  evals/endpoint-audit/cli.ts --out work/endpoint-audit

# 2. External audit coverage check (needs Chrome and the preserved source tree)
PRISM_EVAL_CHROME=1 \
node --experimental-strip-types --disable-warning=ExperimentalWarning \
  evals/endpoint-audit/coverage-cli.ts --out work/endpoint-audit

# 3. Tests
npx vitest run tests/evals/endpoint-audit.test.ts
```

`work/` is Git-ignored. Copy `work/endpoint-audit/` into the research bundle before
sharing the paper material.

## What the audit establishes

- **The frozen records are internally consistent.** The derived ledger recomputes the
  executed step count, the wrong-input count and the grounding flag for all 840
  summaries. It finds no contradiction with the recorded values.
- **The two endpoints differ by design, and the difference is large on the external
  pages.** Grounding is much higher than strict task success there, so the arm ranking
  depends on which endpoint is read.
- **Five external rows carry no recorded failure label.** The frozen external writer
  adds a strict/DONE condition after its own classification and does not re-derive the
  label. The derived label is deterministic; the frozen record stays unchanged.
- **External coverage is state-dependent.** Several tasks intentionally match multiple
  controls because the goal has multiple steps; that alone is not an oracle defect. A
  known-control browser test proves that the tabs ancestor reaches the goal while the
  frozen audit calls it neutral. A separate control verifies that the visible sign-in
  password input is excluded. Hidden future-step controls are reported separately.

The audit reports these as measurement properties. It does not convert a missing scored
attempt into a wrong selection.
