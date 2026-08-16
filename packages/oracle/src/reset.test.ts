import type { FrontendRepairSpec } from "@prism/contracts";
import type { BrowserOracle } from "./browser-oracle";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { tmpdir } from "node:os";
import path from "node:path";

import { execa } from "execa";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetFixture, resetKnownBadSource, verifyKnownBadHashes } from "./reset";

const roots: string[] = [];

async function sha256(content: string): Promise<string> {
  return createHash("sha256").update(content).digest("hex");
}

async function createGitRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "prism-reset-"));
  roots.push(root);
  await execa("git", ["init", "-q"], { cwd: root });
  await execa("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await execa("git", ["config", "user.name", "Test"], { cwd: root });
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("resetFixture", () => {
  let root: string;
  let revision: string;

  beforeEach(async () => {
    root = await createGitRepo();
    // 已知缺陷源文件（方形按钮）
    await writeFile(
      path.join(root, "global.css"),
      ".save-button { border-radius: 0; width: 96px; height: 44px; }",
    );
    await execa("git", ["add", "."], { cwd: root });
    await execa("git", ["commit", "-q", "-m", "known-bad"], { cwd: root });
    revision = (await execa("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
  });

  function browserOracleStub(radiusPx: number) {
    return {
      observe: async () => ({
        observationId: "a0e2d4c6-1f3a-4b5c-8d7e-9f0a1b2c3d4e",
        url: `http://127.0.0.1:4173/round-button?radius=${radiusPx}`,
        viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
        target: { kind: "semantic", role: "button", name: "Save", exact: true },
        borderRadiusPx: radiusPx,
        widthPx: 96,
        heightPx: 44,
        xPx: 100,
        yPx: 200,
        text: "Save",
        enabled: true,
        visible: true,
        pointerEvents: "auto",
        regionClipHash: "d".repeat(64),
        screenshotHash: "e".repeat(64),
      }),
    } as BrowserOracle;
  }

  const spec: FrontendRepairSpec = {
    schemaVersion: "prism.frontend-repair-spec/v1",
    prompt: "Make the primary Save button clearly rounded instead of square.",
    target: { kind: "semantic", role: "button", name: "Save", exact: true },
    predicates: [
      { kind: "metric-increase", metric: "borderRadius", minDeltaPx: 8, minAfterPx: 8 },
      { kind: "region-clip-differs" },
      { kind: "label-preserved" },
      { kind: "clickable" },
      { kind: "size-within", tolerancePx: 4 },
      { kind: "layout-within", tolerancePx: 4 },
    ],
  };

  it("restores the exact known-bad source and proves the original baseline", async () => {
    const knownBadContent =
      ".save-button { border-radius: 0; width: 96px; height: 44px; }";
    const knownBadHashes = {
      "global.css": await sha256(knownBadContent),
    };

    // 模拟一次修复：修改源文件（圆角 12px）
    await writeFile(
      path.join(root, "global.css"),
      ".save-button { border-radius: 12px; width: 96px; height: 44px; }",
    );

    const result = await resetFixture({
      workspaceRoot: root,
      knownBadRevision: revision,
      knownBadFileHashes: knownBadHashes,
      restorePaths: ["global.css"],
      spec,
      browserOracle: browserOracleStub(0),
    });

    // 源文件被恢复到已知缺陷态
    const restored = await readFile(path.join(root, "global.css"), "utf8");
    expect(restored).toContain("border-radius: 0");
    expect(result.hashesVerified).toBe(true);
    expect(result.mismatchedFiles).toEqual([]);
    expect(result.restoredFiles).toEqual(["global.css"]);
    // 基线证明：方形按钮自比较必为 failed
    expect(result.baselineEvaluation.verdict).toBe("failed");
  });

  it("detects a modified file that no longer matches the known-bad identity", async () => {
    await writeFile(
      path.join(root, "global.css"),
      ".save-button { border-radius: 12px; }",
    );

    const result = await verifyKnownBadHashes(root, {
      "global.css": await sha256(
        ".save-button { border-radius: 0; width: 96px; height: 44px; }",
      ),
    });

    expect(result.verified).toBe(false);
    expect(result.mismatchedFiles).toEqual(["global.css"]);
  });

  it("restores source without opening a browser so an evaluation Run can capture baseline", async () => {
    const knownBadContent =
      ".save-button { border-radius: 0; width: 96px; height: 44px; }";
    await writeFile(
      path.join(root, "global.css"),
      ".save-button { border-radius: 9px; }\n",
    );
    const result = await resetKnownBadSource(
      root,
      revision,
      { "global.css": await sha256(knownBadContent) },
      ["global.css"],
    );
    expect(result).toEqual({
      restoredFiles: ["global.css"],
      hashesVerified: true,
      mismatchedFiles: [],
    });
    expect(await readFile(path.join(root, "global.css"), "utf8")).toBe(knownBadContent);
  });
});
