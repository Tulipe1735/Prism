import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { execa } from "execa";
import { afterEach, expect, it } from "vitest";

import { createCardShadowScenario } from "./card-shadow";

let fixtureRoot: string | undefined;

afterEach(async () => {
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
});

it("builds the deterministic card-shadow manifest from committed known-bad files", async () => {
  fixtureRoot = await mkdtemp(path.join(tmpdir(), "prism-card-shadow-"));
  await mkdir(path.join(fixtureRoot, "src", "routes"), { recursive: true });
  await Promise.all([
    writeFile(path.join(fixtureRoot, "src", "App.tsx"), "export const App = null;"),
    writeFile(
      path.join(fixtureRoot, "src", "routes", "card-shadow.tsx"),
      "export const CardShadowPage = null;",
    ),
    writeFile(
      path.join(fixtureRoot, "src", "routes", "card-shadow.css"),
      ".profile-card { box-shadow: none; }",
    ),
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

  const manifest = await createCardShadowScenario({ fixtureRoot });

  expect(manifest).toMatchObject({
    scenarioId: "card-shadow",
    route: "/card-shadow",
    spec: {
      target: { role: "region", name: "Profile card" },
      predicates: expect.arrayContaining([
        { kind: "shadow-present" },
        { kind: "surroundings-within", tolerancePx: 2 },
      ]),
    },
    codeOracle: { scopedPaths: ["src/routes/card-shadow.css"] },
  });
  expect(Object.keys(manifest.knownBad.fileHashes)).toHaveLength(3);
});
