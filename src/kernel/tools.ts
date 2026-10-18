import type { Tool } from "./tool.ts";
import type { JsonValue } from "./types.ts";
import { loadSkill, scanSkills } from "../skills/loader.ts";

/** Tools the model may call, keyed by name. */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  constructor(tools: Tool[] = []) {
    for (const tool of tools) this.register(tool);
  }

  register(tool: Tool): void {
    if (this.tools.has(tool.name))
      throw new Error(`Tool "${tool.name}" is already registered`);
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }
}

/**
 * Placeholder tool from the loop's first slice; 03 adds the real file and
 * command tools and keeps this one for self-tests.
 */
export const echoTool: Tool = {
  name: "echo",
  description: "Returns the given text unchanged. Placeholder tool for smoke tests.",
  parameters: {
    type: "object",
    properties: { text: { type: "string", description: "Text to return." } },
    required: ["text"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const text = readString(args, "text");
    if (text === undefined)
      return { content: 'The "text" argument must be a string.', isError: true };
    return { content: text };
  },
};

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
      if (name === undefined) {
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

/** Reads an optional string field from tool arguments the model produced. */
function readString(args: JsonValue, key: string): string | undefined {
  if (typeof args !== "object" || args === null || Array.isArray(args))
    return undefined;
  const value = args[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}
