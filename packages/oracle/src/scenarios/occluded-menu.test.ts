import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { execa } from "execa";
import { afterEach, expect, it } from "vitest";

import { createOccludedMenuScenario } from "./occluded-menu";

let fixtureRoot: string | undefined;

afterEach(async () => {
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
  fixtureRoot = undefined;
});

it("builds the deterministic occluded-menu manifest", async () => {
  fixtureRoot = await mkdtemp(path.join(tmpdir(), "prism-occluded-menu-"));
  await Promise.all([
    writeFile(path.join(fixtureRoot, "package.json"), "{}\n"),
    writeSource(fixtureRoot, "src/routes/occluded-menu.tsx", "menu\n"),
    writeSource(fixtureRoot, "src/routes/occluded-menu.css", "z-index: 1;\n"),
    writeSource(fixtureRoot, "src/App.tsx", "route\n"),
  ]);
  await execa("git", ["init", "-q"], { cwd: fixtureRoot });
  await execa("git", ["add", "."], { cwd: fixtureRoot });
  await execa(
    "git",
    [
      "-c",
      "user.name=Prism Test",
      "-c",
      "user.email=prism@example.test",
      "commit",
      "-q",
      "-m",
      "known bad",
    ],
    { cwd: fixtureRoot },
  );

  await expect(createOccludedMenuScenario({ fixtureRoot })).resolves.toMatchObject({
    scenarioId: "occluded-menu",
    route: "/occluded-menu",
    spec: {
      target: { role: "menuitem", name: "Profile" },
      predicates: [
        { kind: "menu-behavior", triggerName: "Account menu" },
        { kind: "layout-within", tolerancePx: 2 },
      ],
    },
    codeOracle: { scopedPaths: ["src/routes/occluded-menu.css"] },
  });
});

async function writeSource(root: string, relativePath: string, content: string) {
  const directory = path.dirname(path.join(root, relativePath));
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(root, relativePath), content);
}
