import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRoundButtonScenario } from "./round-button";

const roots: string[] = [];

async function createFixtureRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "prism-round-button-"));
  roots.push(root);
  await execa("git", ["init", "-q"], { cwd: root });
  await execa("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await execa("git", ["config", "user.name", "Test"], { cwd: root });
  // 已知缺陷态源文件（方形按钮）
  await mkdir(path.join(root, "src", "routes"), { recursive: true });
  await writeFile(
    path.join(root, "src", "routes", "round-button.tsx"),
    "export function RoundButtonPage() { return <button className='save-button'>Save</button>; }",
  );
  await writeFile(
    path.join(root, "src", "global.css"),
    ".save-button { border-radius: 0; width: 96px; height: 44px; }",
  );
  await writeFile(
    path.join(root, "src", "App.tsx"),
    "export function App() { return null; }",
  );
  await execa("git", ["add", "."], { cwd: root });
  await execa("git", ["commit", "-q", "-m", "known-bad"], { cwd: root });
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("createRoundButtonScenario", () => {
  let fixtureRoot: string;
  let revision: string;

  beforeEach(async () => {
    fixtureRoot = await createFixtureRepo();
    revision = (
      await execa("git", ["rev-parse", "HEAD"], { cwd: fixtureRoot })
    ).stdout.trim();
  });

  it("builds a manifest whose known-bad hashes match the committed fixture", async () => {
    const manifest = await createRoundButtonScenario({ fixtureRoot, revision });

    expect(manifest.scenarioId).toBe("round-button");
    expect(manifest.prompt).toContain("rounded instead of square");
    expect(manifest.route).toBe("/round-button");
    expect(manifest.knownBad.revision).toBe(revision);
    expect(manifest.knownBad.fileHashes).toHaveProperty("src/routes/round-button.tsx");
    expect(manifest.knownBad.fileHashes).toHaveProperty("src/global.css");
    // 修复规范必须避免发明用户未给出的精确 CSS 值
    expect(manifest.prompt).not.toMatch(/\d+px|border-radius\s*:/);
  });

  it("records hashes from the committed revision, not the live working tree", async () => {
    const before = await createRoundButtonScenario({ fixtureRoot, revision });

    // 模拟一次修复：修改工作区源文件
    await writeFile(
      path.join(fixtureRoot, "src", "global.css"),
      ".save-button { border-radius: 12px; }",
    );

    const after = await createRoundButtonScenario({ fixtureRoot, revision });

    // 已知缺陷身份保持稳定，不随工作区修复漂移
    expect(after.knownBad.fileHashes).toEqual(before.knownBad.fileHashes);
  });

  it("targets the same Save button in the spec and the browser Oracle", async () => {
    const manifest = await createRoundButtonScenario({ fixtureRoot, revision });

    expect(manifest.spec.target).toEqual(manifest.browserOracle.target);
  });

  it("declares the metric-increase materiality thresholds", async () => {
    const manifest = await createRoundButtonScenario({ fixtureRoot, revision });
    const increase = manifest.spec.predicates.find(
      (predicate) => predicate.kind === "metric-increase",
    );

    expect(increase).toMatchObject({ minDeltaPx: 8, minAfterPx: 8 });
  });
});
