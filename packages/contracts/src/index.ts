/**
 * Prism 共享契约（contracts）包
 *
 * 本包集中定义 Prism 系统中所有跨模块共享的数据契约：修复请求（repair
 * request）、Run 清单与快照、追加式事件日志、工作区证据、浏览器基线、
 * Run DAG 编排结构等。
 *
 * 每个契约都以 Zod schema 声明，具备两层用途：
 *  1. 运行时校验 —— 在进程/模块边界（HTTP 请求、事件落盘、跨包调用）验证数据合法性；
 *  2. 类型推导 —— 通过 `z.infer` 自动导出 TypeScript 类型，保证全栈类型一致。
 *
 * 版本号采用 "prism.<name>/v1" 格式，schema 一旦发布不再变更字段语义，
 * 如需演进必须引入新版本号，从而支持旧数据安全升级。
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// 版本常量：每个独立契约一个稳定标识，用于落盘数据的自描述与演进判断
// ---------------------------------------------------------------------------
export const REPAIR_REQUEST_SCHEMA_VERSION = "prism.repair-request/v1" as const;
export const REPAIR_REQUEST_VALIDATION_SCHEMA_VERSION =
  "prism.repair-request-validation/v1" as const;
export const FRONTEND_REPAIR_SPEC_SCHEMA_VERSION =
  "prism.frontend-repair-spec/v1" as const;
export const FRONTEND_REPAIR_SPEC_MEDIA_TYPE =
  "application/vnd.prism.frontend-repair-spec+json" as const;
export const CODE_ORACLE_REPORT_MEDIA_TYPE =
  "application/vnd.prism.code-oracle-report+json" as const;
export const RUN_COMPLETION_SCHEMA_VERSION = "prism.run-completion/v1" as const;
export const EFFECT_CONTROL_SCHEMA_VERSION = "prism.effect-control/v1" as const;
export const EFFECT_DECISION_REQUEST_SCHEMA_VERSION =
  "prism.effect-decision-request/v1" as const;
export const CONTRACT_ERROR_SCHEMA_VERSION = "prism.contract-error/v1" as const;
export const ARTIFACT_REF_SCHEMA_VERSION = "prism.artifact-ref/v1" as const;
export const RUN_MANIFEST_SCHEMA_VERSION = "prism.run-manifest/v1" as const;
export const RUN_EVENT_SCHEMA_VERSION = "prism.run-event/v1" as const;
export const RUN_SNAPSHOT_SCHEMA_VERSION = "prism.run-snapshot/v1" as const;
export const RUN_CREATION_SCHEMA_VERSION = "prism.run-creation/v1" as const;
export const RUN_LIST_SCHEMA_VERSION = "prism.run-list/v1" as const;
export const RUN_DOSSIER_RESPONSE_SCHEMA_VERSION =
  "prism.run-dossier-response/v1" as const;
export const ORCHESTRATION_START_RESPONSE_SCHEMA_VERSION =
  "prism.orchestration-start-response/v1" as const;
export const WORKSPACE_REQUEST_SCHEMA_VERSION = "prism.workspace-request/v1" as const;
export const WORKSPACE_EVIDENCE_SCHEMA_VERSION = "prism.workspace-evidence/v1" as const;
export const WORKSPACE_EVIDENCE_RESPONSE_SCHEMA_VERSION =
  "prism.workspace-evidence-response/v1" as const;
export const BROWSER_BASELINE_REQUEST_SCHEMA_VERSION =
  "prism.browser-baseline-request/v1" as const;
export const BROWSER_BASELINE_SCHEMA_VERSION = "prism.browser-baseline/v1" as const;
export const BROWSER_BASELINE_RESPONSE_SCHEMA_VERSION =
  "prism.browser-baseline-response/v1" as const;
export const BROWSER_ACTION_PROPOSAL_SCHEMA_VERSION =
  "prism.browser-action-proposal/v1" as const;
export const BROWSER_ACTION_RECORD_SCHEMA_VERSION =
  "prism.browser-action-record/v1" as const;
export const BROWSER_VERIFICATION_REPORT_SCHEMA_VERSION =
  "prism.browser-verification-report/v1" as const;
export const BROWSER_RUNTIME_TASK_ENVELOPE_SCHEMA_VERSION =
  "prism.browser-task-envelope/v1" as const;
export const BROWSER_RUNTIME_RESULT_SCHEMA_VERSION =
  "prism.browser-runtime-result/v1" as const;

/**
 * 匹配绝对工作区路径的正则：Windows 盘符路径（如 C:\foo）或 POSIX 根路径（/foo）。
 */
const absoluteWorkspacePathPattern = /^(?:[a-z]:[\\/]|\/)/i;

/**
 * 检测字符串中是否含不受支持的控件字符。
 *
 * 允许保留的空白只有制表符（9）、换行（10）、回车（13）；其余码点小于 32
 * 或等于 127 的控件字符一律视为非法，防止路径/提示词中混入异常字节。
 */
function hasUnsupportedControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    const isAllowedWhitespace = codePoint === 9 || codePoint === 10 || codePoint === 13;

    if (
      codePoint !== undefined &&
      ((codePoint < 32 && !isAllowedWhitespace) || codePoint === 127)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * 本地工作区描述：Prism v1 只支持本地目录。
 *
 * path 必须是绝对路径且不含 NUL 字符；displayName 为展示名。
 */
export const localWorkspaceSchema = z
  .object({
    kind: z.literal("local", {
      error: "Only a local workspace is supported in Prism v1.",
    }),
    path: z
      .string()
      .min(1, "Choose a workspace.")
      .max(1024, "The workspace path is too long.")
      .refine(
        (value) => absoluteWorkspacePathPattern.test(value),
        "Use an absolute Windows or POSIX workspace path.",
      )
      .refine(
        (value) => !value.includes("\u0000"),
        "The workspace path contains an unsupported character.",
      ),
    displayName: z
      .string()
      .trim()
      .min(1, "Give the workspace a display name.")
      .max(120, "The workspace display name is too long."),
  })
  .strict();

/**
 * 浏览器视口描述：固定宽/高范围及设备像素比，用于浏览器运行时截图与基线。
 */
export const viewportSchema = z
  .object({
    width: z
      .number()
      .int("Viewport width must be a whole number.")
      .min(320, "Viewport width must be at least 320 px.")
      .max(3840, "Viewport width must be at most 3840 px."),
    height: z
      .number()
      .int("Viewport height must be a whole number.")
      .min(320, "Viewport height must be at least 320 px.")
      .max(2160, "Viewport height must be at most 2160 px."),
    deviceScaleFactor: z
      .number()
      .min(1, "Device scale factor must be at least 1.")
      .max(3, "Device scale factor must be at most 3."),
  })
  .strict();

/**
 * 前端修复请求：一次自然语言修复任务的整体入参。
 *
 * 包含请求文案 prompt、目标工作区与浏览器视口；prompt 至少 6 字符、
 * 上限 2000 字符，且不得含非法控件字符。
 */
export const repairRequestSchema = z
  .object({
    schemaVersion: z.literal(REPAIR_REQUEST_SCHEMA_VERSION, {
      error: "This repair request schema version is not supported.",
    }),
    prompt: z
      .string()
      .max(2000, "Keep the repair request under 2,000 characters.")
      .refine(
        (value) => value.trim().length >= 6,
        "Describe one visible frontend problem in at least 6 characters.",
      )
      .refine(
        (value) => !hasUnsupportedControlCharacter(value),
        "The repair request contains an unsupported control character.",
      ),
    workspace: localWorkspaceSchema,
    viewport: viewportSchema,
  })
  .strict();

/**
 * 单条校验问题：定位到具体字段路径的校验失败描述。
 */
export const validationIssueSchema = z
  .object({
    path: z.string().min(1),
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();

/**
 * 契约错误响应：所有被拒绝的请求统一返回此结构。
 *
 * code 枚举了各类错误（非法 JSON、请求不合法、工作区/浏览器执行失败等），
 * issues 承载 Zod 校验失败的具体明细。
 */
export const contractErrorSchema = z
  .object({
    schemaVersion: z.literal(CONTRACT_ERROR_SCHEMA_VERSION),
    code: z.enum([
      "invalid_json",
      "invalid_repair_request",
      "payload_too_large",
      "unsupported_media_type",
      "unsupported_workspace",
      "run_storage_error",
      "run_not_found",
      "invalid_workspace_request",
      "workspace_execution_error",
      "invalid_browser_baseline_request",
      "browser_baseline_not_configured",
      "browser_execution_error",
      "invalid_effect_decision",
      "stale_effect",
    ]),
    message: z.string().min(1),
    issues: z.array(validationIssueSchema),
  })
  .strict();

/**
 * 修复请求校验通过响应：包裹原始请求，status 固定为 "accepted"。
 */
export const repairRequestValidationSchema = z
  .object({
    schemaVersion: z.literal(REPAIR_REQUEST_VALIDATION_SCHEMA_VERSION),
    status: z.literal("accepted"),
    request: repairRequestSchema,
  })
  .strict();

/**
 * Run 标识：固定 "run_" 前缀 + 合法 UUID 格式（版本 4），全局唯一。
 */
export const runIdSchema = z
  .string()
  .regex(
    /^run_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    "Run IDs must use the supported run_<uuid> format.",
  );

/**
 * 带时区偏移的 ISO 日期时间字符串，用于所有时间戳字段。
 */
const isoDateTimeSchema = z.string().datetime({ offset: true });

/**
 * 内容寻址产物引用（ArtifactRef）。
 *
 * 文件/内容以 SHA-256 摘要标识，配合字节数与媒体类型，可在不可变存储中
 * 定位并校验任意二进制/文本产物（截图、DOM、日志、补丁等）。
 */
export const artifactRefSchema = z
  .object({
    schemaVersion: z.literal(ARTIFACT_REF_SCHEMA_VERSION),
    algorithm: z.literal("sha256"),
    hash: z
      .string()
      .regex(/^[0-9a-f]{64}$/, "Artifact hashes must be lowercase SHA-256 digests."),
    byteLength: z.number().int().nonnegative(),
    mediaType: z
      .string()
      .min(3)
      .max(160)
      .regex(/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/),
  })
  .strict();

/**
 * 通用 SHA-256 摘要格式：64 位小写十六进制。
 */
const sha256Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Values must use a lowercase SHA-256 digest.");

/**
 * 浏览器路由：本地路径形态，必须以单个 "/" 开头、不含 "\\" 与协议双斜杠。
 */
const browserRouteSchema = z
  .string()
  .min(1)
  .max(1_024)
  .refine(
    (value) =>
      value.startsWith("/") && !value.startsWith("//") && !value.includes("\\"),
    "Browser routes must be normalized local paths.",
  );

/**
 * 语义浏览器目标：按 ARIA 角色 + 可访问名定位元素，可选精确匹配。
 */
export const semanticBrowserTargetSchema = z
  .object({
    kind: z.literal("semantic"),
    role: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(240),
    exact: z.boolean(),
  })
  .strict();

/**
 * 混合浏览器目标：语义定位之上叠加屏幕坐标边框（grounding），
 * 便于视觉模型在坐标与语义元素之间对齐。
 */
const hybridBrowserTargetSchema = z
  .object({
    kind: z.literal("hybrid"),
    role: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(240),
    exact: z.boolean(),
    grounding: z
      .object({
        x: z.number().nonnegative(),
        y: z.number().nonnegative(),
        width: z.number().positive(),
        height: z.number().positive(),
      })
      .strict(),
  })
  .strict();

/**
 * 浏览器观测引用：指回一次已产生的观测 —— 观测 ID、当前 URL、视口、
 * 页面状态哈希与截图哈希，用于在动作前后建立可校验的对照。
 */
export const browserObservationReferenceSchema = z
  .object({
    observationId: z.string().uuid(),
    url: z.string().url().max(2_048),
    viewport: viewportSchema,
    pageStateHash: sha256Schema,
    screenshotHash: sha256Schema,
  })
  .strict();

/**
 * 坐标浏览器目标：直接以视口内像素坐标定位，必须落于给定视口范围内。
 */
const coordinateBrowserTargetSchema = z
  .object({
    kind: z.literal("coordinate"),
    x: z.number().nonnegative(),
    y: z.number().nonnegative(),
    observationId: z.string().uuid(),
    screenshotHash: sha256Schema,
    pageStateHash: sha256Schema,
    viewport: viewportSchema,
  })
  .strict()
  .refine(
    (target) => target.x < target.viewport.width && target.y < target.viewport.height,
    "Coordinate targets must remain inside their bound viewport.",
  );

/**
 * 浏览器目标联合：语义 / 混合 / 坐标三种定位方式按 kind 判别。
 */
export const browserTargetSchema = z.discriminatedUnion("kind", [
  semanticBrowserTargetSchema,
  hybridBrowserTargetSchema,
  coordinateBrowserTargetSchema,
]);

/**
 * 浏览器采集目标：仅语义 / 混合（不含坐标），用于建立基线的观测采集。
 */
export const browserCaptureTargetSchema = z.discriminatedUnion("kind", [
  semanticBrowserTargetSchema,
  hybridBrowserTargetSchema,
]);

/**
 * 前端修复规范：归一化后的可判定修复意图，在源码变更前提交。
 *
 * 保留原始 prompt，同时把用户可见的修复意图表达为一组可判定的谓词：
 *  - 目标：语义浏览器目标（ARIA 角色 + 可访问名），不含坐标；
 *  - 关系谓词：如 after.borderRadius > before.borderRadius（材质级增大，
 *    即增量与终值都达到阈值）；
 *  - 不变式谓词：保留标签文本、保持可点击、控件尺寸与声明布局不变量。
 *
 * 规范不要求用户给出具体 CSS 值；编码运行时选择合理实现值，浏览器运行时
 * 用前后渲染观测校验归一化关系。
 */
export const frontendRepairPredicateSchema = z.discriminatedUnion("kind", [
  // 关系谓词：同一渲染指标在 before→after 之间发生材质级增大
  z
    .object({
      kind: z.literal("metric-increase"),
      metric: z.enum(["borderRadius"]),
      // 前后增量阈值（px）：after - before 必须达到该值
      minDeltaPx: z.number().positive(),
      // 修复后终值阈值（px）：after 必须至少达到该值
      minAfterPx: z.number().positive(),
    })
    .strict(),
  // 关系谓词：缺失的阴影恢复为可见的计算样式
  z.object({ kind: z.literal("shadow-present") }).strict(),
  // 交互谓词：具名 Dialog 打开、接管焦点、Escape 关闭并归还焦点
  z
    .object({
      kind: z.literal("dialog-behavior"),
      dialogName: z.string().trim().min(1).max(200),
    })
    .strict(),
  // 关系谓词：局部目标区域的 before/after 渲染必须实际发生改变
  z.object({ kind: z.literal("region-clip-differs") }).strict(),
  // 不变式：目标标签文本保持不变
  z.object({ kind: z.literal("label-preserved") }).strict(),
  // 不变式：目标保持可点击（可见、可用、可命中）
  z.object({ kind: z.literal("clickable") }).strict(),
  // 不变式：控件尺寸保持在声明容差内
  z
    .object({
      kind: z.literal("size-within"),
      tolerancePx: z.number().nonnegative(),
    })
    .strict(),
  // 不变式：声明布局位置保持在容差内
  z
    .object({
      kind: z.literal("layout-within"),
      tolerancePx: z.number().nonnegative(),
    })
    .strict(),
  // 不变式：目标父级与相邻元素的几何保持在声明容差内
  z
    .object({
      kind: z.literal("surroundings-within"),
      tolerancePx: z.number().nonnegative(),
    })
    .strict(),
]);

export const frontendRepairSpecSchema = z
  .object({
    schemaVersion: z.literal(FRONTEND_REPAIR_SPEC_SCHEMA_VERSION, {
      error: "This frontend repair spec schema version is not supported.",
    }),
    prompt: z
      .string()
      .trim()
      .min(1)
      .max(2000, "Keep the repair spec under 2,000 characters."),
    target: semanticBrowserTargetSchema,
    predicates: z.array(frontendRepairPredicateSchema).min(1).max(16),
  })
  .strict();

/** 已提交的归一化规范及其内容寻址引用。 */
export const frontendRepairSpecRecordSchema = z
  .object({
    spec: frontendRepairSpecSchema,
    artifact: artifactRefSchema,
  })
  .strict()
  .superRefine((record, context) => {
    if (record.artifact.mediaType !== FRONTEND_REPAIR_SPEC_MEDIA_TYPE) {
      context.addIssue({
        code: "custom",
        path: ["artifact", "mediaType"],
        message: "The repair spec must cite its committed repair-spec artifact.",
      });
    }
  });

/**
 * 浏览器基线请求：请求为某 Run 在指定路由上对某个目标建立可复现基线。
 */
export const browserBaselineRequestSchema = z
  .object({
    schemaVersion: z.literal(BROWSER_BASELINE_REQUEST_SCHEMA_VERSION),
    requestId: z.string().uuid(),
    runId: runIdSchema,
    route: browserRouteSchema,
    target: browserCaptureTargetSchema,
  })
  .strict();

/**
 * 浏览器基线记录：一次完整基线观测的不可变结果。
 *
 * 记录构建身份、浏览器版本、视口、目标及其身份指纹，并把观测得到的
 * 截图 / DOM / 无障碍树 / 计算样式 / 控制台 / 网络 / trace 作为内容寻址
 * 产物落盘；superRefine 强制观测引用的截图哈希与提交产物哈希一致。
 */
export const browserBaselineRecordSchema = z
  .object({
    schemaVersion: z.literal(BROWSER_BASELINE_SCHEMA_VERSION),
    baselineId: z.string().uuid(),
    runId: runIdSchema,
    buildIdentity: z.string().trim().min(1).max(200),
    route: browserRouteSchema,
    browserVersion: z.string().trim().min(1).max(200),
    viewport: viewportSchema,
    devicePixelRatio: z.number().positive().max(8),
    target: browserTargetSchema,
    targetIdentity: z.string().trim().min(1).max(500),
    observation: browserObservationReferenceSchema,
    screenshot: artifactRefSchema,
    dom: artifactRefSchema,
    accessibility: artifactRefSchema,
    computed: artifactRefSchema,
    console: artifactRefSchema,
    network: artifactRefSchema,
    trace: artifactRefSchema,
    capturedAt: isoDateTimeSchema,
    supplementalVisualJudgment: z.string().trim().min(1).max(2_000).nullable(),
  })
  .strict()
  .superRefine((baseline, context) => {
    // 观测引用的截图摘要必须与已提交的截图产物一致，防止观测/产物错位
    if (baseline.observation.screenshotHash !== baseline.screenshot.hash) {
      context.addIssue({
        code: "custom",
        path: ["observation", "screenshotHash"],
        message: "The observation must reference the committed screenshot artifact.",
      });
    }
  });

/**
 * 浏览器基线响应：包裹一条基线记录。
 */
export const browserBaselineResponseSchema = z
  .object({
    schemaVersion: z.literal(BROWSER_BASELINE_RESPONSE_SCHEMA_VERSION),
    baseline: browserBaselineRecordSchema,
  })
  .strict();

/**
 * 浏览器动作提议：模型或自动化逻辑提议对某目标执行一次点击。
 *
 * origin 标明提议来源（browser-model / automation）。
 */
export const browserKeySchema = z.enum(["Tab", "Enter", "Escape"]);

const browserActionProposalBase = {
  schemaVersion: z.literal(BROWSER_ACTION_PROPOSAL_SCHEMA_VERSION),
  proposalId: z.string().uuid(),
  runId: runIdSchema,
  origin: z.enum(["browser-model", "automation"]),
};

export const browserActionProposalSchema = z.union([
  z
    .object({
      ...browserActionProposalBase,
      action: z.object({ kind: z.literal("click") }).strict(),
      target: browserTargetSchema,
    })
    .strict(),
  z
    .object({
      ...browserActionProposalBase,
      action: z.object({ kind: z.literal("press"), key: browserKeySchema }).strict(),
    })
    .strict(),
]);

/**
 * 浏览器动作记录：一次动作提议的完整生命周期 —— 策略裁决 + 执行结果 + 前后观测。
 */
export const browserActionRecordSchema = z
  .object({
    schemaVersion: z.literal(BROWSER_ACTION_RECORD_SCHEMA_VERSION),
    proposal: browserActionProposalSchema,
    policy: z
      .object({
        decision: z.enum(["allowed", "denied", "stale"]),
        reason: z.string().trim().min(1).max(500),
      })
      .strict(),
    execution: z
      .object({
        status: z.enum(["executed", "denied", "stale", "failed"]),
        message: z.string().trim().min(1).max(500),
      })
      .strict(),
    before: browserObservationReferenceSchema,
    after: browserObservationReferenceSchema.nullable(),
    recordedAt: isoDateTimeSchema,
  })
  .strict();

/**
 * 浏览器验证断言：一次意图链定的可判定断言或补充性视觉判断。
 *
 * intentLinked 表示断言直接绑定到本次修复意图；kind 区分确定性
 * （deterministic，由可重复的渲染/交互谓词判定）与补充性
 * （supplemental，如浏览器模型的定性视觉判断）。
 */
export const browserVerificationAssertionSchema = z
  .object({
    assertion: z.string().trim().min(1).max(500),
    intentLinked: z.boolean(),
    kind: z.enum(["deterministic", "supplemental"]),
    status: z.enum(["passed", "failed", "inconclusive"]),
    evidenceRefs: z.array(artifactRefSchema).max(12),
  })
  .strict();

/**
 * 浏览器验证报告：browser.verify 节点的判定结论。
 *
 * verdict 只能是 passed / failed / inconclusive。superRefine 强制一条
 * 不变量：verdict 为 passed 时，必须至少有一条意图链定的确定性断言
 * 通过 —— 浏览器模型的定性视觉判断（kind=supplemental）单独不能构成
 * 通过证据。
 */
export const browserVerificationReportSchema = z
  .object({
    schemaVersion: z.literal(BROWSER_VERIFICATION_REPORT_SCHEMA_VERSION),
    reportId: z.string().uuid(),
    runId: runIdSchema,
    nodeId: z.string().regex(/^node-[a-z0-9-]{1,120}$/),
    attempt: z.number().int().positive(),
    intent: z.string().trim().min(1).max(500),
    verdict: z.enum(["passed", "failed", "inconclusive"]),
    assertions: z.array(browserVerificationAssertionSchema).min(1).max(24),
    evidenceRefs: z.array(artifactRefSchema).max(24),
    limitations: z.array(z.string().trim().min(1).max(500)).max(12),
    redactions: z.array(z.string().trim().min(1).max(500)).max(24),
    recordedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((report, context) => {
    if (
      report.verdict === "passed" &&
      !report.assertions.some(
        (assertion) =>
          assertion.intentLinked &&
          assertion.kind === "deterministic" &&
          assertion.status === "passed",
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["verdict"],
        message:
          "A passing BrowserVerificationReport requires an intent-linked deterministic predicate.",
      });
    }
  });

/** Browser Runtime 的资源预算：动作、时间与费用上限。 */
export const browserRuntimeBudgetSchema = z
  .object({
    maxActions: z.number().int().min(1).max(64),
    maxDurationMs: z.number().int().min(50).max(3_600_000),
    maxCostUsd: z.number().finite().nonnegative().max(1_000),
  })
  .strict();

/**
 * 交给同进程浏览器模型会话的完整、版本化浏览器任务边界。
 *
 * authority 携带本地路由、采集目标、验证意图与动作上限；browser.verify
 * 必须携带 intent（供确定性谓词与模型判断绑定），browser.observe
 * 可以没有。所有输入仍须通过 ActionBroker 提案，运行时不能自行放权。
 */
export const browserRuntimeTaskEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(BROWSER_RUNTIME_TASK_ENVELOPE_SCHEMA_VERSION),
    runId: runIdSchema,
    dagRevision: z.number().int().positive(),
    nodeId: z.string().regex(/^node-[a-z0-9-]{1,120}$/),
    nodeType: z.enum(["browser.observe", "browser.verify"]),
    attempt: z.number().int().positive(),
    maxAttempts: z.number().int().min(1).max(3),
    runtime: z.literal("browser"),
    prompt: z.string().min(1).max(2_000),
    inputArtifacts: z.array(artifactRefSchema).max(24),
    authority: z
      .object({
        route: browserRouteSchema,
        target: browserCaptureTargetSchema,
        intent: z.string().trim().min(1).max(500).nullable(),
        maxActions: z.number().int().min(1).max(64),
      })
      .strict(),
    budget: browserRuntimeBudgetSchema,
    deadline: isoDateTimeSchema,
    cancellationId: z.string().min(1).max(200),
    correlationId: z.string().min(1).max(200),
    causationEventId: z.string().uuid().nullable(),
    idempotencyKey: z.string().min(1).max(300),
  })
  .strict()
  .superRefine((envelope, context) => {
    if (envelope.nodeType === "browser.verify" && !envelope.authority.intent) {
      context.addIssue({
        code: "custom",
        path: ["authority", "intent"],
        message: "Browser verify nodes require an intent-linked verification intent.",
      });
    }
    if (envelope.attempt > envelope.maxAttempts) {
      context.addIssue({
        code: "custom",
        path: ["attempt"],
        message: "The runtime attempt cannot exceed the DAG node retry bound.",
      });
    }
  });

// ---------------------------------------------------------------------------
// Run DAG 编排结构：路由分类、节点注册表、修订、进度与副作用租约
// ---------------------------------------------------------------------------
export const RUN_DAG_REVISION_SCHEMA_VERSION = "prism.run-dag-revision/v1" as const;
export const ROUTER_DECISION_SCHEMA_VERSION = "prism.router-decision/v1" as const;
export const RUN_NODE_PROGRESS_SCHEMA_VERSION = "prism.run-node-progress/v1" as const;
export const EFFECT_LEASE_SCHEMA_VERSION = "prism.effect-lease/v1" as const;
export const RUNTIME_TASK_ENVELOPE_SCHEMA_VERSION =
  "prism.runtime-task-envelope/v1" as const;
export const PI_RUNTIME_RESULT_SCHEMA_VERSION = "prism.pi-runtime-result/v1" as const;

/**
 * 运行体归属：节点由哪类运行时执行 —— 编码（coding）/ 浏览器（browser）/ 编排器（orchestrator）。
 */
export const runtimeOwnerSchema = z.enum(["coding", "browser", "orchestrator"]);

/**
 * 副作用类别：区分只读操作与真正改变系统的效果，用于并发/租约控制。
 */
export const effectClassSchema = z.enum([
  "read_only",
  "source_effect",
  "browser_effect",
  "none",
]);

/**
 * Run DAG 节点类型：工作区检查 / 浏览器观测 / 工作区补丁 / 浏览器验证 /
 * 任务完成 / 路由重分类。
 */
export const runDagNodeTypeSchema = z.enum([
  "workspace.inspect",
  "browser.observe",
  "workspace.patch",
  "browser.verify",
  "task.complete",
  "route.reclassify",
]);

/**
 * 路由分类结果：任务被判定为纯编码（coding）/ 纯浏览器（browser）/
 * 混合（hybrid）或暂不确定（uncertain）。
 */
export const routerClassificationSchema = z.enum([
  "coding",
  "browser",
  "hybrid",
  "uncertain",
]);

/**
 * DAG 节点运行状态。
 */
export const runNodeStateSchema = z.enum([
  "ready",
  "running",
  "succeeded",
  "failed",
  "blocked",
  "retrying",
]);

/**
 * 节点结果请求：运行时回报节点执行完毕后希望编排器做的后续动作。
 */
export const nodeOutcomeRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z
    .object({
      kind: z.literal("successor"),
      nodeType: runDagNodeTypeSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("evidence"),
      nodeType: z.enum(["workspace.inspect", "browser.observe"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("retry"),
      reason: z.string().trim().min(1).max(500),
    })
    .strict(),
  z
    .object({
      kind: z.literal("reclassify"),
      classification: z.enum(["coding", "browser", "hybrid"]),
    })
    .strict(),
]);

/**
 * Run DAG 节点注册表：按节点类型声明归属运行时、副作用类别与合法后继。
 *
 * 这是 DAG 合法性的权威来源：
 *  - workspace.inspect / browser.observe 是只读的，可互相衔接；
 *  - workspace.patch 是源码副作用，只能以 browser.verify 收尾；
 *  - browser.verify 是浏览器副作用，可重试、可完成任务或回退补丁；
 *  - task.complete 是终点，无后继；
 *  - route.reclassify 只读，仅能调度新一轮只读检查。
 */
export const runDagNodeRegistry = {
  "workspace.inspect": {
    runtime: "coding",
    effectClass: "read_only",
    legalSuccessors: ["workspace.inspect", "workspace.patch", "browser.observe"],
  },
  "browser.observe": {
    runtime: "browser",
    effectClass: "read_only",
    legalSuccessors: ["browser.observe", "workspace.patch", "workspace.inspect"],
  },
  "workspace.patch": {
    runtime: "coding",
    effectClass: "source_effect",
    legalSuccessors: ["workspace.patch", "browser.verify"],
  },
  "browser.verify": {
    runtime: "browser",
    effectClass: "browser_effect",
    legalSuccessors: ["browser.verify", "task.complete", "workspace.patch"],
  },
  "task.complete": {
    runtime: "orchestrator",
    effectClass: "none",
    legalSuccessors: [],
  },
  "route.reclassify": {
    runtime: "orchestrator",
    effectClass: "read_only",
    legalSuccessors: ["workspace.inspect", "browser.observe"],
  },
} as const;

/**
 * DAG 节点声明：校验节点必须使用注册表中匹配的运行时与副作用类别。
 */
export const runDagNodeSchema = z
  .object({
    nodeId: z.string().regex(/^node-[a-z0-9-]{1,120}$/),
    nodeType: runDagNodeTypeSchema,
    runtime: runtimeOwnerSchema,
    effectClass: effectClassSchema,
    predecessorIds: z.array(z.string().regex(/^node-[a-z0-9-]{1,120}$/)).max(24),
    maxAttempts: z.number().int().min(1).max(3),
  })
  .strict()
  .superRefine((node, context) => {
    const expected = runDagNodeRegistry[node.nodeType];
    // 节点声明的运行时/副作用类别必须与注册表一致，否则图不合法
    if (
      node.runtime !== expected.runtime ||
      node.effectClass !== expected.effectClass
    ) {
      context.addIssue({
        code: "custom",
        message: "Run DAG nodes must use the registered runtime and effect class.",
      });
    }
  });

/**
 * 环检测：DFS 三色标记法判断 DAG 是否含环（含环的图不可编排）。
 */
function hasDagCycle(nodes: readonly RunDagNode[]): boolean {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    const node = byId.get(nodeId);
    if (!node) return false;
    visiting.add(nodeId);
    const cycle = node.predecessorIds.some(visit);
    visiting.delete(nodeId);
    visited.add(nodeId);
    return cycle;
  };

  return nodes.some((node) => visit(node.nodeId));
}

/**
 * Run DAG 修订：一次编排计划的全量快照。
 *
 * 校验不变量：节点 ID 唯一、边必须是注册表中的合法后继、uncertain 路由
 * 只能先调度只读证据、整图无环。
 */
export const runDagRevisionSchema = z
  .object({
    schemaVersion: z.literal(RUN_DAG_REVISION_SCHEMA_VERSION),
    revision: z.number().int().positive(),
    classification: routerClassificationSchema,
    createdAt: isoDateTimeSchema,
    nodes: z.array(runDagNodeSchema).min(1).max(64),
  })
  .strict()
  .superRefine((revision, context) => {
    const nodeIds = new Set<string>();
    const byId = new Map(revision.nodes.map((node) => [node.nodeId, node]));

    revision.nodes.forEach((node, index) => {
      // 节点 ID 必须唯一
      if (nodeIds.has(node.nodeId)) {
        context.addIssue({
          code: "custom",
          path: ["nodes", index, "nodeId"],
          message: "Run DAG node IDs must be unique.",
        });
      }
      nodeIds.add(node.nodeId);

      // 每条前驱边都必须属于注册表中声明的合法后继关系
      node.predecessorIds.forEach((predecessorId) => {
        const predecessor = byId.get(predecessorId);
        const allowed = predecessor
          ? (runDagNodeRegistry[predecessor.nodeType]
              .legalSuccessors as readonly string[])
          : [];
        if (!predecessor || !allowed.includes(node.nodeType)) {
          context.addIssue({
            code: "custom",
            path: ["nodes", index, "predecessorIds"],
            message: "Run DAG edges must be registered legal successors.",
          });
        }
      });

      // uncertain 路由在重分类前只允许只读证据节点
      if (
        revision.classification === "uncertain" &&
        node.effectClass !== "read_only" &&
        node.effectClass !== "none"
      ) {
        context.addIssue({
          code: "custom",
          path: ["nodes", index, "effectClass"],
          message:
            "Uncertain routes may only schedule read-only evidence before reclassification.",
        });
      }
    });

    // 整图不允许存在环
    if (hasDagCycle(revision.nodes)) {
      context.addIssue({
        code: "custom",
        path: ["nodes"],
        message: "Run DAG revisions cannot contain graph cycles.",
      });
    }
  });

/**
 * 路由器决策：编排开始时由 Router 判定任务分类并给出首个 DAG 修订。
 *
 * 校验决策分类与初始修订一致，且初始修订必须是 revision 1。
 */
export const routerDecisionSchema = z
  .object({
    schemaVersion: z.literal(ROUTER_DECISION_SCHEMA_VERSION),
    classification: routerClassificationSchema,
    confidence: z.number().min(0).max(1),
    requiredCapabilities: z
      .array(
        z.enum(["workspace_read", "browser_read", "source_effect", "browser_effect"]),
      )
      .min(1)
      .max(4),
    initialRevision: runDagRevisionSchema,
  })
  .strict()
  .superRefine((decision, context) => {
    if (decision.initialRevision.revision !== 1) {
      context.addIssue({
        code: "custom",
        path: ["initialRevision", "revision"],
        message: "Router decisions must begin at DAG revision 1.",
      });
    }
    if (decision.initialRevision.classification !== decision.classification) {
      context.addIssue({
        code: "custom",
        path: ["initialRevision", "classification"],
        message: "The initial DAG revision must match the Router classification.",
      });
    }
  });

/**
 * 节点结果：运行时回报单个节点执行完毕的结论（含证据与后续请求）。
 */
export const nodeOutcomeSchema = z
  .object({
    nodeId: z.string().regex(/^node-[a-z0-9-]{1,120}$/),
    attempt: z.number().int().positive(),
    state: z.enum(["succeeded", "failed", "blocked"]),
    summary: z.string().trim().min(1).max(500),
    request: nodeOutcomeRequestSchema,
    failure: z
      .object({
        code: z.enum([
          "cancelled",
          "timed_out",
          "budget_exhausted",
          "malformed_sdk_output",
          "process_cleanup_failed",
          "workspace_execution_failed",
          "browser_execution_failed",
          "verification_failed",
          "approval_required",
        ]),
        retryable: z.boolean(),
      })
      .strict()
      .nullable(),
  })
  .strict();

/** 浏览器运行时的资源用量：模型、循环、动作提议/执行次数与费用。 */
export const browserResourceUsageSchema = z
  .object({
    model: z
      .object({
        provider: z.string().trim().min(1).max(120),
        id: z.string().trim().min(1).max(200),
      })
      .strict(),
    modelCalls: z.number().int().nonnegative(),
    loopCount: z.number().int().nonnegative(),
    actionsProposed: z.number().int().nonnegative(),
    actionsExecuted: z.number().int().nonnegative(),
    costUsd: z.number().finite().nonnegative(),
    durationMs: z.number().nonnegative(),
  })
  .strict();

/**
 * Browser Runtime 的唯一返回形态：已校验的节点结果、已提交的产物
 * 引用、浏览器动作记录、可选验证报告与资源用量。strict() 拒绝任何旁路数据。
 */
export const browserRuntimeResultSchema = z
  .object({
    schemaVersion: z.literal(BROWSER_RUNTIME_RESULT_SCHEMA_VERSION),
    outcome: nodeOutcomeSchema,
    artifacts: z.array(artifactRefSchema).max(24),
    browserActions: z.array(browserActionRecordSchema).max(24),
    verificationReport: browserVerificationReportSchema.nullable(),
    usage: browserResourceUsageSchema,
  })
  .strict();

/**
 * Pi 编码运行时的资源预算。所有模型、时间与费用上限都由 Orchestrator
 * 放入信封，运行时只能收窄或消耗，不能自行扩大。
 */
export const runtimeBudgetSchema = z
  .object({
    maxModelCalls: z.number().int().min(1).max(64),
    maxInputTokens: z.number().int().positive().max(2_000_000),
    maxOutputTokens: z.number().int().positive().max(500_000),
    maxTotalTokens: z.number().int().positive().max(2_500_000),
    maxCostUsd: z.number().finite().nonnegative().max(1_000),
    maxDurationMs: z.number().int().min(50).max(3_600_000),
  })
  .strict()
  .superRefine((budget, context) => {
    if (
      budget.maxTotalTokens < budget.maxInputTokens ||
      budget.maxTotalTokens < budget.maxOutputTokens
    ) {
      context.addIssue({
        code: "custom",
        path: ["maxTotalTokens"],
        message: "The total token budget must cover each directional token cap.",
      });
    }
  });

/** task.complete 的可重放终态证据。 */
export const runCompletionSchema = z
  .object({
    schemaVersion: z.literal(RUN_COMPLETION_SCHEMA_VERSION),
    terminalDagRevision: z.number().int().positive(),
    budgets: z
      .object({ code: runtimeBudgetSchema, browser: browserRuntimeBudgetSchema })
      .strict(),
    approvals: z.array(z.enum(["source_effect", "browser_effect"])).max(2),
    codeOracle: artifactRefSchema,
    browserVerificationReportId: z.string().uuid(),
    verificationRefs: z.array(artifactRefSchema).min(2).max(24),
    completedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((completion, context) => {
    if (completion.codeOracle.mediaType !== CODE_ORACLE_REPORT_MEDIA_TYPE) {
      context.addIssue({
        code: "custom",
        path: ["codeOracle", "mediaType"],
        message: "Completion requires a committed passing code-Oracle report.",
      });
    }
    if (
      !completion.verificationRefs.some(
        (artifact) => artifact.hash === completion.codeOracle.hash,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["verificationRefs"],
        message: "Completion verification references must include the code Oracle.",
      });
    }
  });

/**
 * 交给同进程 Pi SDK 会话的完整、版本化任务边界。
 *
 * v1 只允许 Coding Runtime 的两个已注册节点。具体路径、命令和补丁仍需
 * 通过 WorkspaceExecutor 二次校验；workspaceOperations 只决定本次会话
 * 暴露哪些能力，不能赋予执行器没有的权限。
 */
export const runtimeTaskEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(RUNTIME_TASK_ENVELOPE_SCHEMA_VERSION),
    runId: runIdSchema,
    dagRevision: z.number().int().positive(),
    nodeId: z.string().regex(/^node-[a-z0-9-]{1,120}$/),
    nodeType: z.enum(["workspace.inspect", "workspace.patch"]),
    attempt: z.number().int().positive(),
    maxAttempts: z.number().int().min(1).max(3),
    runtime: z.literal("coding"),
    prompt: z.string().min(1).max(2_000),
    inputArtifacts: z.array(artifactRefSchema).max(24),
    authority: z
      .object({
        workspaceOperations: z
          .array(z.enum(["inspect", "patch", "test"]))
          .min(1)
          .max(3),
      })
      .strict(),
    budget: runtimeBudgetSchema,
    deadline: isoDateTimeSchema,
    cancellationId: z.string().min(1).max(200),
    correlationId: z.string().min(1).max(200),
    causationEventId: z.string().uuid().nullable(),
    idempotencyKey: z.string().min(1).max(300),
  })
  .strict()
  .superRefine((envelope, context) => {
    const operations = new Set(envelope.authority.workspaceOperations);
    if (operations.size !== envelope.authority.workspaceOperations.length) {
      context.addIssue({
        code: "custom",
        path: ["authority", "workspaceOperations"],
        message: "Runtime authority operations must be unique.",
      });
    }
    if (envelope.nodeType === "workspace.inspect" && operations.size !== 1) {
      context.addIssue({
        code: "custom",
        path: ["authority", "workspaceOperations"],
        message: "Read-only inspection nodes may expose only inspect authority.",
      });
    }
    if (envelope.nodeType === "workspace.inspect" && !operations.has("inspect")) {
      context.addIssue({
        code: "custom",
        path: ["authority", "workspaceOperations"],
        message: "Inspection nodes require inspect authority.",
      });
    }
    if (envelope.attempt > envelope.maxAttempts) {
      context.addIssue({
        code: "custom",
        path: ["attempt"],
        message: "The runtime attempt cannot exceed the DAG node retry bound.",
      });
    }
  });

