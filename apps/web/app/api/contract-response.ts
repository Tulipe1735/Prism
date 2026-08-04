/**
 * API 契约化错误响应的公共助手。
 *
 * 所有 Prism API 端点统一用 contractErrorSchema 结构返回错误，
 * 保证前端能稳定解析错误码与字段级校验问题（issues）。
 */
import {
  CONTRACT_ERROR_SCHEMA_VERSION,
  type ContractError,
  contractErrorSchema,
} from "@prism/contracts";

/** 所有 JSON 响应共用的响应头：禁用缓存 + JSON 媒体类型。 */
export const JSON_RESPONSE_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

/**
 * 构造一个契约化错误响应。
 *
 * @param status HTTP 状态码
 * @param code 契约错误码
 * @param message 人类可读的错误消息
 * @param issues 字段级校验问题（可选）
 */
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
