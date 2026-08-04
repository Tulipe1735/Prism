/**
 * POST /api/repair-requests —— 创建一次修复 Run。
 *
 * 严格校验链路：媒体类型 → 请求体积（16 KiB）→ JSON 合法 → 修复请求
 * 契约 → 工作区是否为已配置的本地工作区。全部通过后持久化创建 Run，
 * 返回 201 + RunCreation。
 */
import { formatContractIssues, repairRequestSchema } from "@prism/contracts";

import { createRun } from "../../../lib/server/run-repository";
import { isConfiguredWorkspace } from "../../../lib/server/workspace-policy";
import { contractErrorResponse, JSON_RESPONSE_HEADERS } from "../contract-response";

/** 修复请求体的体积上限（字节）。 */
const MAX_REQUEST_BYTES = 16_384;

export async function POST(request: Request) {
  // 1. 媒体类型必须为 application/json
  const contentType = request.headers.get("content-type")?.split(";", 1)[0];

  if (contentType?.trim().toLowerCase() !== "application/json") {
    return contractErrorResponse(
      415,
      "unsupported_media_type",
      "Send the repair request as application/json.",
    );
  }

  // 2. 体积上限：先看声明的 content-length，再按实际字节数双重校验
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return contractErrorResponse(
      413,
      "payload_too_large",
      "The repair request exceeds the 16 KiB boundary.",
    );
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
    return contractErrorResponse(
      413,
      "payload_too_large",
      "The repair request exceeds the 16 KiB boundary.",
    );
  }

  // 3. 请求体必须是合法 JSON
  let input: unknown;
  try {
    input = JSON.parse(rawBody) as unknown;
  } catch {
    return contractErrorResponse(
      400,
      "invalid_json",
      "The request body is not valid JSON.",
    );
  }

  // 4. 必须符合修复请求 v1 契约
  const parsedRequest = repairRequestSchema.safeParse(input);
  if (!parsedRequest.success) {
    return contractErrorResponse(
      422,
      "invalid_repair_request",
      "The repair request does not match the supported v1 contract.",
      formatContractIssues(parsedRequest.error),
    );
  }

  // 5. 目标工作区必须是已配置的本地工作区
  if (!isConfiguredWorkspace(parsedRequest.data.workspace)) {
    return contractErrorResponse(
      422,
      "unsupported_workspace",
      "The requested workspace is not the configured local Prism workspace.",
      [
        {
          path: "workspace.path",
          code: "custom",
          message: "Choose the configured local workspace.",
        },
      ],
    );
  }

  // 6. 持久化创建 Run
  try {
    const creation = await createRun(parsedRequest.data);
    return Response.json(creation, {
      status: 201,
      headers: JSON_RESPONSE_HEADERS,
    });
  } catch {
    return contractErrorResponse(
      500,
      "run_storage_error",
      "Prism could not commit the Run to durable storage.",
    );
  }
}
