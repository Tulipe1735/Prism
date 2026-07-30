import {
  CONTRACT_ERROR_SCHEMA_VERSION,
  REPAIR_REQUEST_VALIDATION_SCHEMA_VERSION,
  contractErrorSchema,
  formatContractIssues,
  repairRequestSchema,
  repairRequestValidationSchema,
  type ContractError,
} from "@prism/contracts";

import { isConfiguredWorkspace } from "../../../lib/server/workspace-policy";

const MAX_REQUEST_BYTES = 16_384;
const JSON_RESPONSE_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

function errorResponse(
  status: number,
  code: ContractError["code"],
  message: string,
  issues: ContractError["issues"] = [],
) {
  const error = contractErrorSchema.parse({
    schemaVersion: CONTRACT_ERROR_SCHEMA_VERSION,
    code,
    message,
    issues,
  });

  return Response.json(error, {
    status,
    headers: JSON_RESPONSE_HEADERS,
  });
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0];

  if (contentType?.trim().toLowerCase() !== "application/json") {
    return errorResponse(
      415,
      "unsupported_media_type",
      "Send the repair request as application/json.",
    );
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return errorResponse(
      413,
      "payload_too_large",
      "The repair request exceeds the 16 KiB boundary.",
    );
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
    return errorResponse(
      413,
      "payload_too_large",
      "The repair request exceeds the 16 KiB boundary.",
    );
  }

  let input: unknown;
  try {
    input = JSON.parse(rawBody) as unknown;
  } catch {
    return errorResponse(400, "invalid_json", "The request body is not valid JSON.");
  }

  const parsedRequest = repairRequestSchema.safeParse(input);
  if (!parsedRequest.success) {
    return errorResponse(
      422,
      "invalid_repair_request",
      "The repair request does not match the supported v1 contract.",
      formatContractIssues(parsedRequest.error),
    );
  }

  if (!isConfiguredWorkspace(parsedRequest.data.workspace)) {
    return errorResponse(
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

  const validation = repairRequestValidationSchema.parse({
    schemaVersion: REPAIR_REQUEST_VALIDATION_SCHEMA_VERSION,
    status: "accepted",
    request: parsedRequest.data,
  });

  return Response.json(validation, {
    status: 200,
    headers: JSON_RESPONSE_HEADERS,
  });
}
