/**
 * The kernel's view of a browser action receipt.
 *
 * Format and storage live in `src/shared/receipts.ts`, together with the
 * browser CLI's copy (`src/cli/receipts.ts`): the CLI validates every field of
 * a receipt it reads, while the kernel reads the receipts it wrote itself.
 */
import type { SnapshotActionKind } from "../../shared/types.ts";
import { readReceiptFile, saveReceiptFile } from "../../shared/receipts.ts";

export interface Receipt {
  session: string;
  request_id: string;
  request_hash: string;
  observation: string;
  target: string;
  evidence: string;
  operation: SnapshotActionKind;
  outcome: "not_executed" | "executed" | "unknown";
  stage: "validation" | "execution" | "receipt";
  recorded_at: string;
  code: string;
  message: string;
}

export function readReceipt(
  directory: string,
  session: string,
  request: string,
): Promise<Receipt | null> {
  return readReceiptFile<Receipt>(directory, session, request, (raw) => raw as Receipt);
}

export async function saveReceipt(directory: string, receipt: Receipt): Promise<void> {
  await saveReceiptFile(directory, receipt);
}
