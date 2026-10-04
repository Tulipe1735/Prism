import type { Receipt } from "./protocol.ts";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { digest } from "../browser/evidence.ts";
import { receiptSchema } from "./protocol.ts";

export function receiptPath(
  directory: string,
  session: string,
  request: string,
): string {
  return join(directory, "receipts", `${digest([session, request])}.json`);
}
export async function readReceipt(
  directory: string,
  session: string,
  request: string,
): Promise<Receipt | null> {
  try {
    return receiptSchema.parse(
      JSON.parse(await readFile(receiptPath(directory, session, request), "utf8")),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
/** Persist an unknown receipt before input, then atomically replace it after acknowledgement. */
export async function saveReceipt(directory: string, receipt: Receipt): Promise<void> {
  const root = join(directory, "receipts");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = receiptPath(directory, receipt.session, receipt.request_id);
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temp, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify(receipt)}\n`);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temp, path);
  } finally {
    await unlink(temp).catch(() => {});
  }
}
