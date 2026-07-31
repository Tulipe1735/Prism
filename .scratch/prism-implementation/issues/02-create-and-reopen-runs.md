# 02 — Create and reopen Runs from the Field Desk

State: open
Status: ready-for-agent
Assignee: unassigned
Blocked by: issues/01-establish-field-desk-and-contracts.md

**What to build:** Let a user submit a validated repair request from the Field Desk, create a durable Prism Run, and reopen that Run after a page refresh. The GUI should expose the first real Run status while the immutable manifest, append-only journal, hashed artifacts, and rebuildable snapshot establish canonical server state.

- [ ] The repair form uses React Hook Form with the Zod resolver, prevents invalid submission, and preserves the original natural-language prompt.
- [ ] A successful submission creates a versioned Run Manifest, initial Run events, and a Run Snapshot, then navigates the user to the corresponding dossier.
- [ ] Run events validate against Zod schemas before append, sequence monotonically, and rebuild the same snapshot from an empty projection.
- [ ] Artifact content is addressed and verified by hash; a corrupted event or artifact is rejected with a visible terminal error rather than silently loaded.
- [ ] TanStack Query owns server-state fetching and mutation in the GUI, React Toastify reports submission outcomes, and Zustand is limited to ephemeral selections or filters rather than canonical Run state.
- [ ] Refreshing the application preserves the Run and allows it to be reopened from recent history without inventing or losing events.
