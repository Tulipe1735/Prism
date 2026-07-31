import { formatContractIssues, repairRequestSchema } from "@prism/contracts";

import { createRun } from "../../../lib/server/run-repository";
import { isConfiguredWorkspace } from "../../../lib/server/workspace-policy";
import { contractErrorResponse, JSON_RESPONSE_HEADERS } from "../contract-response";

const MAX_REQUEST_BYTES = 16_384;

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0];

  if (contentType?.trim().toLowerCase() !== "application/json") {
    return contractErrorResponse(
      415,
      "unsupported_media_type",
      "Send the repair request as application/json.",
    );
  }

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

  const parsedRequest = repairRequestSchema.safeParse(input);
  if (!parsedRequest.success) {
    return contractErrorResponse(
      422,
      "invalid_repair_request",
      "The repair request does not match the supported v1 contract.",
      formatContractIssues(parsedRequest.error),
    );
  }

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
