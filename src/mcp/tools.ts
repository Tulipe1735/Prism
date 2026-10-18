/**
 * Kernel-facing shape of MCP tools.
 *
 * An MCP tool is presented to the model exactly like a built-in tool: a name, a
 * description, a JSON Schema for its arguments, and an executor. Executors never
 * throw: failures come back as an error result so the model can react to them.
 */

export interface McpToolResult {
  /** Model-visible text. */
  text: string;
  /** True when the call failed; `text` explains the failure. */
  isError: boolean;
}

export interface McpTool {
  /** Namespaced as `mcp__<server>__<tool>` so external tools never collide with built-ins. */
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<McpToolResult>;
}

/** Renders MCP `callTool` content as model-visible text. */
export function toolResultText(result: unknown): string {
  const record = asRecord(result);
  const content = Array.isArray(record?.content) ? record.content : [];
  const parts = content.map((block) => {
    const entry = asRecord(block);
    if (entry?.type === "text" && typeof entry.text === "string") return entry.text;
    return JSON.stringify(block);
  });
  if (parts.length === 0 && record?.structuredContent !== undefined)
    return JSON.stringify(record.structuredContent);
  return parts.join("\n");
}

/** True when an MCP `callTool` result marks the call as failed. */
export function toolResultIsError(result: unknown): boolean {
  return asRecord(result)?.isError === true;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}
