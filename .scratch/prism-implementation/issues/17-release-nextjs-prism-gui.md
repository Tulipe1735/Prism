# 17 — Release the Next.js Prism GUI

State: open
Status: ready-for-agent
Assignee: unassigned
Blocked by: issues/16-run-and-analyze-evaluations.md

**What to build:** Deliver Prism as a production-buildable Next.js GUI whose Field Desk, Run history, live dossier, artifacts, approvals, recovery states, and evaluation results are all backed by real contracts and runtime state. Package the verified product and its release evidence without introducing a CLI as the primary user surface.

- [ ] The workspace-level Field Desk can create a repair Run, list recent Runs, reopen a Run, and navigate to its full dossier with no remaining prototype mock data.
- [ ] The dossier exposes the immutable DAG revisions, runtime activity, events, effect lease, patch and test evidence, Browser Baseline and verification, approvals, recovery, budgets, and terminal result.
- [ ] Artifact previews cover screenshots, verification reports, patches, test output, and traces with bounded loading, redaction, missing-artifact handling, and integrity status.
- [ ] The Next.js production build, workspace typecheck, lint, deterministic tests, and Playwright GUI journey pass on the supported local development shape, including a Windows workspace path containing spaces.
- [ ] Accessibility checks cover keyboard navigation, focus management, status announcements, approval controls, tables, charts, and evidence dialogs.
- [ ] Process shutdown and restart leave no leaked browser or command process, and a reopened GUI reconstructs state from the Journal rather than browser persistence.
- [ ] Release Evidence records pinned dependency and runtime versions, supported environments, evaluation results, known limitations, reproduction steps, and links to the committed evidence set.
