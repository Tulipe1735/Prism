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

/**
 * Rebuilds the conversation context for a leaf by walking `parentId` up to the
 * branch start. A `compaction` entry contributes its summary and then jumps to
 * `firstKeptEntryId`, so everything before that entry is replaced by the summary.
 */
export function rebuildContext(
  entries: SessionEntry[],
  options: { leafId?: string } = {},
): ContextMessage[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const messages: ContextMessage[] = [];
  let cursor = options.leafId ?? entries.at(-1)?.id ?? null;

  while (cursor !== null) {
    const entry = byId.get(cursor);
    if (entry === undefined)
      throw new Error(`Session entry ${cursor} is missing from the log`);
    if (entry.type === "compaction") {
      messages.push({
        role: "system",
        content: entry.summary,
        entryId: entry.id,
        summary: true,
      });
      cursor = entry.firstKeptEntryId;
    } else {
      messages.push({ role: entry.role, content: entry.content, entryId: entry.id });
      cursor = entry.parentId;
    }
  }

  return messages.reverse();
}