/** Pi 会话实际消耗的模型、token、费用与墙钟资源。 */
export const runtimeResourceUsageSchema = z
  .object({
    model: z
      .object({
        provider: z.string().trim().min(1).max(120),
        id: z.string().trim().min(1).max(200),
      })
      .strict(),
    modelCalls: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative(),
    cacheWriteTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    costUsd: z.number().finite().nonnegative(),
    durationMs: z.number().nonnegative(),
  })
  .strict()
  .superRefine((usage, context) => {
    const total =
      usage.inputTokens +
      usage.outputTokens +
      usage.cacheReadTokens +
      usage.cacheWriteTokens;
    if (usage.totalTokens !== total) {
      context.addIssue({
        code: "custom",
        path: ["totalTokens"],
        message: "Runtime total tokens must equal the directional token totals.",
      });
    }
  });

/**
 * Pi Runtime 的唯一返回形态：已校验的节点结果、已提交的产物引用与资源用量。
 * strict() 明确拒绝原始模型文本、未提交 diff 或其他旁路数据。
 */
export const piRuntimeResultSchema = z
  .object({
    schemaVersion: z.literal(PI_RUNTIME_RESULT_SCHEMA_VERSION),
    outcome: nodeOutcomeSchema,
    artifacts: z.array(artifactRefSchema).max(24),
    usage: runtimeResourceUsageSchema,
  })
  .strict();

