/**
 * Durable input receipts, shared by the kernel browser tools (`src/kernel/browser`)
 * and the browser CLI (`src/cli`). Both sides write the same file format; each
 * keeps its own receipt type and validation on top of this store.
 *
 * A receipt records what happened to one browser action. `unknown` means input
 * may have reached the browser; it never proves that the task succeeded.
 */
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { digest } from "./digest.ts";

/** The fields that name and locate one receipt file. */
export interface ReceiptIdentity {
  session: string;
  request_id: string;
}

export function receiptPath(
  directory: string,
  session: string,
  request: string,
): string {
  return join(directory, "receipts", `${digest([session, request])}.json`);
}

/** Reads one receipt; a missing file is `null`, an unreadable file throws. */
export async function readReceiptFile<T>(
  directory: string,
  session: string,
  request: string,
  parse: (raw: unknown) => T,
): Promise<T | null> {
  try {
    const raw: unknown = JSON.parse(
      await readFile(receiptPath(directory, session, request), "utf8"),
    );
    return parse(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Persist an unknown receipt before input, then atomically replace it after acknowledgement. */
export async function saveReceiptFile(
  directory: string,
  receipt: ReceiptIdentity,
): Promise<void> {
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
