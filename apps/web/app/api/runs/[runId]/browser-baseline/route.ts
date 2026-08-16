/**
 * POST /api/runs/[runId]/browser-baseline —— 为 Run 采集一次浏览器基线。
 *
 * 校验链路：媒体类型 → 体积（64 KiB）→ JSON 合法 → 基线请求契约 →
 * 请求的 Run ID 与路由一致。浏览器未配置（无 PRISM_BROWSER_BASE_URL）
 * 返回 409 browser_baseline_not_configured；成功返回 201 + 基线记录。
 */
import {
  BROWSER_BASELINE_RESPONSE_SCHEMA_VERSION,
  browserBaselineRequestSchema,
  browserBaselineResponseSchema,
  formatContractIssues,
} from "@prism/contracts";

import {
  BrowserBaselineConfigurationError,
  captureBrowserBaseline,
} from "../../../../../lib/server/run-repository";
import {
  contractErrorResponse,
  JSON_RESPONSE_HEADERS,
} from "../../../contract-response";

/** 浏览器基线请求体的体积上限（字节）。 */
const MAX_BROWSER_BASELINE_REQUEST_BYTES = 65_536;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0];
  if (contentType?.trim().toLowerCase() !== "application/json") {
    return contractErrorResponse(
      415,
      "unsupported_media_type",
      "Send the Browser Baseline request as application/json.",
    );
  }

  const rawBody = await request.text();
  if (
    new TextEncoder().encode(rawBody).byteLength > MAX_BROWSER_BASELINE_REQUEST_BYTES
  ) {
    return contractErrorResponse(
      413,
      "payload_too_large",
      "The Browser Baseline request exceeds the 64 KiB boundary.",
    );
  }

  let input: unknown;
  try {
    input = JSON.parse(rawBody) as unknown;
  } catch {
    return contractErrorResponse(
      400,
      "invalid_json",
      "The Browser Baseline request body is not valid JSON.",
    );
  }

  const parsed = browserBaselineRequestSchema.safeParse(input);
  if (!parsed.success) {
    return contractErrorResponse(
      422,
      "invalid_browser_baseline_request",
      "The Browser Baseline request does not match the constrained v1 contract.",
      formatContractIssues(parsed.error),
    );
  }

  const { runId } = await params;
  if (parsed.data.runId !== runId) {
    return contractErrorResponse(
      422,
      "invalid_browser_baseline_request",
      "The Browser Baseline request belongs to a different Run.",
      [{ path: "runId", code: "custom", message: "Use the route Run ID." }],
    );
  }

  try {
    const baseline = await captureBrowserBaseline(runId, parsed.data);
    if (!baseline) {
      return contractErrorResponse(
        404,
        "run_not_found",
        "The requested Run does not exist.",
      );
    }

    return Response.json(
      browserBaselineResponseSchema.parse({
        schemaVersion: BROWSER_BASELINE_RESPONSE_SCHEMA_VERSION,
        baseline,
      }),
      { status: 201, headers: JSON_RESPONSE_HEADERS },
    );
  } catch (error) {
    if (error instanceof BrowserBaselineConfigurationError) {
      return contractErrorResponse(
        409,
        "browser_baseline_not_configured",
        error.message,
      );
    }
    return contractErrorResponse(
      500,
      "browser_execution_error",
      "Prism could not capture and commit Browser Baseline evidence for this Run.",
    );
  }
}
