import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

export const SKILL_FILE = "SKILL.md";

export type SkillOrigin = "bundled" | "global" | "project";

export interface SkillSummary {
  name: string;
  description: string;
  origin: SkillOrigin;
  /** Absolute path of the skill's `SKILL.md`. */
  path: string;
}

export interface SkillProblem {
  path: string;
  reason: string;
}

export interface SkillScan {
  skills: SkillSummary[];
  problems: SkillProblem[];
}

export interface SkillScanOptions {
  /** Workspace directory; project skills live under `<workspace>/.agents/skills`. */
  workspace: string;
  /** User home directory; global skills live under `<home>/.agents/skills`. */
  home?: string;
  /** Directory of the skills shipped with Prism. */
  bundled?: string;
}

interface SkillRoot {
  origin: SkillOrigin;
  directory: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

async function skillRoots(options: SkillScanOptions): Promise<SkillRoot[]> {
  const home = options.home ?? homedir();
  const bundled = options.bundled ?? (await bundledSkillsDirectory());
  return [
    { origin: "project", directory: join(options.workspace, ".agents", "skills") },
    { origin: "global", directory: join(home, ".agents", "skills") },
    ...(bundled ? [{ origin: "bundled" as const, directory: bundled }] : []),
  ];
}

/** The `skills` directory next to this module's own package, when it ships one. */
async function bundledSkillsDirectory(): Promise<string | undefined> {
  let directory = fileURLToPath(new URL(".", import.meta.url));
  for (;;) {
    if (await exists(join(directory, "package.json"))) {
      const skills = join(directory, "skills");
      return (await exists(skills)) ? skills : undefined;
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

interface ParsedSkill {
  name: string;
  description: string;
  body: string;
}

/** Parse one `SKILL.md`; throws with a caller-fixable reason when it is unusable. */
function parseSkill(content: string): ParsedSkill {
  const frontmatter = FRONTMATTER.exec(content);
  if (!frontmatter) throw new Error("missing YAML frontmatter");
  let data: unknown;
  try {
    data = parseYaml(frontmatter[1] ?? "");
  } catch (error) {
    const detail = (error as Error).message.split("\n")[0];
    throw new Error(`invalid YAML frontmatter: ${detail}`);
  }
  if (typeof data !== "object" || data === null)
    throw new Error("frontmatter must be a YAML mapping");
  const record = data as Record<string, unknown>;
  const name = record.name;
  if (typeof name !== "string" || name.trim() === "")
    throw new Error('frontmatter field "name" must be a non-empty string');
  const description = record.description;
  if (typeof description !== "string" || description.trim() === "")
    throw new Error('frontmatter field "description" must be a non-empty string');
  return {
    name,
    description,
    body: content.slice(frontmatter[0].length).trim(),
  };
}

async function readSkillFile(path: string): Promise<ParsedSkill | SkillProblem> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      path,
      reason:
        code === "ENOENT"
          ? "missing SKILL.md"
          : `cannot read file: ${code ?? String(error)}`,
    };
  }
  try {
    return parseSkill(content);
  } catch (error) {
    return { path, reason: (error as Error).message };
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Discover skills from the project, global and bundled roots, in that priority. */
export async function scanSkills(options: SkillScanOptions): Promise<SkillScan> {
  const skills = new Map<string, SkillSummary>();
  const problems: SkillProblem[] = [];
  for (const root of await skillRoots(options)) {
    let entries: string[];
    try {
      entries = (await readdir(root.directory)).sort();
    } catch {
      continue;
    }
    for (const entry of entries) {
      const directory = join(root.directory, entry);
      if (!(await isDirectory(directory))) continue;
      const path = join(directory, SKILL_FILE);
      const parsed = await readSkillFile(path);
      if ("reason" in parsed) {
        problems.push(parsed);
        continue;
      }
      if (skills.has(parsed.name)) continue;
      skills.set(parsed.name, {
        name: parsed.name,
        description: parsed.description,
        origin: root.origin,
        path,
      });
    }
  }
  return { skills: [...skills.values()], problems };
}

/** Read one skill's body on demand. */
export async function loadSkill(skill: SkillSummary): Promise<string> {
  const parsed = await readSkillFile(skill.path);
  if ("reason" in parsed)
    throw new Error(`Skill "${skill.name}" is unreadable: ${parsed.reason}`);
  return parsed.body;
}
