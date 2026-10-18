/**
 * Adapters between MCP tool descriptions/results and the kernel tool shape.
 *
 * An MCP tool is presented to the model exactly like a built-in tool: a name,
 * a description, a JSON Schema for its arguments, and an executor. Executors
 * never throw: failures come back as an error result so the model can react.
 */
import type { ToolParameters } from "../kernel/tool.ts";

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

/** Kernel parameters for an MCP tool, from the server's JSON Schema. */
export function toolParameters(schema: unknown): ToolParameters {
  const record = asRecord(schema);
  const properties = asRecord(record?.properties) ?? {};
  const parameters: ToolParameters = { type: "object", properties };
  if (
    Array.isArray(record?.required) &&
    record.required.every((name) => typeof name === "string")
  )
    parameters.required = record.required as string[];
  if (typeof record?.additionalProperties === "boolean")
    parameters.additionalProperties = record.additionalProperties;
  return parameters;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
