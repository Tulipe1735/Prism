# 03 — Run confined Workspace inspection from a dossier

State: open
Status: ready-for-agent
Assignee: unassigned
Blocked by: issues/02-create-and-reopen-runs.md

**What to build:** Let a Prism Run request a bounded repository inspection and test command through the WorkspaceExecutor, then show the resulting evidence in the Run dossier. The user should be able to see what was inspected and why unsafe or runaway work was stopped.

- [ ] A typed workspace request can read allowlisted files, discover files using repository ignore rules, and run an allowlisted test command inside the selected workspace.
- [ ] Path traversal, symlink escape, disallowed command shapes, unexpected working directories, and writes outside the scoped workspace fail closed and emit structured evidence.
- [ ] Command timeout or Run cancellation terminates the complete spawned process tree on supported Windows and POSIX development environments without leaving a process behind.
- [ ] Command, patch, and test results are bounded, redacted where required, stored as artifacts, and visible from the Run dossier.
- [ ] Mature process and file-discovery packages such as Execa, fast-glob, and ignore are used where they satisfy the confinement contract instead of recreating their parsing or lifecycle behavior.
- [ ] Deterministic tests cover an allowed inspection, an allowed test, workspace escape, forbidden command, timeout, cancellation, and cleanup.
