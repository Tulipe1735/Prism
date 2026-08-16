import path from "node:path";
import process from "node:process";

import {
  SCENARIO_MANIFEST_SCHEMA_VERSION,
  type ScenarioManifest,
  scenarioManifestSchema,
} from "../scenario-manifest";
import { knownBadIdentity } from "./known-bad";

const DEFAULT_FIXTURE_ROOT = path.resolve(process.cwd(), "../../fixtures/react-repair");
const PROMPT = "The account menu opens behind the header and cannot be clicked.";
const KNOWN_BAD_SOURCE_FILES = [
  "src/routes/occluded-menu.tsx",
  "src/routes/occluded-menu.css",
  "src/App.tsx",
] as const;

export async function createOccludedMenuScenario(
  options: { fixtureRoot?: string; revision?: string } = {},
): Promise<ScenarioManifest> {
  const fixtureRoot = options.fixtureRoot ?? DEFAULT_FIXTURE_ROOT;
  const target = {
    kind: "semantic",
    role: "menuitem",
    name: "Profile",
    exact: true,
  } as const;

  return scenarioManifestSchema.parse({
    schemaVersion: SCENARIO_MANIFEST_SCHEMA_VERSION,
    scenarioId: "occluded-menu",
    title: PROMPT,
    prompt: PROMPT,
    fixturePath: fixtureRoot,
    route: "/occluded-menu",
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    knownBad: await knownBadIdentity(
      fixtureRoot,
      KNOWN_BAD_SOURCE_FILES,
      options.revision,
    ),
    spec: {
      schemaVersion: "prism.frontend-repair-spec/v1",
      prompt: PROMPT,
      target,
      predicates: [
        {
          kind: "menu-behavior",
          triggerName: "Account menu",
          successText: "Profile selected",
        },
        { kind: "layout-within", tolerancePx: 2 },
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
      scopedPaths: ["src/routes/occluded-menu.css"],
      buildCommand: { executable: "pnpm", arguments: ["build"] },
      testCommand: { executable: "pnpm", arguments: ["test"] },
    },
    browserOracle: {
      baseUrl: "http://127.0.0.1:4173",
      target,
      menu: { triggerName: "Account menu", successText: "Profile selected" },
      browser: { name: "chromium", executablePath: null },
    },
    reset: { restorePaths: [...KNOWN_BAD_SOURCE_FILES] },
  });
}
