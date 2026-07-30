import path from "node:path";

import type { LocalWorkspace } from "@prism/contracts";

const windowsAbsolutePathPattern = /^[A-Za-z]:[\\/]/;

function displayNameFor(workspacePath: string) {
  return windowsAbsolutePathPattern.test(workspacePath)
    ? path.win32.basename(workspacePath)
    : path.posix.basename(workspacePath);
}

function normalizeForComparison(workspacePath: string) {
  const normalized = workspacePath.replaceAll("\\", "/").replace(/\/+$/, "");

  return windowsAbsolutePathPattern.test(workspacePath)
    ? normalized.toLocaleLowerCase("en-US")
    : normalized;
}

export function getConfiguredWorkspace(): LocalWorkspace {
  const configuredPath = process.env.PRISM_WORKSPACE_PATH?.trim();
  const workspacePath =
    configuredPath && configuredPath.length > 0
      ? configuredPath
      : path.resolve(process.cwd(), "../..");

  return {
    kind: "local",
    path: workspacePath,
    displayName: displayNameFor(workspacePath) || "workspace",
  };
}

export function isConfiguredWorkspace(workspace: LocalWorkspace) {
  const configuredWorkspace = getConfiguredWorkspace();

  return (
    workspace.kind === configuredWorkspace.kind &&
    normalizeForComparison(workspace.path) ===
      normalizeForComparison(configuredWorkspace.path)
  );
}
