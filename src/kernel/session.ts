export const SESSION_FORMAT_VERSION = 1;

export type MessageRole = "user" | "assistant" | "system" | "tool";

/** First line of a session log: identifies the session and the workspace it belongs to. */
export interface SessionHeader {
  type: "header";
  version: number;
  id: string;
  workspace: string;
  title?: string;
  timestamp: string;
}

export interface SessionEntryBase {
  id: string;
  parentId: string | null;
  timestamp: string;
}

export interface MessageEntry extends SessionEntryBase {
  type: "message";
  role: MessageRole;
  content: string;
}

/** Replaces the entries between the branch start and `firstKeptEntryId` with `summary`. */
export interface CompactionEntry extends SessionEntryBase {
  type: "compaction";
  summary: string;
  firstKeptEntryId: string | null;
}

export type SessionEntry = MessageEntry | CompactionEntry;

export type SessionEntryInput =
  | {
      type: "message";
      role: MessageRole;
      content: string;
      parentId?: string | null;
    }
  | {
      type: "compaction";
      summary: string;
      firstKeptEntryId: string | null;
      parentId?: string | null;
    };

export interface SessionLog {
  header: SessionHeader;
  entries: SessionEntry[];
}

export interface SessionSummary {
  id: string;
  workspace: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  entryCount: number;
  leafId: string | null;
}

/** One model-ready message rebuilt from the log, oldest first. */
export interface ContextMessage {
  role: MessageRole;
  content: string;
  entryId: string;
  summary?: true;
}

/** Thrown when a log entry references an entry that is not in the log. */
export class SessionLogError extends Error {
  override name = "SessionLogError";
}

/**
 * Rebuilds the conversation context for a leaf by following `parentId` back to
 * the branch start. The newest `compaction` on that branch replaces every entry
 * older than its `firstKeptEntryId` with its summary.
 */
export function rebuildContext(
  entries: SessionEntry[],
  options: { leafId?: string } = {},
): ContextMessage[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const chain: SessionEntry[] = [];
  let cursor = options.leafId ?? entries.at(-1)?.id ?? null;

  while (cursor !== null) {
    const entry = byId.get(cursor);
    if (entry === undefined)
      throw new SessionLogError(`Session entry ${cursor} is missing from the log`);
    chain.push(entry);
    cursor = entry.parentId;
  }
  chain.reverse();

  const newestCompaction = chain.reduce<CompactionEntry | undefined>(
    (newest, entry) => (entry.type === "compaction" ? entry : newest),
    undefined,
  );
  let firstKeptIndex = 0;
  if (newestCompaction !== undefined) {
    firstKeptIndex = chain.length;
    if (newestCompaction.firstKeptEntryId != null) {
      firstKeptIndex = chain.findIndex(
        (entry) => entry.id === newestCompaction.firstKeptEntryId,
      );
      if (firstKeptIndex === -1)
        throw new SessionLogError(
          `Compaction ${newestCompaction.id} keeps missing entry ${newestCompaction.firstKeptEntryId}`,
        );
    }
  }

  const messages: ContextMessage[] = [];
  if (newestCompaction !== undefined) messages.push(summaryMessage(newestCompaction));
  for (const [index, entry] of chain.entries()) {
    if (index < firstKeptIndex || entry.id === newestCompaction?.id) continue;
    if (entry.type === "compaction") {
      messages.push(summaryMessage(entry));
    } else {
      messages.push({ role: entry.role, content: entry.content, entryId: entry.id });
    }
  }
  return messages;
}

export function summaryMessage(entry: CompactionEntry): ContextMessage {
  return {
    role: "system",
    content: entry.summary,
    entryId: entry.id,
    summary: true,
  };
}
