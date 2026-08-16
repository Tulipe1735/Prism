import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { execa } from "execa";
import { expect, it } from "vitest";

import { createFormEnablementScenario } from "./form-enablement";

it("builds the deterministic form-enablement manifest", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "prism-form-enablement-"));
  try {
    await mkdir(path.join(root, "src", "routes"), { recursive: true });
    await Promise.all([
      writeFile(path.join(root, "src", "App.tsx"), "export const App = null;"),
      writeFile(
        path.join(root, "src", "routes", "form-enablement.tsx"),
        "export const FormEnablementPage = null;",
      ),
      writeFile(
        path.join(root, "src", "routes", "form-enablement.css"),
        ".signup-form { display: grid; }",
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

    const manifest = await createFormEnablementScenario({ fixtureRoot: root });

    expect(manifest).toMatchObject({
      scenarioId: "form-enablement",
      route: "/form-enablement",
      spec: {
        target: { role: "button", name: "Submit" },
        predicates: [
          {
            kind: "form-enablement",
            inputName: "Email",
            invalidValue: "not-an-email",
            validValue: "ada@example.test",
          },
        ],
      },
      codeOracle: { scopedPaths: ["src/routes/form-enablement.tsx"] },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
