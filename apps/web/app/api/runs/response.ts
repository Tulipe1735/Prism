import { contractErrorResponse, JSON_RESPONSE_HEADERS } from "../contract-response";

export { JSON_RESPONSE_HEADERS as RUN_JSON_RESPONSE_HEADERS };

export function runStorageErrorResponse(): Response {
  return contractErrorResponse(
    500,
    "run_storage_error",
    "Prism could not read durable Run storage.",
  );
}
