import { createHash } from "node:crypto";

/** 计算内容的 SHA-256 十六进制摘要。 */
export function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}
