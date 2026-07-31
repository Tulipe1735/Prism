# 02 — Create and reopen Runs from the Field Desk

State: closed
Status: ready-for-agent
Assignee: codex
Blocked by: issues/01-establish-field-desk-and-contracts.md

**What to build:** Let a user submit a validated repair request from the Field Desk, create a durable Prism Run, and reopen that Run after a page refresh. The GUI should expose the first real Run status while the immutable manifest, append-only journal, hashed artifacts, and rebuildable snapshot establish canonical server state.

- [x] The repair form uses React Hook Form with the Zod resolver, prevents invalid submission, and preserves the original natural-language prompt.
- [x] A successful submission creates a versioned Run Manifest, initial Run events, and a Run Snapshot, then navigates the user to the corresponding dossier.
- [x] Run events validate against Zod schemas before append, sequence monotonically, and rebuild the same snapshot from an empty projection.
- [x] Artifact content is addressed and verified by hash; a corrupted event or artifact is rejected with a visible terminal error rather than silently loaded.
- [x] TanStack Query owns server-state fetching and mutation in the GUI, React Toastify reports submission outcomes, and Zustand is limited to ephemeral selections or filters rather than canonical Run state.
- [x] Refreshing the application preserves the Run and allows it to be reopened from recent history without inventing or losing events.

## Resolution

Implemented durable Run creation and reopening through the shared versioned
contracts, a filesystem trajectory store, and real Field Desk server state. The
manifest and append-only journal are canonical, artifacts are SHA-256 addressed
and verified, and the snapshot is rebuilt from journal events instead of trusted
as an independent source of truth. Integrity failures now become visible terminal
dossiers.

The GUI submits with React Hook Form and the Zod resolver, navigates to the new
dossier, fetches server state with TanStack Query, reports outcomes with React
Toastify, and keeps only the history filter in Zustand. The shared ESLint flat
configuration was also migrated to `@antfu/eslint-config`.

Verified with formatting, Antfu ESLint, typecheck, 36 Vitest tests, a production
Next.js build, and a live local HTTP flow covering create, reopen, recent history,
and artifact-corruption failure.
