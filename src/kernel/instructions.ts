import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

/** Name of the instruction files the kernel loads. */
export const INSTRUCTION_FILE = "AGENTS.md";

/** Where an instruction file sits: outside the workspace, at its root, or nested in it. */
export type InstructionScope = "global" | "ancestor" | "workspace" | "nested";

export interface InstructionFile {
  /** Absolute path of the file, named in the prompt so the model can edit it. */
  path: string;
  scope: InstructionScope;
  content: string;
}

export interface InstructionRoots {
  /** User home directory; the global instructions live under `<home>/.agents`. */
  home?: string;
}

/**
 * Instruction files in effect for a workspace: the global file first, then the
 * ancestor chain down to the workspace root, then the nested files that tools
 * discovered inside the workspace. Files are read on every use, so edits take
 * effect in the next request.
 */
export class InstructionFiles {
  private readonly home: string;
  /** Nested file paths per workspace, in discovery order. */
  private readonly discovered = new Map<string, Set<string>>();

  constructor(options: InstructionRoots = {}) {
    this.home = options.home ?? homedir();
  }

  async activeFor(workspace: string): Promise<InstructionFile[]> {
    const root = resolve(workspace);
    const files: InstructionFile[] = [];
    const global = await readInstructionFile(
      join(this.home, ".agents", INSTRUCTION_FILE),
      "global",
    );
    if (global !== null) files.push(global);
    for (const directory of chainDirectories(root)) {
      const file = await readInstructionFile(
        join(directory, INSTRUCTION_FILE),
        directory === root ? "workspace" : "ancestor",
      );
      if (file !== null) files.push(file);
    }
    for (const path of [...(this.discovered.get(root) ?? [])].sort()) {
      const file = await readInstructionFile(path, "nested");
      if (file !== null) files.push(file);
    }
    return files;
  }

  /**
   * Records that a tool explored a file or directory. The nested instruction
   * files between the workspace root and that path join the context from the
   * next model round on; paths outside the workspace are ignored.
   */
  noteExplored(workspace: string, path: string): void {
    const root = resolve(workspace);
    const target = resolve(root, path);
    const discovered = this.discovered.get(root) ?? new Set<string>();
    for (const candidate of [dirname(target), target]) {
      for (const directory of chainDirectories(candidate)) {
        if (directory === root || !directory.startsWith(root + sep)) continue;
        discovered.add(join(directory, INSTRUCTION_FILE));
      }
    }
    this.discovered.set(root, discovered);
  }
}

/** The instruction files that apply from the start, rendered for the system prompt. */
export function instructionPrompt(files: InstructionFile[]): string | undefined {
  const always = files.filter((file) => file.scope !== "nested");
  if (always.length === 0) return undefined;
  return [
    "Project instructions that apply here, outermost first; the closest file wins:",
    ...always.map((file) => `Instructions from ${file.path}:\n${file.content}`),
  ].join("\n");
}

/** One lazily loaded nested instruction file, announced where it was found. */
export function instructionNote(file: InstructionFile): string {
  return `Instructions discovered at ${file.path}:\n${file.content}`;
}

/** `/a`, `/a/b`, `/a/b/c` for `/a/b/c`: outermost first. */
function chainDirectories(path: string): string[] {
  const directories: string[] = [];
  let current = resolve(path);
  for (;;) {
    directories.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return directories.reverse();
}

/** An instruction file, or null when it is missing, unreadable or empty. */
async function readInstructionFile(
  path: string,
  scope: InstructionScope,
): Promise<InstructionFile | null> {
  const content = await readFile(path, "utf8").catch(() => null);
  if (content === null || content.trim() === "") return null;
  return { path, scope, content: content.trim() };
}
