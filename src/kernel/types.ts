/** JSON value as sent to the model provider or persisted in a session log. */
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export const PERMISSION_SCOPES = [
  "read-only",
  "workspace-write",
  "full-access",
] as const;

/** Boundary the kernel may touch: files and actions outside it need approval. */
export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

/** True when `value` is one of the three scope literals (config and requests). */
export function isPermissionScope(value: unknown): value is PermissionScope {
  return (PERMISSION_SCOPES as readonly string[]).includes(value as string);
}

export const EXECUTION_TARGETS = ["wsl", "windows"] as const;

/** Environment a file operation or command runs in. */
export type ExecutionTarget = (typeof EXECUTION_TARGETS)[number];

export const BROWSER_ENGINES = ["chromium", "firefox", "webkit"] as const;

export type BrowserEngine = (typeof BROWSER_ENGINES)[number];

/** True when `value` is one of the three engine literals (config and requests). */
export function isBrowserEngine(value: unknown): value is BrowserEngine {
  return (BROWSER_ENGINES as readonly string[]).includes(value as string);
}
