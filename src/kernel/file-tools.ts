import type { Tool, ToolResult } from "./tool.ts";
import { open } from "node:fs/promises";
import { TOOL_RESULT_LIMIT } from "./loop.ts";
import {
  capText,
  fileError,
  gatePath,
  isRefusal,
  missingArgument,
  readString,
} from "./tool-support.ts";

/** Bytes read at most per file; UTF-8 uses at most four bytes per character. */
const READ_BYTES = TOOL_RESULT_LIMIT * 4;

/**
 * The file tools: read, write, list and find inside the workspace. Paths that
 * leave the workspace trigger a one-time approval (04 turns the answer into
 * the scope policy).
 */
export function createFileTools(): Tool[] {
  return [readFileTool];
}

const readFileTool: Tool = {
  name: "read_file",
  description:
    "Reads a file. Paths are absolute or relative to the workspace. The result is cut after 8000 characters.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File to read." },
    },
    required: ["path"],
    additionalProperties: false,
  },
  execute: async (args, context) => {
    const requested = readString(args, "path");
    if (requested === undefined || requested === "")
      return missingArgument("path");
    const gate = await gatePath(context, requested, {
      reason: "Reads a file outside the workspace",
      impact: "The file is outside the session workspace.",
    });
    if (isRefusal(gate)) return gate;
    try {
      const handle = await open(gate.path, "r");
      try {
        const { size } = await handle.stat();
        const buffer = Buffer.alloc(Math.min(READ_BYTES, size));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        const text = buffer.subarray(0, bytesRead).toString("utf8");
        return {
          content: capText(text, size > bytesRead || text.length > TOOL_RESULT_LIMIT),
        };
      } finally {
        await handle.close();
      }
    } catch (error) {
      return fileError(gate.display, error) satisfies ToolResult;
    }
  },
};