/**
 * DAG 节点进度：编排器将节点状态变更写入事件日志的持久化快照。
 */
export const runNodeProgressSchema = z
  .object({
    schemaVersion: z.literal(RUN_NODE_PROGRESS_SCHEMA_VERSION),
    revision: z.number().int().positive(),
    nodeId: z.string().regex(/^node-[a-z0-9-]{1,120}$/),
    nodeType: runDagNodeTypeSchema,
    attempt: z.number().int().positive(),
    runtime: runtimeOwnerSchema,
    effectClass: effectClassSchema,
    state: runNodeStateSchema,
    summary: z.string().trim().min(1).max(500),
    artifacts: z.array(artifactRefSchema).max(12),
    journalPosition: z.number().int().positive(),
    correlationId: z.string().min(1).max(200),
    causationEventId: z.string().uuid().nullable(),
    recordedAt: isoDateTimeSchema,
  })
  .strict();

/**
 * 相对工作区路径：必须归一化（"/" 分隔），禁止绝对路径、反斜杠、"."/".." 越界。
 */
const relativeWorkspacePathSchema = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (value) =>
      value === "." ||
      (!value.startsWith("/") &&
        !value.startsWith("\\") &&
        !/^[a-z]:/i.test(value) &&
        !value.includes("\\") &&
        value
          .split("/")
          .every((segment) => segment !== "" && segment !== "." && segment !== "..")),
    "Workspace paths must be normalized relative paths without traversal.",
  );

