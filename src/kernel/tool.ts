import type {
  ApprovalRequest,
  PermissionAction,
  PermissionPolicy,
} from "./permissions.ts";
import type { ExecutionTarget, JsonValue, PermissionScope } from "./types.ts";

/** JSON Schema for the arguments a tool accepts. */
export interface ToolParameters {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolContext {
  sessionId: string;
  /** Workspace the session belongs to. */
  workspace: string;
  /** Boundary in effect for this call; actions outside it need approval. */
  scope: PermissionScope;
  /** Live permission settings; `decide` answers what an action would need. */
  permissions: PermissionPolicy;
  /** Environment file operations and commands run in. */
  target: ExecutionTarget;
  /** Aborts when the user cancels the running task. */
  signal: AbortSignal;
  /**
   * Asks the user to approve one action that leaves the permission scope. The
   * answer holds for this call only (ADR-0005); the kernel never caches it.
   */
  requestApproval: (request: ApprovalRequest) => Promise<boolean>;
  /**
   * Reports a path the tool read, wrote or listed, so the `AGENTS.md` files of
   * the directories on the way to it join the context from the next model
   * round on. Paths outside the workspace are ignored. File tools call this
   * for every path they touch; the kernel provides it.
   */
  noteExplored?: (path: string) => void;
}

export interface ToolResult {
  /** Text the model reads as the tool output. */
  content: string;
  /** Set when the call failed, so the loop reports the failure instead of a result. */
  isError?: boolean;
}

export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameters;
  /**
   * What every call touches, checked before `execute` runs: a call whose action
   * is refused never happens. Declare each file write, command and browser
   * action; tools that declare nothing (the MCP tools of 09) stay outside the
   * three permission scopes by design.
   */
  effects?: (args: JsonValue, context: ToolContext) => PermissionAction[];
  execute: (args: JsonValue, context: ToolContext) => Promise<ToolResult>;
}
