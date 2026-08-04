/**
 * POST /api/runs/[runId]/workspace —— 对 Run 执行一次受限工作区请求。
 *
 * 校验链路：媒体类型 → 体积（512 KiB）→ JSON 合法 → 工作区请求契约 →
 * 请求的 Run ID 与路由一致。执行与证据落盘成功后返回 201 + 证据记录。
 */
import {
  formatContractIssues,
  WORKSPACE_EVIDENCE_RESPONSE_SCHEMA_VERSION,
  workspaceEvidenceResponseSchema,
  workspaceRequestSchema,
} from "@prism/contracts";

import { executeWorkspaceRequest } from "../../../../../lib/server/run-repository";
import {
  contractErrorResponse,
  JSON_RESPONSE_HEADERS,
} from "../../../contract-response";

/** 工作区请求体的体积上限（字节）。 */
const MAX_WORKSPACE_REQUEST_BYTES = 524_288;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0];
  if (contentType?.trim().toLowerCase() !== "application/json") {
    return contractErrorResponse(
      415,
      "unsupported_media_type",
      "Send the workspace request as application/json.",
    );
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_WORKSPACE_REQUEST_BYTES) {
    return contractErrorResponse(
      413,
      "payload_too_large",
      "The workspace request exceeds the 512 KiB boundary.",
    );
  }

  let input: unknown;
  try {
    input = JSON.parse(rawBody) as unknown;
  } catch {
    return contractErrorResponse(
      400,
      "invalid_json",
      "The workspace request body is not valid JSON.",
    );
  }

  const parsed = workspaceRequestSchema.safeParse(input);
  if (!parsed.success) {
    return contractErrorResponse(
      422,
      "invalid_workspace_request",
      "The workspace request does not match the confined v1 contract.",
      formatContractIssues(parsed.error),
    );
  }

  const { runId } = await params;
  if (parsed.data.runId !== runId) {
    return contractErrorResponse(
      422,
      "invalid_workspace_request",
      "The workspace request belongs to a different Run.",
      [{ path: "runId", code: "custom", message: "Use the route Run ID." }],
    );
  }

  try {
    const record = await executeWorkspaceRequest(runId, parsed.data, request.signal);
    if (!record) {
      return contractErrorResponse(
        404,
        "run_not_found",
        "The requested Run does not exist.",
      );
    }

    const response = workspaceEvidenceResponseSchema.parse({
      schemaVersion: WORKSPACE_EVIDENCE_RESPONSE_SCHEMA_VERSION,
      record,
    });
    return Response.json(response, { status: 201, headers: JSON_RESPONSE_HEADERS });
  } catch {
    return contractErrorResponse(
      500,
      "workspace_execution_error",
      "Prism could not commit confined workspace evidence for this Run.",
    );
  }
}
