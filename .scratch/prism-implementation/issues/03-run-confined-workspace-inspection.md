# 03 — Run confined Workspace inspection from a dossier

State: closed
Status: ready-for-agent
Assignee: codex
Blocked by: issues/02-create-and-reopen-runs.md

**What to build:** Let a Prism Run request a bounded repository inspection and test command through the WorkspaceExecutor, then show the resulting evidence in the Run dossier. The user should be able to see what was inspected and why unsafe or runaway work was stopped.

- [x] A typed workspace request can read allowlisted files, discover files using repository ignore rules, and run an allowlisted test command inside the selected workspace.
- [x] Path traversal, symlink escape, disallowed command shapes, unexpected working directories, and writes outside the scoped workspace fail closed and emit structured evidence.
- [x] Command timeout or Run cancellation terminates the complete spawned process tree on supported Windows and POSIX development environments without leaving a process behind.
- [x] Command, patch, and test results are bounded, redacted where required, stored as artifacts, and visible from the Run dossier.
- [x] Mature process and file-discovery packages such as Execa, fast-glob, and ignore are used where they satisfy the confinement contract instead of recreating their parsing or lifecycle behavior.
- [x] Deterministic tests cover an allowed inspection, an allowed test, workspace escape, forbidden command, timeout, cancellation, and cleanup.

## Resolution

Implemented a typed `WorkspaceExecutor` for repository inspection, hash-guarded
patches, and exact allowlisted test commands. Every file and working directory is
checked against the selected Run workspace's real path; traversal, symbolic-link
escape, ignored or unregistered paths, stale patch hashes, command-shape drift, and
unexpected working directories fail closed as structured evidence.

Execa owns shell-free process execution and bounded streams, fast-glob owns file
discovery without following symbolic links, and ignore applies root and nested
repository ignore rules. POSIX commands run in a dedicated process group; Windows
uses `taskkill /t /f`. Timeout, cancellation, and output overflow wait for the complete
tree cleanup before returning evidence.

Workspace outcomes are redacted, size-bounded, written as SHA-256 artifacts, appended
as `workspace.evidence` Run events, verified during reopen, and rendered in the dossier.
The Field Desk exposes registered inspection and test actions without exposing a generic
shell or path surface.
