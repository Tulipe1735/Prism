# 17 — Release the Next.js Prism GUI

State: closed
Status: ready-for-agent
Assignee: codex
Blocked by: issues/16-run-and-analyze-evaluations.md

**What to build:** Deliver Prism as a production-buildable Next.js GUI whose Field Desk, Run history, live dossier, artifacts, approvals, recovery states, and evaluation results are all backed by real contracts and runtime state. Package the verified product and its release evidence without introducing a CLI as the primary user surface.

- [x] The workspace-level Field Desk can create a repair Run, list recent Runs, reopen a Run, and navigate to its full dossier with no remaining prototype mock data.
- [x] The dossier exposes the immutable DAG revisions, runtime activity, events, effect lease, patch and test evidence, Browser Baseline and verification, approvals, recovery, budgets, and terminal result.
- [x] Artifact previews cover screenshots, verification reports, patches, test output, and traces with bounded loading, redaction, missing-artifact handling, and integrity status.
- [x] The Next.js production build, workspace typecheck, lint, deterministic tests, and Playwright GUI journey pass on the supported local development shape, including a Windows workspace path containing spaces.
- [x] Accessibility checks cover keyboard navigation, focus management, status announcements, approval controls, tables, charts, and evidence dialogs.
- [x] Process shutdown and restart leave no leaked browser or command process, and a reopened GUI reconstructs state from the Journal rather than browser persistence.
- [x] Release Evidence records pinned dependency and runtime versions, supported environments, evaluation results, known limitations, reproduction steps, and links to the committed evidence set.

## Resolution

Released the existing Next.js GUI vertical slice without adding a CLI, hosting
layer, or dependency. The Run dossier now gives every content-addressed artifact
a bounded native-dialog preview: small PNG and text evidence load inline,
oversized or binary traces remain metadata-only, and missing or corrupt evidence
fails visibly. Status announcements and 44 px effect/workspace/preview controls
complete the existing keyboard, table, chart, approval, and dialog semantics.

Added deterministic coverage for Windows-style workspace paths and real command
execution from a path containing spaces. Isolated the round-button known-bad
state inside its tracer-bullet test, so the complete six-scenario suite no
longer depends on the repository's repaired fixture. Updated the README and
technical baseline, and added `docs/RELEASE-EVIDENCE.md` with pinned versions,
reproduction commands, honest evaluation exclusions, and evidence links.

Verified all workspace typechecks, lint tasks, tests, formatting, the production
build, and `git diff --check`. A real Chromium keyboard/mobile/missing-artifact
journey passed; after deliberate shutdown no server or browser process remained,
and restart reconstructed the same dossier from its Journal.
