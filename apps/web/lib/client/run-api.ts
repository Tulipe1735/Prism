/**
 * 浏览器端 Run API 客户端
 *
 * 封装对 Field Desk 后端 REST 端点的 fetch 调用，统一做三件事：
 *  1. 解析响应 JSON；
 *  2. 非 2xx 时把契约化错误（contractErrorSchema）转换为 RunApiError，
 *     携带校验问题明细（issues）；
 *  3. 成功响应用对应 schema 校验后再解包，避免后端契约漂移。
 *
 * 抛出的异常统一为 RunApiError，供 UI 层展示错误消息与字段问题。
 */
import {
  contractErrorSchema,
  type EffectDecisionRequest,
  type OrchestrationStartResponse,
  orchestrationStartResponseSchema,
  type RepairRequest,
  type RunCreation,
  runCreationSchema,
  type RunDossier,
  runDossierResponseSchema,
  runListSchema,
  type RunSummary,
  type ValidationIssue,
  type WorkspaceEvidenceRecord,
  workspaceEvidenceResponseSchema,
  type WorkspaceRequest,
} from "@prism/contracts";

/** Run API 调用失败异常；issues 承载字段级校验问题。 */
export class RunApiError extends Error {
  readonly issues: ValidationIssue[];

  constructor(message: string, issues: ValidationIssue[] = []) {
    super(message);
    this.name = "RunApiError";
    this.issues = issues;
  }
}

/** 读取响应体为 JSON；解析失败时抛出 RunApiError。 */
async function responseBody(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new RunApiError("Prism returned a response that was not valid JSON.");
  }
}

/**
 * 读取"可信"响应体：非 2xx 时解析契约化错误并抛出，
 * 成功时原样返回 JSON 体。
 */
async function trustedBody(response: Response) {
  const body = await responseBody(response);

  if (!response.ok) {
    const parsedError = contractErrorSchema.safeParse(body);
    if (!parsedError.success) {
      throw new RunApiError("Prism returned an invalid error contract.");
    }

    throw new RunApiError(parsedError.data.message, parsedError.data.issues);
  }

  return body;
}

/** 提交一次修复请求，创建新的 Run。 */
export async function submitRepairRequest(
  request: RepairRequest,
): Promise<RunCreation> {
  const response = await fetch("/api/repair-requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });

  const parsed = runCreationSchema.safeParse(await trustedBody(response));
  if (!parsed.success) {
    throw new RunApiError("Prism returned an invalid Run creation contract.");
  }

  return parsed.data;
}

/** 获取 Run 摘要列表（禁用缓存，保证列表新鲜）。 */
export async function fetchRuns(): Promise<RunSummary[]> {
  const response = await fetch("/api/runs", { cache: "no-store" });
  const parsed = runListSchema.safeParse(await trustedBody(response));
  if (!parsed.success) {
    throw new RunApiError("Prism returned an invalid Run list contract.");
  }

  return parsed.data.runs;
}

/** 获取单个 Run 的完整卷宗。 */
export async function fetchRunDossier(runId: string): Promise<RunDossier> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`, {
    cache: "no-store",
  });
  const parsed = runDossierResponseSchema.safeParse(await trustedBody(response));
  if (!parsed.success) {
    throw new RunApiError("Prism returned an invalid Run dossier contract.");
  }

  return parsed.data.dossier;
}

/** 启动一次 live 混合编排（异步执行，立即返回"已启动"响应）。 */
export async function startOrchestration(
  runId: string,
): Promise<OrchestrationStartResponse> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/orchestration`, {
    method: "POST",
  });
  const parsed = orchestrationStartResponseSchema.safeParse(
    await trustedBody(response),
  );
  if (!parsed.success) {
    throw new RunApiError("Prism returned an invalid orchestration-start contract.");
  }

  return parsed.data;
}

/** 对当前待审批副作用做一次绑定摘要的人类裁决。 */
export async function decideEffect(
  runId: string,
  request: EffectDecisionRequest,
): Promise<RunDossier> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/effects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  const parsed = runDossierResponseSchema.safeParse(await trustedBody(response));
  if (!parsed.success) {
    throw new RunApiError("Prism returned an invalid effect-decision contract.");
  }
  if (request.decision === "approved") await startOrchestration(runId);
  return parsed.data.dossier;
}

/** 对某 Run 执行一次工作区请求（检查/测试/补丁），返回证据记录。 */
export async function runWorkspaceRequest(
  runId: string,
  request: WorkspaceRequest,
): Promise<WorkspaceEvidenceRecord> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/workspace`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  const parsed = workspaceEvidenceResponseSchema.safeParse(await trustedBody(response));
  if (!parsed.success) {
    throw new RunApiError("Prism returned an invalid workspace evidence contract.");
  }

  return parsed.data.record;
}
