import { createHash } from "node:crypto";

/** Stable sha256 of a JSON value, used for file names and evidence comparison. */
export function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
