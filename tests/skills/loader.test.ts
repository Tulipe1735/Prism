import type { SkillProblem, SkillScan } from "../../src/skills/loader.ts";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadSkill, scanSkills } from "../../src/skills/loader.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "prism-skills-"));
  directories.push(directory);
  return directory;
}

/** Write `<root>/<entry>/SKILL.md` with the exact file content given. */
async function writeSkillFile(
  root: string,
  entry: string,
  content: string,
): Promise<string> {
  const file = join(root, entry, "SKILL.md");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
  return file;
}

function skillFile(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`;
}

function problemAt(scan: SkillScan, path: string): SkillProblem | undefined {
  return scan.problems.find((problem) => problem.path === path);
}

interface Roots {
  workspace: string;
  home: string;
  bundled: string;
}

/** Three roots, so a test only states the files it actually needs. */
async function makeRoots(): Promise<Roots> {
  const base = await tempDir();
  const roots = {
    workspace: join(base, "workspace"),
    home: join(base, "home"),
    bundled: join(base, "bundled"),
  };
  await Promise.all(
    Object.values(roots).map((path) => mkdir(path, { recursive: true })),
  );
  return roots;
}

describe("scanSkills", () => {
  it("discovers a project skill with its frontmatter name and description", async () => {
    const { workspace, home, bundled } = await makeRoots();
    const path = await writeSkillFile(
      join(workspace, ".agents", "skills"),
      "release",
      skillFile("release", "Cut a release.", "Tag, then publish."),
    );

    const scan = await scanSkills({ workspace, home, bundled });

    expect(scan.problems).toEqual([]);
    expect(scan.skills).toEqual([
      { name: "release", description: "Cut a release.", origin: "project", path },
    ]);
  });

  it("discovers global and bundled skills, listing project first", async () => {
    const { workspace, home, bundled } = await makeRoots();
    const project = await writeSkillFile(
      join(workspace, ".agents", "skills"),
      "release",
      skillFile("release", "Cut a release.", "Tag, then publish."),
    );
    const global = await writeSkillFile(
      join(home, ".agents", "skills"),
      "commit",
      skillFile("commit", "Write a commit.", "Follow the house style."),
    );
    const packaged = await writeSkillFile(
      bundled,
      "prism",
      skillFile("prism", "Drive the browser.", "Observe, then act."),
    );

    const scan = await scanSkills({ workspace, home, bundled });

    expect(scan.problems).toEqual([]);
    expect(scan.skills).toEqual([
      {
        name: "release",
        description: "Cut a release.",
        origin: "project",
        path: project,
      },
      {
        name: "commit",
        description: "Write a commit.",
        origin: "global",
        path: global,
      },
      {
        name: "prism",
        description: "Drive the browser.",
        origin: "bundled",
        path: packaged,
      },
    ]);
  });

  it("resolves one name shared by several roots to the project skill", async () => {
    const { workspace, home, bundled } = await makeRoots();
    await writeSkillFile(
      join(home, ".agents", "skills"),
      "review",
      skillFile("review", "Global review.", "Global body."),
    );
    await writeSkillFile(
      bundled,
      "review",
      skillFile("review", "Bundled review.", "Bundled body."),
    );
    const project = await writeSkillFile(
      join(workspace, ".agents", "skills"),
      "review",
      skillFile("review", "Project review.", "Project body."),
    );

    const scan = await scanSkills({ workspace, home, bundled });

    expect(scan.skills).toEqual([
      {
        name: "review",
        description: "Project review.",
        origin: "project",
        path: project,
      },
    ]);
  });
});

describe("broken input", () => {
  it("skips unusable skills, reports why, and keeps the usable ones", async () => {
    const { workspace, home, bundled } = await makeRoots();
    const root = join(workspace, ".agents", "skills");
    const badYaml = await writeSkillFile(
      root,
      "bad-yaml",
      "---\nname: broken\ndescription: [unclosed\n---\nbody\n",
    );
    const noName = await writeSkillFile(
      root,
      "no-name",
      "---\ndescription: An anonymous skill.\n---\nbody\n",
    );
    const bare = await writeSkillFile(root, "bare", "Just prose.\n");
    const noDescription = await writeSkillFile(
      root,
      "no-description",
      "---\nname: unexplained\n---\nbody\n",
    );
    await mkdir(join(root, "empty-directory"), { recursive: true });
    await writeFile(join(root, "NOTES.md"), "not a skill\n", "utf8");
    await writeSkillFile(root, "usable", skillFile("usable", "Still works.", "body"));

    const scan = await scanSkills({ workspace, home, bundled });

    expect(scan.skills.map((skill) => skill.name)).toEqual(["usable"]);
    expect(scan.problems.map((problem) => problem.path).sort()).toEqual(
      [
        badYaml,
        noName,
        bare,
        noDescription,
        join(root, "empty-directory", "SKILL.md"),
      ].sort(),
    );
    expect(problemAt(scan, badYaml)?.reason).toMatch(/^invalid YAML frontmatter:/);
    expect(problemAt(scan, bare)?.reason).toBe("missing YAML frontmatter");
    expect(problemAt(scan, noDescription)?.reason).toBe(
      'frontmatter field "description" must be a non-empty string',
    );
    expect(problemAt(scan, noName)?.reason).toBe(
      'frontmatter field "name" must be a non-empty string',
    );
    expect(problemAt(scan, join(root, "empty-directory", "SKILL.md"))?.reason).toBe(
      "missing SKILL.md",
    );
  });

  it("keeps the first of two skills that claim the same name in one root", async () => {
    const { workspace, home, bundled } = await makeRoots();
    const root = join(workspace, ".agents", "skills");
    const first = await writeSkillFile(
      root,
      "a-first",
      skillFile("dup", "First.", "body"),
    );
    await writeSkillFile(root, "b-second", skillFile("dup", "Second.", "body"));

    const scan = await scanSkills({ workspace, home, bundled });

    expect(scan.skills).toEqual([
      { name: "dup", description: "First.", origin: "project", path: first },
    ]);
  });

  it("treats an absent root as absent, not broken", async () => {
    const { workspace, home, bundled } = await makeRoots();

    const scan = await scanSkills({
      workspace: join(workspace, "never-created"),
      home,
      bundled,
    });

    expect(scan).toEqual({ skills: [], problems: [] });
  });
});

describe("default roots", () => {
  it("finds the prism skill shipped with Prism, with its folded description", async () => {
    const { workspace, home } = await makeRoots();
    const path = fileURLToPath(new URL("../../skills/prism/SKILL.md", import.meta.url));

    const scan = await scanSkills({ workspace, home });

    expect(scan.skills).toEqual([
      {
        name: "prism",
        description:
          "Use Prism to inspect and interact with a browser through its agent-facing CLI when the user requests browser work and a Chrome debugging endpoint is available.",
        origin: "bundled",
        path,
      },
    ]);
    expect(await loadSkill(scan.skills[0]!)).toContain("# Prism browser CLI");
  });

  it("reads global skills from the user home directory", async () => {
    const { workspace, home, bundled } = await makeRoots();
    const path = await writeSkillFile(
      join(home, ".agents", "skills"),
      "commit",
      skillFile("commit", "Write a commit.", "body"),
    );
    const previous = process.env.HOME;
    process.env.HOME = home;
    try {
      const scan = await scanSkills({ workspace, bundled });

      expect(scan.skills).toEqual([
        { name: "commit", description: "Write a commit.", origin: "global", path },
      ]);
    } finally {
      if (previous === undefined) delete process.env.HOME;
      else process.env.HOME = previous;
    }
  });
});

describe("loadSkill", () => {
  it("returns the body only when asked, leaving it out of the scan", async () => {
    const { workspace, home, bundled } = await makeRoots();
    await writeSkillFile(
      join(workspace, ".agents", "skills"),
      "release",
      skillFile("release", "Cut a release.", "1. Tag.\n2. Publish.\n"),
    );

    const scan = await scanSkills({ workspace, home, bundled });
    const skill = scan.skills[0]!;

    expect(skill).not.toHaveProperty("body");
    expect(await loadSkill(skill)).toBe("1. Tag.\n2. Publish.");
  });

  it("reports a skill that became unreadable after the scan", async () => {
    const { workspace, home, bundled } = await makeRoots();
    const path = await writeSkillFile(
      join(workspace, ".agents", "skills"),
      "release",
      skillFile("release", "Cut a release.", "body"),
    );
    const scan = await scanSkills({ workspace, home, bundled });
    await writeFile(path, "---\ndescription: broken now.\n---\nbody\n", "utf8");

    await expect(loadSkill(scan.skills[0]!)).rejects.toThrow(
      'Skill "release" is unreadable: frontmatter field "name" must be a non-empty string',
    );
  });
});
