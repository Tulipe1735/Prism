# Prism 0.1.0 release evidence

Evidence date: 2026-08-16  
Verified base revision: `073eb5bf716c2c74be93c426299ef163bc91b99d`  
Release changes: current ticket 17 working tree; commit hash is assigned only when the user commits it.

## Runtime and supported shape

- Node.js `>=22.19.0` (`v22.23.2` used here), pnpm `9.15.9`, TypeScript `5.9.3`, Turborepo `2.10.7`.
- Next.js `15.5.21`, React/React DOM `19.2.8`, Zod `4.4.3`.
- Pi SDK packages `0.82.1`; TanStack Table `9.1.2`, Recharts `3.10.1`, date-fns `4.4.0`.
- Verified local shape: Linux/WSL Node process, Chromium, and one configured local workspace. A Windows-style path is normalized case-insensitively; command execution is exercised from a real temporary path containing spaces.
- `PRISM_DATA_DIR` contains the append-only journals, snapshots, evaluations, and SHA-256 artifacts. Browser storage is not canonical state.

## Reproduction

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
NEXT_TELEMETRY_DISABLED=1 pnpm build
```

Start the GUI with an explicit durable data directory and workspace:

```bash
PRISM_WORKSPACE_PATH="/path/with spaces/project" \
PRISM_DATA_DIR="/path/to/prism-data" \
pnpm dev
```

Open `/`, create a Run, use `/runs` to reopen it, and inspect its dossier. The
dossier links every committed artifact through
`/api/runs/<runId>/artifacts/<sha256>`. PNG evidence up to 5 MiB and text/JSON
evidence up to 256 KiB are previewed in a native dialog; larger or binary
evidence remains metadata-only and opens through the verified raw route.

## Verification result

- `pnpm typecheck`: passed in all 10 packages with a typecheck task.
- `pnpm lint`: passed in all 10 packages with a lint task.
- `pnpm test`: passed in all 11 workspace packages. The web suite passed 30/30 tests, including all six end-to-end repair scenarios; the Oracle suite passed 37/37, including its built-fixture real-Chromium integration.
- `pnpm format:check`: passed.
- `NEXT_TELEMETRY_DISABLED=1 pnpm build`: passed. Next.js produced the Field Desk, Run history/dossier, evaluation routes, and their APIs as production output.
- Real Chromium GUI journey: Tab reached Preview in three presses; Enter opened a labelled native dialog and focused Close; Escape returned focus to Preview. A deliberately missing artifact produced both the terminal integrity error and dialog alert, then recovered after the artifact and server were restored. At 390 × 844, document `scrollWidth` and `clientWidth` were both 390 and the primary controls measured 44 px high.
- Shutdown/restart: port 3100 refused connections after shutdown, no Chromium or Next process remained, and restart with the same `PRISM_DATA_DIR` reconstructed the same `COMMITTED RUN / JOURNAL #2` queued dossier.

## Evaluation result and limitations

- The evaluation GUI creates three attempts for each of six React scenarios and reconstructs pass/fail from committed Run evidence. A release-ready capability result requires at least two passes per scenario and fifteen overall.
- The frozen twelve-task SWE-bench Verified comparison is setup-excluded unless official paired direct/embedded results are supplied with `PRISM_SWE_BENCH_RESULTS_PATH`. Prism does not fabricate a score when the Docker harness result is absent.
- This local release pass validates the runner, evidence gates, replay, and bounded resource accounting. It does not claim a new 18-attempt model score unless those provider-backed attempts are actually completed.
- The GUI is a local developer product. Hosted multi-user deployment, authentication, and future GitHub/Vercel/Supabase dashboard adapters are outside this release.

## Committed evidence set

- Ticket acceptance: [ticket 17](../.scratch/prism-implementation/issues/17-release-nextjs-prism-gui.md)
- Evaluation design and prior acceptance: [ticket 16](../.scratch/prism-implementation/issues/16-run-and-analyze-evaluations.md)
- Deterministic scenario evidence: `packages/oracle/src/scenarios/`
- Runtime replay and process-cleanup evidence: `packages/trajectory-store/src/trajectory-store.test.ts`, `packages/workspace-executor/src/workspace-executor.test.ts`, and `packages/runtime-pi/src/runtime-pi.test.ts`
- Per-Run journal, approval, patch, test, trace, screenshot, verification, and completion evidence: reopen the Run dossier from `/runs`; artifact URLs are content-addressed by the recorded SHA-256.
