import {
  browserRuntimeBudgetSchema,
  frontendRepairSpecSchema,
  runDagNodeTypeSchema,
  runtimeBudgetSchema,
  semanticBrowserTargetSchema,
  viewportSchema,
  workspaceCommandSchema,
} from "@prism/contracts";

/**
 * Prism 场景清单（scenario manifest）契约
 *
 * 一个 React 修复场景的完整声明：已知缺陷态身份、路由与视口、归一化修复
 * 规范、可接受的 DAG 家族、必需产物、预算、编码 Oracle、浏览器 Oracle
 * 与确定性重置。编码/浏览器 Oracle 与重置都以可判定的输入输出定义，
 * 不依赖任何具体运行时实现。
 */
import { z } from "zod";

export const SCENARIO_MANIFEST_SCHEMA_VERSION = "prism.scenario-manifest/v1" as const;

/**
 * 已知缺陷态身份：git 修订 + 涉及源码文件的内容寻址摘要。
 *
 * fileHashes 以 fixture 相对路径为键、SHA-256 为值，用于证明重置后的
 * 源码与已知缺陷态逐字节一致。
 */
const knownBadIdentitySchema = z
  .object({
    revision: z.string().trim().min(1).max(200),
    fileHashes: z.record(
      z.string().trim().min(1).max(300),
      z.string().regex(/^[0-9a-f]{64}$/, "Known-bad file hashes must be SHA-256."),
    ),
  })
  .strict();

/**
 * 必需产物：一次成功尝试必须提交的证据种类。
 */
const requiredArtifactSchema = z.enum([
  "repair_request",
  "frontend_repair_spec",
  "browser_baseline",
  "workspace_patch",
  "build_evidence",
  "test_evidence",
  "browser_verification",
]);

/**
 * 浏览器 Oracle 配置：本地基址 + 语义目标，视口取自清单顶层。
 */
const browserOracleConfigSchema = z
  .object({
    baseUrl: z.string().url().max(2_048),
    target: semanticBrowserTargetSchema,
    /** 固定的浏览器身份：名称 + 可选可执行文件路径（用于可复现渲染）。 */
    browser: z
      .object({
        name: z.string().trim().min(1).max(120),
        executablePath: z.string().trim().min(1).max(1_024).nullable(),
      })
      .strict(),
  })
  .strict();

/**
 * 编码 Oracle 配置：允许变更的源码作用域 + 构建/测试命令。
 */
const codeOracleConfigSchema = z
  .object({
    scopedPaths: z.array(z.string().trim().min(1).max(300)).min(1).max(64),
    buildCommand: workspaceCommandSchema,
    testCommand: workspaceCommandSchema,
  })
  .strict();

/**
 * 场景清单：把 fixture、规范与双 Oracle 绑定成一个可评估的评估单元。
 */
export const scenarioManifestSchema = z
  .object({
    schemaVersion: z.literal(SCENARIO_MANIFEST_SCHEMA_VERSION, {
      error: "This scenario manifest schema version is not supported.",
    }),
    scenarioId: z.string().trim().min(1).max(120),
    title: z.string().trim().min(1).max(200),
    prompt: z.string().trim().min(1).max(2000),
    fixturePath: z.string().trim().min(1).max(1_024),
    route: z
      .string()
      .min(1)
      .max(1_024)
      .refine(
        (value) =>
          value.startsWith("/") && !value.startsWith("//") && !value.includes("\\"),
        "Scenario routes must be normalized local paths.",
      ),
    viewport: viewportSchema,
    knownBad: knownBadIdentitySchema,
    spec: frontendRepairSpecSchema,
    dagFamily: z.array(z.array(runDagNodeTypeSchema)).min(1).max(8),
    requiredArtifacts: z.array(requiredArtifactSchema).min(1).max(16),
    budgets: z
      .object({
        code: runtimeBudgetSchema,
        browser: browserRuntimeBudgetSchema,
      })
      .strict(),
    codeOracle: codeOracleConfigSchema,
    browserOracle: browserOracleConfigSchema,
    reset: z
      .object({
        // 重置 = 恢复已知缺陷源文件 + 证明基线仍为缺陷态
        restorePaths: z.array(z.string().trim().min(1).max(300)).min(1).max(64),
      })
      .strict(),
  })
  .strict()
  .superRefine((manifest, context) => {
    // 重置必须覆盖已知缺陷身份里记录的全部源码文件
    const knownBadPaths = new Set(Object.keys(manifest.knownBad.fileHashes));
    const restoreMissing = [...knownBadPaths].filter(
      (path) => !manifest.reset.restorePaths.includes(path),
    );
    if (restoreMissing.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["reset", "restorePaths"],
        message: `Reset must restore every known-bad source file: ${restoreMissing.join(", ")}.`,
      });
    }
    // 归一化规范的目标必须能被浏览器 Oracle 目标定位
    const specTarget = manifest.spec.target;
    const oracleTarget = manifest.browserOracle.target;
    if (
      specTarget.role !== oracleTarget.role ||
      specTarget.name !== oracleTarget.name ||
      specTarget.exact !== oracleTarget.exact
    ) {
      context.addIssue({
        code: "custom",
        path: ["browserOracle", "target"],
        message: "The browser Oracle target must match the FrontendRepairSpec target.",
      });
    }
  });

export type KnownBadIdentity = z.infer<typeof knownBadIdentitySchema>;
export type RequiredArtifact = z.infer<typeof requiredArtifactSchema>;
export type ScenarioManifest = z.infer<typeof scenarioManifestSchema>;
