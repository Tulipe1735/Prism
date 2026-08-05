import { formatContractIssues } from "@prism/contracts";

import { describe, expect, it } from "vitest";

import { scenarioManifestSchema } from "./index";

const validManifest = {
  schemaVersion: "prism.scenario-manifest/v1",
  scenarioId: "round-button",
  title: "Make the primary Save button clearly rounded instead of square.",
  prompt: "Make the primary Save button clearly rounded instead of square.",
  fixturePath: "/work/fixtures/react-repair",
  route: "/round-button",
  viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
  knownBad: {
    revision: "abc123",
    fileHashes: {
      "src/routes/round-button.tsx":
        "b643841579b9046810818a28102ca1c1c8d3332feea03797571194dccc09f253",
      "src/global.css":
        "ae61b909074d76ce776dbdd54eb76e4f213bd8922b8078cb3c91bfde87aa80c0",
    },
  },
  spec: {
    schemaVersion: "prism.frontend-repair-spec/v1",
    prompt: "Make the primary Save button clearly rounded instead of square.",
    target: { kind: "semantic", role: "button", name: "Save", exact: true },
    predicates: [
      { kind: "metric-increase", metric: "borderRadius", minDeltaPx: 8, minAfterPx: 8 },
    ],
  },
  dagFamily: [
    [
      "workspace.inspect",
      "browser.observe",
      "workspace.patch",
      "browser.verify",
      "task.complete",
    ],
  ],
  requiredArtifacts: [
    "repair_request",
    "frontend_repair_spec",
    "browser_baseline",
    "workspace_patch",
    "build_evidence",
    "test_evidence",
    "browser_verification",
  ],
  budgets: {
    code: {
      maxModelCalls: 12,
      maxInputTokens: 100_000,
      maxOutputTokens: 20_000,
      maxTotalTokens: 120_000,
      maxCostUsd: 5,
      maxDurationMs: 300_000,
    },
    browser: { maxActions: 12, maxDurationMs: 300_000, maxCostUsd: 5 },
  },
  codeOracle: {
    scopedPaths: ["src/"],
    buildCommand: { executable: "pnpm", arguments: ["build"] },
    testCommand: { executable: "pnpm", arguments: ["test"] },
  },
  browserOracle: {
    baseUrl: "http://127.0.0.1:4173",
    target: { kind: "semantic", role: "button", name: "Save", exact: true },
    browser: { name: "chromium", executablePath: null },
  },
  reset: {
    restorePaths: ["src/routes/round-button.tsx", "src/global.css"],
  },
} as const;

describe("scenarioManifestSchema", () => {
  it("accepts a complete round-button scenario manifest", () => {
    const parsed = scenarioManifestSchema.parse(validManifest);

    expect(parsed.scenarioId).toBe("round-button");
    expect(parsed.prompt).toBe(validManifest.prompt);
    expect(parsed.spec.predicates[0]).toMatchObject({
      kind: "metric-increase",
      metric: "borderRadius",
    });
  });

  it("requires reset to restore every known-bad source file", () => {
    const result = scenarioManifestSchema.safeParse({
      ...validManifest,
      reset: { restorePaths: ["src/routes/round-button.tsx"] },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = formatContractIssues(result.error);
      expect(issues.some((issue) => issue.path === "reset.restorePaths")).toBe(true);
    }
  });

  it("requires the browser Oracle target to match the spec target", () => {
    const result = scenarioManifestSchema.safeParse({
      ...validManifest,
      browserOracle: {
        ...validManifest.browserOracle,
        target: { kind: "semantic", role: "button", name: "Cancel", exact: true },
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = formatContractIssues(result.error);
      expect(issues.some((issue) => issue.path === "browserOracle.target")).toBe(true);
    }
  });

  it("rejects an unsupported schema version", () => {
    const result = scenarioManifestSchema.safeParse({
      ...validManifest,
      schemaVersion: "prism.scenario-manifest/v2",
    });

    expect(result.success).toBe(false);
  });
});