/**
 * 副作用租约：同一时刻只允许一个节点持有 source/browser 副作用权。
 *
 * 通过单调递增的 token 串行化副作用节点，避免并发补丁/浏览器操作互相踩踏。
 */
export const effectLeaseSchema = z
  .object({
    schemaVersion: z.literal(EFFECT_LEASE_SCHEMA_VERSION),
    token: z.number().int().positive(),
    holderNodeId: z.string().regex(/^node-[a-z0-9-]{1,120}$/),
    effectClass: z.enum(["source_effect", "browser_effect"]),
    state: z.enum(["active", "released"]),
    recordedAt: isoDateTimeSchema,
  })
  .strict();

/** 用户可审阅的副作用目标；工作区目标只暴露显示名与受限路径。 */
export const effectTargetSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("workspace"),
      displayName: z.string().trim().min(1).max(200),
      paths: z.array(relativeWorkspacePathSchema).min(1).max(64),
    })
    .strict(),
  z
    .object({
      kind: z.literal("browser"),
      route: browserRouteSchema,
      target: browserCaptureTargetSchema,
    })
    .strict(),
]);

/**
 * 一次待审批副作用。proposalDigest 绑定全部展示字段和执行前置条件；
 * parameters 只能包含已经脱敏、可安全展示的字符串。
 */
