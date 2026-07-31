import {
  CONTRACT_ERROR_SCHEMA_VERSION,
  type ContractError,
  contractErrorSchema,
} from "@prism/contracts";

export const JSON_RESPONSE_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

export function contractErrorResponse(
  status: number,
  code: ContractError["code"],
  message: string,
  issues: ContractError["issues"] = [],
): Response {
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
