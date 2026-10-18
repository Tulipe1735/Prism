import type { ToolContext, ToolResult } from "./tool.ts";
import type { JsonValue } from "./types.ts";
import { relative, resolve } from "node:path";
import { TOOL_RESULT_LIMIT, TRUNCATION_NOTICE } from "./loop.ts";
import { resolveWorkspacePath } from "./workspace-path.ts";

/** Reads a string field from the arguments the model produced. */
export function readString(args: JsonValue, key: string): string | undefined {
  if (typeof args !== "object" || args === null || Array.isArray(args))
    return undefined;
  const value = (args as Record<string, JsonValue>)[key];
  return typeof value === "string" ? value : undefined;
}

/** Reads a number field from the arguments the model produced. */
export function readNumber(args: JsonValue, key: string): number | undefined {
  if (typeof args !== "object" || args === null || Array.isArray(args))
    return undefined;
  const value = (args as Record<string, JsonValue>)[key];
  return typeof value === "number" ? value : undefined;
}

/** Error result for a missing or mistyped argument the tool requires. */
export function missingArgument(key: string): ToolResult {
  return {
    content: `The "${key}" argument is required and must be a string.`,
    isError: true,
  };
}

/** Cuts text at the tool result limit and appends the visible notice. */
export function capText(text: string, truncated: boolean): string {
  return truncated ? text.slice(0, TOOL_RESULT_LIMIT) + TRUNCATION_NOTICE : text;
}

/** Collects tool output up to the result limit and marks it when more arrived. */
export class OutputBuffer {
  private text = "";
  private cut = false;

  append(chunk: string): void {
    if (this.cut) return;
    this.text += chunk;
    if (this.text.length > TOOL_RESULT_LIMIT) {
      this.text = this.text.slice(0, TOOL_RESULT_LIMIT);
      this.cut = true;
    }
  }

  get truncated(): boolean {
    return this.cut;
  }

  /** The collected text, cut and marked when the output did not fit. */
  render(): string {
    return capText(this.text, this.cut);
  }
}

/** A resolved tool path: what to touch, and how to name it to the model. */
export interface ToolPath {
  /** Absolute path the tool touches. */
  path: string;
  /** Workspace-relative name inside the workspace, absolute outside it. */
  display: string;
}

/**
 * Resolves a path a tool was asked for. The kernel decides whether touching it
 * is allowed (04, `Tool.effects`) before the tool runs, so this only resolves
 * the path and picks the name to report.
 */
export function resolveToolPath(context: ToolContext, requested: string): ToolPath {
  const { path, inside } = resolveWorkspacePath(context.workspace, requested);
  const rel = relative(resolve(context.workspace), path);
  return { path, display: inside ? (rel === "" ? "." : rel) : path };
}

/** Wraps a filesystem failure in a tool result the model can act on. */
export function fileError(display: string, error: unknown): ToolResult {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOENT")
    return { content: `File not found: ${display}.`, isError: true };
  if (code === "EISDIR")
    return { content: `${display} is a directory; use list_directory.`, isError: true };
  return {
    content: `Could not access ${display}: ${error instanceof Error ? error.message : String(error)}`,
    isError: true,
  };
}
