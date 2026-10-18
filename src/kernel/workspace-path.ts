import { isAbsolute, relative, resolve, sep } from "node:path";

/** A tool-supplied path resolved against the workspace. */
export interface WorkspacePath {
  /** Absolute path the tool will touch. */
  path: string;
  /** True while the resolved path stays inside the workspace. */
  inside: boolean;
}

/**
 * Resolves a requested path and reports whether it stays inside the workspace.
 * The judgment is lexical: symbolic links are followed by the file operation
 * itself, not by this check.
 */
export function resolveWorkspacePath(
  workspace: string,
  requested: string,
): WorkspacePath {
  const root = resolve(workspace);
  const path = resolve(root, requested);
  const rel = relative(root, path);
  const inside =
    rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  return { path, inside };
}