export const effectApprovalProposalSchema = z
  .object({
    schemaVersion: z.literal(EFFECT_CONTROL_SCHEMA_VERSION),
    kind: z.literal("proposal"),
    controlId: z.string().uuid(),
    proposalId: z.string().uuid(),
    proposalDigest: sha256Schema,
    runId: runIdSchema,
    nodeId: z.string().regex(/^node-[a-z0-9-]{1,120}$/),
    origin: z.enum(["pi", "browser-model", "automation"]),
    target: effectTargetSchema,
    effectClass: z.enum(["source_effect", "browser_effect"]),
    parameters: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(120),
            redactedValue: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .max(24),
    preconditions: z
      .object({
        observationArtifact: artifactRefSchema,
        observationDigest: sha256Schema,
        fencingToken: z.number().int().positive(),
        expiresAt: isoDateTimeSchema,
      })
      .strict(),
    reason: z.string().trim().min(1).max(500),
    recordedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((proposal, context) => {
    if (
      Date.parse(proposal.preconditions.expiresAt) <= Date.parse(proposal.recordedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["preconditions", "expiresAt"],
        message: "Effect approval must expire after it is proposed.",
      });
    }
  });

/** 人或策略对某一原始 proposal digest 的一次、不可覆盖的裁决。 */
export const effectApprovalDecisionSchema = z
  .object({
    schemaVersion: z.literal(EFFECT_CONTROL_SCHEMA_VERSION),
    kind: z.literal("decision"),
    controlId: z.string().uuid(),
    proposalId: z.string().uuid(),
    proposalDigest: sha256Schema,
    decision: z.enum(["approved", "declined", "cancelled", "invalidated"]),
    observationDigest: sha256Schema,
    fencingToken: z.number().int().positive(),
    reason: z.string().trim().min(1).max(500),
    recordedAt: isoDateTimeSchema,
  })
  .strict();

/** 调度器在真实副作用入口消费一次已批准 authority。 */
export const effectApprovalConsumptionSchema = z
  .object({
    schemaVersion: z.literal(EFFECT_CONTROL_SCHEMA_VERSION),
    kind: z.literal("consumption"),
    controlId: z.string().uuid(),
    proposalId: z.string().uuid(),
    proposalDigest: sha256Schema,
    nodeId: z.string().regex(/^node-[a-z0-9-]{1,120}$/),
    fencingToken: z.number().int().positive(),
    recordedAt: isoDateTimeSchema,
  })
  .strict();

/** 进程中断后的现实核对结果；检测到效果时只允许转人工。 */
export const effectReconciliationSchema = z
  .object({
    schemaVersion: z.literal(EFFECT_CONTROL_SCHEMA_VERSION),
    kind: z.literal("reconciliation"),
    controlId: z.string().uuid(),
    proposalId: z.string().uuid().nullable(),
    nodeId: z.string().regex(/^node-[a-z0-9-]{1,120}$/),
    effectClass: z.enum(["source_effect", "browser_effect"]),
    outcome: z.enum(["no_effect", "effect_detected", "unknown"]),
    action: z.enum(["repropose", "retry", "human_review"]),
    evidenceRefs: z.array(artifactRefSchema).min(1).max(12),
    reason: z.string().trim().min(1).max(500),
    recordedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((record, context) => {
    if (record.outcome !== "no_effect" && record.action !== "human_review") {
      context.addIssue({
        code: "custom",
        path: ["action"],
        message: "Detected or unknown effects must stop for human review.",
      });
    }
  });

export const effectControlRecordSchema = z.discriminatedUnion("kind", [
  effectApprovalProposalSchema,
  effectApprovalDecisionSchema,
  effectApprovalConsumptionSchema,
  effectReconciliationSchema,
]);

/** HTTP 边界只接受 proposal 身份、摘要与三个明确的人类动作。 */
export const effectDecisionRequestSchema = z
  .object({
    schemaVersion: z.literal(EFFECT_DECISION_REQUEST_SCHEMA_VERSION),
    proposalId: z.string().uuid(),
    proposalDigest: sha256Schema,
    decision: z.enum(["approved", "declined", "cancelled"]),
  })
  .strict();

/**
 * 工作区 glob 模式：必须相对工作区，禁止绝对路径、反斜杠与 ".." 越级。
 */
const workspaceGlobSchema = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.startsWith("\\") &&
      !/^[a-z]:/i.test(value) &&
      !value.includes("\\") &&
      !value.split("/").includes(".."),
    "Workspace globs must stay relative to the workspace.",
  );

/**
 * 工作区命令：由可执行名与参数数组构成，用于运行允许列表内的测试命令。
 */
export const workspaceCommandSchema = z
  .object({
    executable: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[\w.+-]+$/),
    arguments: z
      .array(
        z
          .string()
          .max(500)
          .regex(/^[^\0\r\n]*$/),
      )
      .max(32),
  })
  .strict();

/**
 * 工作区请求公共信封：schema 版本 + 请求 ID + 所属 Run ID。
 */
const workspaceRequestEnvelopeShape = {
  schemaVersion: z.literal(WORKSPACE_REQUEST_SCHEMA_VERSION),
  requestId: z.string().uuid(),
  runId: runIdSchema,
};

/**
 * 工作区检查请求：只读列出/读取指定路径与 glob 匹配的文件内容。
 */
export const workspaceInspectRequestSchema = z
  .object({
    ...workspaceRequestEnvelopeShape,
    operation: z.literal("inspect"),
    paths: z.array(relativeWorkspacePathSchema).max(24),
    patterns: z.array(workspaceGlobSchema).max(24),
  })
  .strict();

/**
 * 工作区测试请求：在指定工作目录运行一条允许列表内的测试命令。
 */
export const workspaceTestRequestSchema = z
  .object({
    ...workspaceRequestEnvelopeShape,
    operation: z.literal("test"),
    command: workspaceCommandSchema,
    workingDirectory: relativeWorkspacePathSchema,
    timeoutMs: z.number().int().min(50).max(120_000),
  })
  .strict();

/**
 * 工作区补丁请求：最多改一个文件，要求提供期望的原始 SHA-256（可空）。
 *
 * expectedSha256 用于哈希守卫：若磁盘内容与期望不符则拒绝应用，
 * 防止并发修改导致补丁失配。
 */
export const workspacePatchRequestSchema = z
  .object({
    ...workspaceRequestEnvelopeShape,
    operation: z.literal("patch"),
    files: z
      .array(
        z
          .object({
            path: relativeWorkspacePathSchema,
            expectedSha256: z
              .string()
              .regex(/^[0-9a-f]{64}$/)
              .nullable(),
            content: z.string().max(262_144),
          })
          .strict(),
      )
      .min(1)
      .max(1),
  })
  .strict();

/**
 * 工作区请求联合：按 operation 判别 inspect / test / patch 三种操作。
 */
export const workspaceRequestSchema = z.discriminatedUnion("operation", [
  workspaceInspectRequestSchema,
  workspaceTestRequestSchema,
  workspacePatchRequestSchema,
]);

/**
 * 工作区读取证据：单次文件读取的产物（内容、截断标记与脱敏计数）。
 */
const workspaceReadEvidenceSchema = z
  .object({
    path: relativeWorkspacePathSchema,
    byteLength: z.number().int().nonnegative(),
    capturedSha256: z.string().regex(/^[0-9a-f]{64}$/),
    content: z.string(),
    truncated: z.boolean(),
    redactionCount: z.number().int().nonnegative(),
  })
  .strict();

/**
 * inspect 操作的结果详情：读取清单 + 发现路径集合。
 */
const workspaceInspectDetailsSchema = z
  .object({
    operation: z.literal("inspect"),
    reads: z.array(workspaceReadEvidenceSchema),
    discoveredPaths: z.array(relativeWorkspacePathSchema),
    discoveryTruncated: z.boolean(),
  })
  .strict();

/**
 * test 操作的结果详情：退出码、标准输出/错误与执行耗时。
 */
const workspaceTestDetailsSchema = z
  .object({
    operation: z.literal("test"),
    command: workspaceCommandSchema,
    workingDirectory: relativeWorkspacePathSchema,
    exitCode: z.number().int().nullable(),
    stdout: z.string(),
    stderr: z.string(),
    outputTruncated: z.boolean(),
    redactionCount: z.number().int().nonnegative(),
    durationMs: z.number().nonnegative(),
  })
  .strict();

/**
 * patch 操作的结果详情：每个文件的改动前后摘要。
 */
const workspacePatchDetailsSchema = z
  .object({
    operation: z.literal("patch"),
    files: z.array(
      z
        .object({
          path: relativeWorkspacePathSchema,
          beforeSha256: z
            .string()
            .regex(/^[0-9a-f]{64}$/)
            .nullable(),
          afterSha256: z.string().regex(/^[0-9a-f]{64}$/),
          byteLength: z.number().int().nonnegative(),
          diff: z.string().max(64_000),
          diffTruncated: z.boolean(),
          redactionCount: z.number().int().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict();

/**
 * 工作区证据：一次工作区操作的完整结果记录。
 *
 * status 区分成功 / 拒绝 / 失败 / 超时 / 取消；reasonCode 枚举具体拒绝
 * 原因（路径逃逸、未允许列表、补丁冲突、输出超限等）。
 */
export const workspaceEvidenceSchema = z
  .object({
    schemaVersion: z.literal(WORKSPACE_EVIDENCE_SCHEMA_VERSION),
    requestId: z.string().uuid(),
    runId: runIdSchema,
    operation: z.enum(["inspect", "test", "patch"]),
    status: z.enum(["succeeded", "denied", "failed", "timed_out", "cancelled"]),
    reasonCode: z
      .enum([
        "path_escape",
        "symlink_escape",
        "path_not_allowlisted",
        "pattern_not_allowlisted",
        "command_not_allowlisted",
        "working_directory_not_allowlisted",
        "patch_conflict",
        "output_limit",
        "process_cleanup_failed",
        "execution_failed",
      ])
      .nullable(),
    summary: z.string().min(1).max(500),
    startedAt: isoDateTimeSchema,
    finishedAt: isoDateTimeSchema,
    details: z.discriminatedUnion("operation", [
      workspaceInspectDetailsSchema,
      workspaceTestDetailsSchema,
      workspacePatchDetailsSchema,
    ]),
  })
  .strict();

/**
 * 工作区证据记录：证据本身 + 其内容寻址产物引用。
 */
export const workspaceEvidenceRecordSchema = z
  .object({
    evidence: workspaceEvidenceSchema,
    artifact: artifactRefSchema,
  })
  .strict();

/**
 * 工作区证据响应：包裹一条工作区证据记录。
 */
export const workspaceEvidenceResponseSchema = z
  .object({
    schemaVersion: z.literal(WORKSPACE_EVIDENCE_RESPONSE_SCHEMA_VERSION),
    record: workspaceEvidenceRecordSchema,
  })
  .strict();

/**
 * 终止性 Run 错误：存储层或事件日志损坏时记录的不可恢复错误。
 */
export const terminalRunErrorSchema = z
  .object({
    code: z.enum([
      "corrupt_event",
      "corrupt_artifact",
      "corrupt_manifest",
      "storage_error",
    ]),
    message: z.string().min(1).max(500),
  })
  .strict();

/**
 * Run 清单：Run 创建时的不可变声明，含原始修复请求与其产物引用。
 */
export const runManifestSchema = z
  .object({
    schemaVersion: z.literal(RUN_MANIFEST_SCHEMA_VERSION),
    runId: runIdSchema,
    createdAt: isoDateTimeSchema,
    request: repairRequestSchema,
    requestArtifact: artifactRefSchema,
  })
  .strict();

/**
 * 运行事件公共信封：所有事件共有的字段 —— ID、所属 Run、单调序号、
 * 关联/致因 ID（用于重建因果链与重放）。
 */
const runEventEnvelopeShape = {
  schemaVersion: z.literal(RUN_EVENT_SCHEMA_VERSION),
  eventId: z.string().uuid(),
  runId: runIdSchema,
  sequence: z.number().int().positive(),
  recordedAt: isoDateTimeSchema,
  correlationId: z.string().min(1).max(200),
  causationEventId: z.string().uuid().nullable(),
};

/**
 * Run 创建事件：事件日志首条，锚定请求产物。
 */
export const runCreatedEventSchema = z
  .object({
    ...runEventEnvelopeShape,
    type: z.literal("run.created"),
    payload: z.object({ requestArtifact: artifactRefSchema }).strict(),
  })
  .strict();

/**
 * Run 排队事件：Run 进入等待执行队列。
 */
export const runQueuedEventSchema = z
  .object({
    ...runEventEnvelopeShape,
    type: z.literal("run.queued"),
    payload: z.object({}).strict(),
  })
  .strict();

/** Run 在任何源码副作用前提交归一化修复规范。 */
export const runRepairSpecEventSchema = z
  .object({
    ...runEventEnvelopeShape,
    type: z.literal("run.repair-spec"),
    payload: frontendRepairSpecRecordSchema,
  })
  .strict();

/** 双 Oracle 通过后提交不可变完成记录。 */
export const runCompletedEventSchema = z
  .object({
    ...runEventEnvelopeShape,
    type: z.literal("run.completed"),
    payload: runCompletionSchema,
  })
  .strict();

/**
 * Run 终止错误事件：写入不可恢复的存储/日志错误。
 */
export const runTerminalErrorEventSchema = z
  .object({
    ...runEventEnvelopeShape,
    type: z.literal("run.terminal-error"),
    payload: terminalRunErrorSchema,
  })
  .strict();

/**
 * 工作区证据事件：落盘一条工作区证据记录。
 */
export const workspaceEvidenceEventSchema = z
  .object({
    ...runEventEnvelopeShape,
    type: z.literal("workspace.evidence"),
    payload: workspaceEvidenceRecordSchema,
  })
  .strict();

/**
 * 浏览器基线事件：落盘一条浏览器基线记录。
 */
export const browserBaselineEventSchema = z
  .object({
    ...runEventEnvelopeShape,
    type: z.literal("browser.baseline"),
    payload: browserBaselineRecordSchema,
  })
  .strict();

/**
 * 浏览器动作事件：落盘一条浏览器动作记录。
 */
export const browserActionEventSchema = z
  .object({
    ...runEventEnvelopeShape,
    type: z.literal("browser.action"),
    payload: browserActionRecordSchema,
  })
  .strict();

/**
 * 浏览器验证事件：落盘一条浏览器验证报告。
 */
export const browserVerificationEventSchema = z
  .object({
    ...runEventEnvelopeShape,
    type: z.literal("browser.verification"),
    payload: browserVerificationReportSchema,
  })
  .strict();

/**
 * DAG 修订事件：编排器扩展/变更 DAG 时落盘新修订。
 */
export const runDagRevisionEventSchema = z
  .object({
    ...runEventEnvelopeShape,
    type: z.literal("run.dag-revision"),
    payload: runDagRevisionSchema,
  })
  .strict();

/**
 * DAG 节点进度事件：落盘某个节点的一次进度变更。
 */
export const runNodeProgressEventSchema = z
  .object({
    ...runEventEnvelopeShape,
    type: z.literal("run.node-progress"),
    payload: runNodeProgressSchema,
  })
  .strict();

/**
 * 副作用租约事件：落盘副作用租约的获取/释放。
 */
export const effectLeaseEventSchema = z
  .object({
    ...runEventEnvelopeShape,
    type: z.literal("run.effect-lease"),
    payload: effectLeaseSchema,
  })
  .strict();

/** 审批、authority 消费与中断后核对共用一类追加式事件。 */
export const effectControlEventSchema = z
  .object({
    ...runEventEnvelopeShape,
    type: z.literal("run.effect-control"),
    payload: effectControlRecordSchema,
  })
  .strict();

/**
 * 运行事件联合：按 type 判别全部事件类型，构成追加式事件日志的基本单元。
 */
export const runEventSchema = z.discriminatedUnion("type", [
  runCreatedEventSchema,
  runQueuedEventSchema,
  runRepairSpecEventSchema,
  runCompletedEventSchema,
  runTerminalErrorEventSchema,
  workspaceEvidenceEventSchema,
  browserBaselineEventSchema,
  browserActionEventSchema,
  browserVerificationEventSchema,
  runDagRevisionEventSchema,
  runNodeProgressEventSchema,
  effectLeaseEventSchema,
  effectControlEventSchema,
]);

/**
 * Run 生命周期状态：已创建 / 排队中 / 终止错误。
 */
export const runStatusSchema = z.enum([
  "created",
  "queued",
  "awaiting_approval",
  "blocked",
  "cancelled",
  "completed",
  "terminal_error",
]);

/**
 * Run 快照：由事件日志重放聚合出的当前状态。
 *
 * 列表字段（证据、基线、动作、DAG 修订、节点进度）都是历史事件的累积结果，
 * 保证可从日志完全重建。
 */
export const runSnapshotSchema = z
  .object({
    schemaVersion: z.literal(RUN_SNAPSHOT_SCHEMA_VERSION),
    runId: runIdSchema,
    title: z.string().min(1).max(160),
    status: runStatusSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    lastSequence: z.number().int().nonnegative(),
    artifacts: z.array(artifactRefSchema),
    workspaceEvidence: z.array(workspaceEvidenceRecordSchema).default([]),
    browserBaselines: z.array(browserBaselineRecordSchema).default([]),
    browserActions: z.array(browserActionRecordSchema).default([]),
    browserVerificationReports: z.array(browserVerificationReportSchema).default([]),
    repairSpec: frontendRepairSpecRecordSchema.nullable().default(null),
    completion: runCompletionSchema.nullable().default(null),
    dagRevisions: z.array(runDagRevisionSchema).default([]),
    nodeProgress: z.array(runNodeProgressSchema).default([]),
    effectLease: effectLeaseSchema.nullable().default(null),
    effectControls: z.array(effectControlRecordSchema).default([]),
    terminalError: terminalRunErrorSchema.nullable(),
  })
  .strict();

/**
 * Run 创建响应：返回新 Run 的 ID 与初始快照。
 */
export const runCreationSchema = z
  .object({
    schemaVersion: z.literal(RUN_CREATION_SCHEMA_VERSION),
    status: z.literal("created"),
    runId: runIdSchema,
    snapshot: runSnapshotSchema,
  })
  .strict();

/**
 * Run 摘要：列表页使用的精简信息，含完整性标记（可安全打开）。
 */
export const runSummarySchema = z
  .object({
    id: runIdSchema,
    title: z.string().min(1).max(160),
    status: runStatusSchema,
    createdAt: isoDateTimeSchema.nullable(),
    updatedAt: isoDateTimeSchema.nullable(),
    lastSequence: z.number().int().nonnegative(),
    integrity: z.enum(["verified", "failed"]),
  })
  .strict();

/**
 * Run 卷宗（dossier）：详情页使用的完整只读视图。
 *
 * 在 runSummarySchema 基础上扩展原始请求、工作区、视口以及全部累积状态；
 * 若清单损坏则 prompt/workspace/viewport 可为空。
 */
export const runDossierSchema = runSummarySchema
  .extend({
    prompt: z.string().nullable(),
    workspace: localWorkspaceSchema.nullable(),
    viewport: viewportSchema.nullable(),
    artifacts: z.array(artifactRefSchema),
    workspaceEvidence: z.array(workspaceEvidenceRecordSchema).default([]),
    browserBaselines: z.array(browserBaselineRecordSchema).default([]),
    browserActions: z.array(browserActionRecordSchema).default([]),
    browserVerificationReports: z.array(browserVerificationReportSchema).default([]),
    repairSpec: frontendRepairSpecRecordSchema.nullable().default(null),
    completion: runCompletionSchema.nullable().default(null),
    dagRevisions: z.array(runDagRevisionSchema).default([]),
    nodeProgress: z.array(runNodeProgressSchema).default([]),
    effectLease: effectLeaseSchema.nullable().default(null),
    effectControls: z.array(effectControlRecordSchema).default([]),
    terminalError: terminalRunErrorSchema.nullable(),
  })
  .strict();

/**
 * Run 列表响应：一组 Run 摘要。
 */
export const runListSchema = z
  .object({
    schemaVersion: z.literal(RUN_LIST_SCHEMA_VERSION),
    runs: z.array(runSummarySchema),
  })
  .strict();

/**
 * Run 卷宗响应：包裹单份卷宗。
 */
export const runDossierResponseSchema = z
  .object({
    schemaVersion: z.literal(RUN_DOSSIER_RESPONSE_SCHEMA_VERSION),
    dossier: runDossierSchema,
  })
  .strict();

/**
 * 编排启动响应：异步启动编排，返回 Run ID。
 */
export const orchestrationStartResponseSchema = z
  .object({
    schemaVersion: z.literal(ORCHESTRATION_START_RESPONSE_SCHEMA_VERSION),
    status: z.literal("started"),
    runId: runIdSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// 类型导出：全部由上方 schema 推导，跨包使用时直接引用这些类型
// ---------------------------------------------------------------------------
export type OrchestrationStartResponse = z.infer<
  typeof orchestrationStartResponseSchema
>;

export type ArtifactRef = z.infer<typeof artifactRefSchema>;
export type EffectLease = z.infer<typeof effectLeaseSchema>;
export type EffectClass = z.infer<typeof effectClassSchema>;
export type EffectApprovalProposal = z.infer<typeof effectApprovalProposalSchema>;
export type EffectApprovalDecision = z.infer<typeof effectApprovalDecisionSchema>;
export type EffectApprovalConsumption = z.infer<typeof effectApprovalConsumptionSchema>;
export type EffectControlRecord = z.infer<typeof effectControlRecordSchema>;
export type EffectDecisionRequest = z.infer<typeof effectDecisionRequestSchema>;
export type EffectReconciliation = z.infer<typeof effectReconciliationSchema>;
export type NodeOutcome = z.infer<typeof nodeOutcomeSchema>;
export type PiRuntimeResult = z.infer<typeof piRuntimeResultSchema>;
export type RouterClassification = z.infer<typeof routerClassificationSchema>;
export type RouterDecision = z.infer<typeof routerDecisionSchema>;
export type RunDagNode = z.infer<typeof runDagNodeSchema>;
export type RunDagNodeType = z.infer<typeof runDagNodeTypeSchema>;
export type RunDagRevision = z.infer<typeof runDagRevisionSchema>;
export type RunNodeProgress = z.infer<typeof runNodeProgressSchema>;
export type RunNodeState = z.infer<typeof runNodeStateSchema>;
export type RuntimeOwner = z.infer<typeof runtimeOwnerSchema>;
export type RuntimeBudget = z.infer<typeof runtimeBudgetSchema>;
export type RuntimeResourceUsage = z.infer<typeof runtimeResourceUsageSchema>;
export type RuntimeTaskEnvelope = z.infer<typeof runtimeTaskEnvelopeSchema>;

export type BrowserActionProposal = z.infer<typeof browserActionProposalSchema>;
export type BrowserActionRecord = z.infer<typeof browserActionRecordSchema>;
export type BrowserBaselineRecord = z.infer<typeof browserBaselineRecordSchema>;
export type BrowserBaselineRequest = z.infer<typeof browserBaselineRequestSchema>;
export type BrowserBaselineResponse = z.infer<typeof browserBaselineResponseSchema>;
export type BrowserCaptureTarget = z.infer<typeof browserCaptureTargetSchema>;
export type BrowserObservationReference = z.infer<
  typeof browserObservationReferenceSchema
>;
export type BrowserRuntimeResult = z.infer<typeof browserRuntimeResultSchema>;
export type BrowserRuntimeTaskEnvelope = z.infer<
  typeof browserRuntimeTaskEnvelopeSchema
>;
export type BrowserRuntimeBudget = z.infer<typeof browserRuntimeBudgetSchema>;
export type BrowserResourceUsage = z.infer<typeof browserResourceUsageSchema>;
export type BrowserTarget = z.infer<typeof browserTargetSchema>;
export type BrowserVerificationAssertion = z.infer<
  typeof browserVerificationAssertionSchema
>;
export type BrowserVerificationReport = z.infer<typeof browserVerificationReportSchema>;
export type RunCreation = z.infer<typeof runCreationSchema>;
export type RunCompletion = z.infer<typeof runCompletionSchema>;
export type RunDossier = z.infer<typeof runDossierSchema>;
export type RunEvent = z.infer<typeof runEventSchema>;
export type RunList = z.infer<typeof runListSchema>;
export type RunManifest = z.infer<typeof runManifestSchema>;
export type RunSnapshot = z.infer<typeof runSnapshotSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export type RunSummary = z.infer<typeof runSummarySchema>;
export type TerminalRunError = z.infer<typeof terminalRunErrorSchema>;
export type WorkspaceCommand = z.infer<typeof workspaceCommandSchema>;
export type WorkspaceEvidence = z.infer<typeof workspaceEvidenceSchema>;
export type WorkspaceEvidenceRecord = z.infer<typeof workspaceEvidenceRecordSchema>;
export type WorkspaceEvidenceResponse = z.infer<typeof workspaceEvidenceResponseSchema>;
export type WorkspaceRequest = z.infer<typeof workspaceRequestSchema>;

export type ContractError = z.infer<typeof contractErrorSchema>;
export type LocalWorkspace = z.infer<typeof localWorkspaceSchema>;
export type RepairRequest = z.infer<typeof repairRequestSchema>;
export type RepairRequestValidation = z.infer<typeof repairRequestValidationSchema>;
export type ValidationIssue = z.infer<typeof validationIssueSchema>;
export type Viewport = z.infer<typeof viewportSchema>;
export type FrontendRepairPredicate = z.infer<typeof frontendRepairPredicateSchema>;
export type FrontendRepairSpec = z.infer<typeof frontendRepairSpecSchema>;
export type FrontendRepairSpecRecord = z.infer<typeof frontendRepairSpecRecordSchema>;
export type BrowserKey = z.infer<typeof browserKeySchema>;
export type SemanticBrowserTarget = z.infer<typeof semanticBrowserTargetSchema>;

/**
 * 将 Zod 校验错误转换为契约化的 ValidationIssue 列表。
 *
 * @param error Zod 校验产生的错误对象
 * @returns 每条 issue 扁平化为 { path, code, message }；路径以 "." 连接，
 *   根级错误路径记为 "<root>"
 */
export function formatContractIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path:
      issue.path.length > 0
        ? issue.path.map((segment) => String(segment)).join(".")
        : "<root>",
    code: issue.code,
    message: issue.message,
  }));
}
