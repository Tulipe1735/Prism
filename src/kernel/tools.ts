import type { Tool, ToolContext, ToolResult } from "./tool.ts";
import type { JsonValue } from "./types.ts";
import { loadSkill, scanSkills } from "../skills/loader.ts";
import { readString } from "./tool-support.ts";

/** Tools the model may call, keyed by name. */
export class ToolRegistry {
  private readonly tools = new Map<
    string,
    {
      tool: Tool;
      calls: Set<{ controller: AbortController; settled: Promise<void> }>;
      dispose: () => Promise<void>;
    }
  >();

  register(tool: Tool): () => Promise<void> {
    if (this.tools.has(tool.name))
      throw new Error(`Tool "${tool.name}" is already registered`);
    let disposing: Promise<void> | undefined;
    const entry = {
      tool,
      calls: new Set<{ controller: AbortController; settled: Promise<void> }>(),
      dispose: (): Promise<void> => {
        if (disposing !== undefined) return disposing;
        if (this.tools.get(tool.name) === entry) this.tools.delete(tool.name);
        for (const call of entry.calls) call.controller.abort();
        disposing = Promise.all([...entry.calls].map((call) => call.settled)).then(
          () => {},
        );
        return disposing;
      },
    };
    this.tools.set(tool.name, entry);
    return entry.dispose;
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name)?.tool;
  }

  list(): Tool[] {
    return [...this.tools.values()].map((entry) => entry.tool);
  }

  /** An unloading plugin withdraws its tools, cancels calls and awaits their cleanup. */
  async execute(
    tool: Tool,
    args: JsonValue,
    context: ToolContext,
  ): Promise<ToolResult> {
    const entry = this.tools.get(tool.name);
    if (entry?.tool !== tool)
      return { content: `Tool "${tool.name}" is no longer available.`, isError: true };
    const controller = new AbortController();
    const signal = AbortSignal.any([context.signal, controller.signal]);
    const execution = Promise.resolve().then(() =>
      signal.aborted
        ? {
            content: `Tool "${tool.name}" was cancelled before execution.`,
            isError: true,
          }
        : tool.execute(args, { ...context, signal }),
    );
    const call = {
      controller,
      settled: execution.then(
        () => {},
        () => {},
      ),
    };
    entry.calls.add(call);
    try {
      return await execution;
    } finally {
      entry.calls.delete(call);
    }
  }

  async close(): Promise<void> {
    await Promise.all([...this.tools.values()].map((entry) => entry.dispose()));
  }
}

export interface SkillToolRoots {
  /** User home directory holding global skills; defaults to the real home. */
  home?: string;
  /** Directory of the skills shipped with Prism. */
  bundled?: string;
}

/** Lists available skills, or reads one skill's instructions by name. */
export function createSkillTool(roots: SkillToolRoots): Tool {
  return {
    name: "skill",
    description:
      "List the available skills, or read one skill's instructions by name before following them.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Skill to read. Omit to list the available skills.",
        },
      },
      additionalProperties: false,
    },
    execute: async (args, context) => {
      const scan = await scanSkills({ workspace: context.workspace, ...roots });
      const name = readString(args, "name");
      if (name === undefined || name === "") {
        const lines = scan.skills.map(
          (skill) => `- ${skill.name} (${skill.origin}): ${skill.description}`,
        );
        const problems = scan.problems.map(
          (problem) => `- unreadable: ${problem.path}: ${problem.reason}`,
        );
        const listed = [...lines, ...problems];
        return {
          content:
            listed.length === 0
              ? "No skills are available in this workspace."
              : listed.join("\n"),
        };
      }
      const skill = scan.skills.find((candidate) => candidate.name === name);
      if (skill === undefined) {
        const available = scan.skills.map((candidate) => candidate.name).join(", ");
        return {
          content: `Unknown skill "${name}". Available skills: ${available || "none"}.`,
          isError: true,
        };
      }
      return { content: await loadSkill(skill) };
    },
  };
}
