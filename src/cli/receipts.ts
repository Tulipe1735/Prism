/**
 * The browser CLI's view of a browser action receipt.
 *
 * Format and storage live in `src/shared/receipts.ts`, together with the
 * kernel's copy (`src/kernel/browser/receipts.ts`). The CLI parses every
 * receipt against its protocol schema, because the receipt crosses the CLI
 * boundary; the kernel trusts what it wrote itself.
 */
import type { Receipt } from "./protocol.ts";
import { readReceiptFile, saveReceiptFile } from "../shared/receipts.ts";
import { receiptSchema } from "./protocol.ts";

export function readReceipt(
  directory: string,
  session: string,
  request: string,
): Promise<Receipt | null> {
  return readReceiptFile(directory, session, request, (raw) =>
    receiptSchema.parse(raw),
  );
}

export async function saveReceipt(directory: string, receipt: Receipt): Promise<void> {
  await saveReceiptFile(directory, receipt);
}
