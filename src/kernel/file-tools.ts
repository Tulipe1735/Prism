import type { Tool, ToolResult } from "./tool.ts";
import { mkdir, open, readdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { TOOL_RESULT_LIMIT } from "./loop.ts";
import {
  capText,
  fileError,
  gatePath,
  isRefusal,
  missingArgument,
  OutputBuffer,
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
  return [readFileTool, writeFileTool, listDirectoryTool];
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

const writeFileTool: Tool = {
  name: "write_file",
  description:
    "Writes a file, creating missing parent directories and replacing any existing content. Paths are absolute or relative to the workspace.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File to write." },
      content: { type: "string", description: "Full content of the file." },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  execute: async (args, context) => {
    const requested = readString(args, "path");
    if (requested === undefined || requested === "")
      return missingArgument("path");
    const content = readString(args, "content");
    if (content === undefined) return missingArgument("content");
    const gate = await gatePath(context, requested, {
      reason: "Writes a file outside the workspace",
      impact: "The change is not contained by the workspace.",
    });
    if (isRefusal(gate)) return gate;
    try {
      await mkdir(dirname(gate.path), { recursive: true });
      await writeFile(gate.path, content);
      return { content: `Wrote ${content.length} characters to ${gate.display}.` };
    } catch (error) {
      return fileError(gate.display, error) satisfies ToolResult;
    }
  },
};

const listDirectoryTool: Tool = {
  name: "list_directory",
  description:
    "Lists the entries of a directory; directory names end with a slash. Defaults to the workspace root.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory to list." },
    },
    additionalProperties: false,
  },
  execute: async (args, context) => {
    const requested = readString(args, "path") ?? ".";
    const gate = await gatePath(context, requested, {
      reason: "Lists a directory outside the workspace",
      impact: "The listing shows paths outside the session workspace.",
    });
    if (isRefusal(gate)) return gate;
    try {
      const entries = await readdir(gate.path, { withFileTypes: true });
      if (entries.length === 0) return { content: "(empty directory)" };
      const buffer = new OutputBuffer();
      const lines = entries
        .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
        .sort();
      for (const line of lines) {
        buffer.append(`${line}\n`);
        if (buffer.truncated) break;
      }
      return { content: buffer.render().replace(/\n$/, "") };
    } catch (error) {
      return fileError(gate.display, error) satisfies ToolResult;
    }
  },
};
