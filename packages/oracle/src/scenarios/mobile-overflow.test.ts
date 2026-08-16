import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { execa } from "execa";
import { expect, it } from "vitest";

import { createMobileOverflowScenario } from "./mobile-overflow";

it("builds the deterministic mobile-overflow manifest", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "prism-mobile-overflow-"));
  try {
    await mkdir(path.join(root, "src", "routes"), { recursive: true });
    await Promise.all([
      writeFile(path.join(root, "src", "App.tsx"), "export const App = null;"),
      writeFile(
        path.join(root, "src", "routes", "mobile-overflow.tsx"),
        "export const MobileOverflowPage = null;",
      ),
      writeFile(
        path.join(root, "src", "routes", "mobile-overflow.css"),
        ".checkout-actions { width: 440px; max-width: none; }",
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

    const manifest = await createMobileOverflowScenario({ fixtureRoot: root });

    expect(manifest).toMatchObject({
      scenarioId: "mobile-overflow",
      route: "/mobile-overflow",
      viewport: { width: 390, height: 844 },
      spec: {
        target: { role: "region", name: "Checkout actions" },
        predicates: [
          {
            kind: "responsive-layout",
            desktopViewport: { width: 1280, height: 720 },
            tolerancePx: 2,
          },
        ],
      },
      codeOracle: { scopedPaths: ["src/routes/mobile-overflow.css"] },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
