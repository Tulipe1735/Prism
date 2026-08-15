import path from "node:path";
import process from "node:process";

import {
  SCENARIO_MANIFEST_SCHEMA_VERSION,
  type ScenarioManifest,
  scenarioManifestSchema,
} from "../scenario-manifest";
import { knownBadIdentity } from "./known-bad";

const DEFAULT_FIXTURE_ROOT = path.resolve(process.cwd(), "../../fixtures/react-repair");
const PROMPT =
  "Restore a subtle but visible shadow to the profile card without moving it.";
const KNOWN_BAD_SOURCE_FILES = [
  "src/routes/card-shadow.tsx",
  "src/routes/card-shadow.css",
  "src/App.tsx",
] as const;

export interface CardShadowScenarioOptions {
  fixtureRoot?: string;
  revision?: string;
}

export async function createCardShadowScenario(
  options: CardShadowScenarioOptions = {},
): Promise<ScenarioManifest> {
  const fixtureRoot = options.fixtureRoot ?? DEFAULT_FIXTURE_ROOT;
  const knownBad = await knownBadIdentity(
    fixtureRoot,
    KNOWN_BAD_SOURCE_FILES,
    options.revision,
  );
  const target = {
    kind: "semantic",
    role: "region",
    name: "Profile card",
    exact: true,
  } as const;

  return scenarioManifestSchema.parse({
    schemaVersion: SCENARIO_MANIFEST_SCHEMA_VERSION,
    scenarioId: "card-shadow",
    title: PROMPT,
    prompt: PROMPT,
    fixturePath: fixtureRoot,
    route: "/card-shadow",
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    knownBad,
    spec: {
      schemaVersion: "prism.frontend-repair-spec/v1",
      prompt: PROMPT,
      target,
      predicates: [
        { kind: "shadow-present" },
        { kind: "region-clip-differs" },
        { kind: "size-within", tolerancePx: 2 },
        { kind: "layout-within", tolerancePx: 2 },
        { kind: "surroundings-within", tolerancePx: 2 },
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
      scopedPaths: ["src/routes/card-shadow.css"],
      buildCommand: { executable: "pnpm", arguments: ["build"] },
      testCommand: { executable: "pnpm", arguments: ["test"] },
    },
    browserOracle: {
      baseUrl: "http://127.0.0.1:4173",
      target,
      browser: { name: "chromium", executablePath: null },
    },
    reset: { restorePaths: [...KNOWN_BAD_SOURCE_FILES] },
  });
}
