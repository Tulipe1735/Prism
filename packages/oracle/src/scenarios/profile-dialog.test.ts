import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { execa } from "execa";
import { expect, it } from "vitest";

import { createProfileDialogScenario } from "./profile-dialog";

it("builds the deterministic profile Dialog manifest", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "prism-profile-dialog-"));
  try {
    await mkdir(path.join(root, "src", "routes"), { recursive: true });
    await Promise.all([
      writeFile(path.join(root, "src", "App.tsx"), "export const App = null;"),
      writeFile(
        path.join(root, "src", "routes", "profile-dialog.tsx"),
        "export const ProfileDialogPage = null;",
      ),
      writeFile(
        path.join(root, "src", "routes", "profile-dialog.css"),
        ".profile-dialog { padding: 24px; }",
      ),
    ]);
    await execa("git", ["init", "-q"], { cwd: root });
    await execa("git", ["add", "."], { cwd: root });
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
      { cwd: root },
    );

    const manifest = await createProfileDialogScenario({ fixtureRoot: root });

    expect(manifest).toMatchObject({
      scenarioId: "profile-dialog",
      route: "/profile-dialog",
      spec: {
        target: { role: "button", name: "Edit profile" },
        predicates: [{ kind: "dialog-behavior", dialogName: "Edit profile" }],
      },
      browserOracle: { dialogName: "Edit profile" },
      codeOracle: { scopedPaths: ["src/routes/profile-dialog.tsx"] },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
