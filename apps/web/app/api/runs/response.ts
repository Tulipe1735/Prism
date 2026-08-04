/**
 * /api/runs 端点族（GET 列表 / GET 单 Run / POST 编排 等）的共享响应助手。
 */
import { contractErrorResponse, JSON_RESPONSE_HEADERS } from "../contract-response";

export { JSON_RESPONSE_HEADERS as RUN_JSON_RESPONSE_HEADERS };

/** 构造"Run 存储不可读"的 500 错误响应。 */
export function runStorageErrorResponse(): Response {
  return contractErrorResponse(
    500,
    "run_storage_error",
    "Prism could not read durable Run storage.",
  );
}
