import type { Tool, ToolResult } from "./tool.ts";
import { Buffer } from "node:buffer";
import {
  glob,
  mkdir,
  open,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { unifiedDiff } from "../shared/diff.ts";
import { TOOL_RESULT_LIMIT } from "./loop.ts";
import {
  capText,
  fileError,
  missingArgument,
  OutputBuffer,
  readString,
  resolveToolPath,
} from "./tool-support.ts";

/** Bytes read at most per file; UTF-8 uses at most four bytes per character. */
const READ_BYTES = TOOL_RESULT_LIMIT * 4;
/** Glob matches collected per call; more than this is reported as truncated. */
const MAX_GLOB_MATCHES = 1_000;
/** Files at most this size are read back for a write diff; longer ones are not. */
const MAX_DIFF_BYTES = 128 * 1024;
/** Lines at most on either side of a write diff; `util.diff` is O(N*D). */
const MAX_DIFF_LINES = 3_000;

/**
 * The content a write replaces, for the diff in its result. `undefined` when the
 * file cannot be diffed (too large, too long or binary): reading it back is then
 * not worth it, and the workbench falls back to the written content.
 */
async function readBeforeWrite(
  path: string,
  content: string,
): Promise<{ text: string; created: boolean } | undefined> {
  let buffer: Buffer;
  try {
    buffer = await readFile(path);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { text: "", created: true }
      : undefined;
  }
  if (
    buffer.byteLength > MAX_DIFF_BYTES ||
    buffer.includes(0) ||
    content.length > MAX_DIFF_BYTES ||
    countLines(buffer.toString("utf8")) > MAX_DIFF_LINES ||
    countLines(content) > MAX_DIFF_LINES
  )
    return undefined;
  return { text: buffer.toString("utf8"), created: false };
}

function countLines(text: string): number {
  let lines = 1;
  for (const character of text) if (character === "\n") lines += 1;
  return lines;
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
    if (requested === undefined || requested === "") return missingArgument("path");
    const target = resolveToolPath(context, requested);
    try {
      const handle = await open(target.path, "r");
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
      return fileError(target.display, error) satisfies ToolResult;
    }
  },
};

const writeFileTool: Tool = {
  name: "write_file",
  description:
    "Writes a file, creating missing parent directories and replacing any existing content. Paths are absolute or relative to the workspace. The result carries a unified diff of the change.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File to write." },
      content: { type: "string", description: "Full content of the file." },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  effects: (args, context) => {
    const requested = readString(args, "path");
    if (requested === undefined || requested === "") return [];
    return [{ kind: "file-write", path: resolveToolPath(context, requested).path }];
  },
  execute: async (args, context) => {
    const requested = readString(args, "path");
    if (requested === undefined || requested === "") return missingArgument("path");
    const content = readString(args, "content");
    if (content === undefined) return missingArgument("content");
    const target = resolveToolPath(context, requested);
    try {
      await mkdir(dirname(target.path), { recursive: true });
      const before = await readBeforeWrite(target.path, content);
      await writeFile(target.path, content);
      const diff =
        before === undefined
          ? "" // Too large or binary to diff; the workbench shows the written content.
          : unifiedDiff(before.text, content, {
              path: target.display,
              created: before.created,
            });
      return {
        content: [`Wrote ${content.length} characters to ${target.display}.`, diff]
          .filter((part) => part !== "")
          .join("\n\n"),
      };
    } catch (error) {
      return fileError(target.display, error) satisfies ToolResult;
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
    const target = resolveToolPath(context, requested);
    try {
      const entries = await readdir(target.path, { withFileTypes: true });
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
      return fileError(target.display, error) satisfies ToolResult;
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
    if (pattern === undefined || pattern === "") return missingArgument("pattern");
    const requested = readString(args, "path") ?? ".";
    const target = resolveToolPath(context, requested);
    try {
      const root = resolve(context.workspace);
      const matches: string[] = [];
      let more = false;
      for await (const entry of glob(pattern, {
        cwd: target.path,
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
      return fileError(target.display, error) satisfies ToolResult;
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
    if (pattern === undefined || pattern === "") return missingArgument("pattern");
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
    const target = resolveToolPath(context, requested);
    try {
      const root = resolve(context.workspace);
      const buffer = new OutputBuffer();
      let matches = 0;
      for await (const file of walkFiles(target.path)) {
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
      return fileError(target.display, error) satisfies ToolResult;
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

/**
 * The file tools: read, write, list and find inside the workspace. Reads run in
 * every permission scope; `write_file` declares its write, and the kernel turns
 * a write outside the workspace into a one-time approval (04).
 */
export function createFileTools(): Tool[] {
  return [readFileTool, writeFileTool, listDirectoryTool, globTool, grepTool];
}
