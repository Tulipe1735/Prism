import type { Tool, ToolResult } from "./tool.ts";
import { glob, mkdir, open, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
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
/** Glob matches collected per call; more than this is reported as truncated. */
const MAX_GLOB_MATCHES = 1_000;

/**
 * The file tools: read, write, list and find inside the workspace. Paths that
 * leave the workspace trigger a one-time approval (04 turns the answer into
 * the scope policy).
 */
export function createFileTools(): Tool[] {
  return [readFileTool, writeFileTool, listDirectoryTool, globTool, grepTool];
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

const globTool: Tool = {
  name: "glob",
  description:
    "Finds files whose path matches a glob pattern such as `src/**/*.ts`. Dot files need an explicit leading dot; directories are not reported.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob pattern to match file paths." },
      path: {
        type: "string",
        description: "Directory to search from; defaults to the workspace root.",
      },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  execute: async (args, context) => {
    const pattern = readString(args, "pattern");
    if (pattern === undefined || pattern === "")
      return missingArgument("pattern");
    const requested = readString(args, "path") ?? ".";
    const gate = await gatePath(context, requested, {
      reason: "Finds files outside the workspace",
      impact: "The matches can name paths outside the session workspace.",
    });
    if (isRefusal(gate)) return gate;
    try {
      const root = resolve(context.workspace);
      const matches: string[] = [];
      let more = false;
      for await (const entry of glob(pattern, {
        cwd: gate.path,
        withFileTypes: true,
      })) {
        if (entry.isDirectory()) continue;
        if (matches.length >= MAX_GLOB_MATCHES) {
          more = true;
          break;
        }
        matches.push(relative(root, join(entry.parentPath, entry.name)));
      }
      if (matches.length === 0 && !more)
        return { content: `No files matched "${pattern}".` };
      matches.sort();
      const text = matches.join("\n");
      return { content: capText(text, more || text.length > TOOL_RESULT_LIMIT) };
    } catch (error) {
      return fileError(gate.display, error) satisfies ToolResult;
    }
  },
};

const grepTool: Tool = {
  name: "grep",
  description:
    "Searches file contents with a JavaScript regular expression and reports matches as `path:line: text`, with line numbers starting at 1.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regular expression to search for." },
      path: {
        type: "string",
        description: "File or directory to search; defaults to the workspace root.",
      },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  execute: async (args, context) => {
    const pattern = readString(args, "pattern");
    if (pattern === undefined || pattern === "")
      return missingArgument("pattern");
    let regex: RegExp;
    try {
      regex = new RegExp(pattern);
    } catch (error) {
      return {
        content: `Invalid regular expression "${pattern}": ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
    const requested = readString(args, "path") ?? ".";
    const gate = await gatePath(context, requested, {
      reason: "Searches files outside the workspace",
      impact: "The matches can quote content from outside the session workspace.",
    });
    if (isRefusal(gate)) return gate;
    try {
      const root = resolve(context.workspace);
      const buffer = new OutputBuffer();
      let matches = 0;
      for await (const file of walkFiles(gate.path)) {
        if (buffer.truncated) break;
        const text = await readFile(file, "utf8").catch(() => null);
        if (text === null) continue;
        const lines = text.split("\n");
        for (const [index, line] of lines.entries()) {
          if (!regex.test(line)) continue;
          matches += 1;
          buffer.append(`${relative(root, file)}:${index + 1}: ${line}\n`);
          if (buffer.truncated) break;
        }
      }
      if (matches === 0) return { content: `No matches for "${pattern}".` };
      return { content: buffer.render().replace(/\n$/, "") };
    } catch (error) {
      return fileError(gate.display, error) satisfies ToolResult;
    }
  },
};

/** Yields the files under a path, in directory order; `.git` is skipped. */
async function* walkFiles(target: string): AsyncGenerator<string> {
  const info = await stat(target);
  if (info.isFile()) {
    yield target;
    return;
  }
  for (const entry of await readdir(target, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const child = join(target, entry.name);
    if (entry.isDirectory()) yield* walkFiles(child);
    else if (entry.isFile()) yield child;
  }
}
