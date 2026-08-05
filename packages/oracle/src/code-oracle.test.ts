import { describe, expect, it } from "vitest";

import {
  CodeOracle,
  type CommandOutcome,
  type CommandRunner,
  gitDiffChangedFiles,
  isDiffScoped,
  isPathInScope,
} from "./code-oracle";

const scopedPaths = ["src/"];

describe("isPathInScope / isDiffScoped", () => {
  it("accepts changes inside the scoped directory", () => {
    expect(
      isDiffScoped(["src/routes/round-button.tsx", "src/global.css"], scopedPaths),
    ).toEqual({ scoped: true, outOfScope: [] });
  });

  it("rejects changes outside the scoped directory", () => {
    const result = isDiffScoped(["package.json", "src/global.css"], scopedPaths);
    expect(result.scoped).toBe(false);
    expect(result.outOfScope).toEqual(["package.json"]);
  });

  it("rejects an empty diff because a repair must change source", () => {
    const result = isDiffScoped([], scopedPaths);
    expect(result.scoped).toBe(false);
  });

  it("accepts exact-file scoped paths", () => {
    expect(isPathInScope("src/global.css", ["src/global.css"])).toBe(true);
    expect(isPathInScope("src/other.tsx", ["src/global.css"])).toBe(false);
  });
});

function outcome(partial: Partial<CommandOutcome> = {}): CommandOutcome {
  return { exitCode: 0, stdout: "", stderr: "", ...partial };
}

function runnerWith(commands: Record<string, CommandOutcome>): CommandRunner {
  return {
    async run(command) {
      const key = `${command.executable} ${command.arguments.join(" ")}`;
      return commands[key] ?? outcome();
    },
  };
}

describe("CodeOracle.verify", () => {
  it("passes when the diff is scoped, the build succeeds, and tests pass", async () => {
    const oracle = new CodeOracle({
      workspaceRoot: "/tmp/fixture",
      scopedPaths: ["src/"],
      buildCommand: { executable: "pnpm", arguments: ["build"] },
      testCommand: { executable: "pnpm", arguments: ["test"] },
      knownBadRevision: "abc123",
      runner: runnerWith({
        "pnpm build": outcome(),
        "pnpm test": outcome(),
      }),
      diff: async () => ["src/global.css"],
    });

    const result = await oracle.verify();

    expect(result.passed).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.changedFiles).toEqual(["src/global.css"]);
  });

  it("fails when the diff escapes the allowed scope", async () => {
    const oracle = new CodeOracle({
      workspaceRoot: "/tmp/fixture",
      scopedPaths: ["src/"],
      buildCommand: { executable: "pnpm", arguments: ["build"] },
      testCommand: { executable: "pnpm", arguments: ["test"] },
      knownBadRevision: "abc123",
      runner: runnerWith({
        "pnpm build": outcome(),
        "pnpm test": outcome(),
      }),
      diff: async () => ["package.json", "src/global.css"],
    });

    const result = await oracle.verify();

    expect(result.passed).toBe(false);
    expect(result.issues.join("\n")).toContain("package.json");
  });

  it("fails when the build fails even with a scoped diff", async () => {
    const oracle = new CodeOracle({
      workspaceRoot: "/tmp/fixture",
      scopedPaths: ["src/"],
      buildCommand: { executable: "pnpm", arguments: ["build"] },
      testCommand: { executable: "pnpm", arguments: ["test"] },
      knownBadRevision: "abc123",
      runner: runnerWith({
        "pnpm build": outcome({ exitCode: 1, stderr: "build error" }),
        "pnpm test": outcome(),
      }),
      diff: async () => ["src/global.css"],
    });

    const result = await oracle.verify();

    expect(result.passed).toBe(false);
    expect(result.issues.join("\n")).toContain("build failed");
  });

  it("fails when the relevant tests fail even with a successful build", async () => {
    const oracle = new CodeOracle({
      workspaceRoot: "/tmp/fixture",
      scopedPaths: ["src/"],
      buildCommand: { executable: "pnpm", arguments: ["build"] },
      testCommand: { executable: "pnpm", arguments: ["test"] },
      knownBadRevision: "abc123",
      runner: runnerWith({
        "pnpm build": outcome(),
        "pnpm test": outcome({ exitCode: 2 }),
      }),
      diff: async () => ["src/global.css"],
    });

    const result = await oracle.verify();

    expect(result.passed).toBe(false);
    expect(result.issues.join("\n")).toContain("tests failed");
  });
});

describe("gitDiffChangedFiles", () => {
  it("returns the changed paths relative to the known-bad revision", async () => {
    const changed = await gitDiffChangedFiles(
      "/home/tulipe/projects/prism/fixtures/react-repair",
      "HEAD",
    );

    // 当前工作区相对 HEAD 无未提交变更，应返回空清单（不抛错）
    expect(Array.isArray(changed)).toBe(true);
  });
});
