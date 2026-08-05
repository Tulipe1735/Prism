/**
 * 场景 1 —— 圆形主按钮（round-button）清单
 *
 * 把 fixtures/react-repair 的缺陷态、归一化规范、双 Oracle 与确定性重置
 * 绑定成一个评估单元。已知缺陷身份从已知缺陷 git 修订的已提交内容计算
 * （不读工作区），保证重置/差异基准始终对照缺陷态而不是被修复后漂移；
 * knownBadRevision 显式声明缺陷态所在的修订。
 *
 * fixtureRoot/revision 可注入（测试用临时 git 仓库），默认指向仓库里的
 * fixtures/react-repair 与当前 HEAD —— 调用方必须确保 fixture 已以缺陷态
 * 提交。
 */
import { fileURLToPath } from "node:url";

import { execa } from "execa";

import { gitRepoRoot, toRepoRelativePath } from "../git";
import { sha256 } from "../hash";
import {
  SCENARIO_MANIFEST_SCHEMA_VERSION,
  type ScenarioManifest,
  scenarioManifestSchema,
} from "../scenario-manifest";

const DEFAULT_FIXTURE_ROOT = fileURLToPath(
  new URL("../../../../fixtures/react-repair", import.meta.url),
);

const KNOWN_BAD_SOURCE_FILES = [
  "src/routes/round-button.tsx",
  "src/global.css",
  "src/App.tsx",
] as const;

export interface RoundButtonScenarioOptions {
  fixtureRoot?: string;
  /** 已知缺陷 git 修订；默认取 fixture 当前 HEAD。 */
  revision?: string;
}

/** 当前 git 修订：调用方应确保 fixture 以缺陷态提交后调用。 */
async function currentRevision(workspaceRoot: string): Promise<string> {
  const result = await execa("git", ["rev-parse", "HEAD"], {
    cwd: workspaceRoot,
    reject: false,
    shell: false,
  });
  if (result.exitCode !== 0) {
    throw new Error("Unable to resolve the fixture's known-bad git revision.");
  }
  return result.stdout.trim();
}

/** 从 git 修订读取已提交文件内容并计算 SHA-256（不读工作区）。 */
async function committedSha256(
  workspaceRoot: string,
  revision: string,
  relativePath: string,
): Promise<string> {
  const repoRoot = await gitRepoRoot(workspaceRoot);
  // git show <rev>:<path> 需要仓库相对路径；工作区通常嵌套在仓库内
  const repoRelative = toRepoRelativePath(workspaceRoot, repoRoot, relativePath);
  const result = await execa("git", ["show", `${revision}:${repoRelative}`], {
    cwd: workspaceRoot,
    reject: false,
    shell: false,
    encoding: "buffer",
    stripFinalNewline: false,
  });
  if (result.exitCode !== 0) {
    throw new Error(`Known-bad file ${relativePath} is not committed at ${revision}.`);
  }
  return sha256(result.stdout);
}

/**
 * 构造并校验 round-button 场景清单。
 *
 * @throws 当已知缺陷源文件尚未以缺陷态提交或清单自检失败时
 */
export async function createRoundButtonScenario(
  options: RoundButtonScenarioOptions = {},
): Promise<ScenarioManifest> {
  const fixtureRoot = options.fixtureRoot ?? DEFAULT_FIXTURE_ROOT;
  const revision = options.revision ?? (await currentRevision(fixtureRoot));
  const fileHashes: Record<string, string> = {};
  for (const relativePath of KNOWN_BAD_SOURCE_FILES) {
    fileHashes[relativePath] = await committedSha256(
      fixtureRoot,
      revision,
      relativePath,
    );
  }

  return scenarioManifestSchema.parse({
    schemaVersion: SCENARIO_MANIFEST_SCHEMA_VERSION,
    scenarioId: "round-button",
    title: "Make the primary Save button clearly rounded instead of square.",
    prompt: "Make the primary Save button clearly rounded instead of square.",
    fixturePath: fixtureRoot,
    route: "/round-button",
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    knownBad: { revision, fileHashes },
    spec: {
      schemaVersion: "prism.frontend-repair-spec/v1",
      prompt: "Make the primary Save button clearly rounded instead of square.",
      target: { kind: "semantic", role: "button", name: "Save", exact: true },
      predicates: [
        {
          kind: "metric-increase",
          metric: "borderRadius",
          minDeltaPx: 8,
          minAfterPx: 8,
        },
        { kind: "region-clip-differs" },
        { kind: "label-preserved" },
        { kind: "clickable" },
        { kind: "size-within", tolerancePx: 4 },
        { kind: "layout-within", tolerancePx: 4 },
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
      browser: {
        maxActions: 12,
        maxDurationMs: 300_000,
        maxCostUsd: 5,
      },
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
      restorePaths: [...KNOWN_BAD_SOURCE_FILES],
    },
  });
}
