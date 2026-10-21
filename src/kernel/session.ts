import type { PermissionAction } from "./permissions.ts";

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
  attachments?: Attachment[];
}

export interface Attachment {
  id: string;
  name: string;
  path: string;
  size: number;
  mediaType: string;
}

/** One tool call the model asked for; `arguments` is the JSON text as received. */
export interface ToolCallEntry extends SessionEntryBase {
  type: "tool_call";
  callId: string;
  name: string;
  arguments: string;
  /**
   * What the call declared it would touch (`Tool.effects`), decided before it
   * ran. Absent when the tool declares nothing (MCP tools, for example), which
   * says "unknown", not "no effect".
   */
  effects?: PermissionAction[];
}

export interface ToolResultEntry extends SessionEntryBase {
  type: "tool_result";
  callId: string;
  content: string;
  isError: boolean;
}

/** Replaces the entries between the branch start and `firstKeptEntryId` with `summary`. */
export interface CompactionEntry extends SessionEntryBase {
  type: "compaction";
  summary: string;
  firstKeptEntryId: string | null;
}

export type SessionEntry =
  MessageEntry | ToolCallEntry | ToolResultEntry | CompactionEntry;

export type SessionEntryInput =
  | {
      type: "message";
      role: MessageRole;
      content: string;
      attachments?: Attachment[];
      parentId?: string | null;
      /** Set by the task loop so streamed deltas carry the id of the persisted entry. */
      id?: string;
    }
  | {
      type: "tool_call";
      callId: string;
      name: string;
      arguments: string;
      /** Declared effects of this call; omitted when the tool declares none. */
      effects?: PermissionAction[];
      parentId?: string | null;
      id?: string;
    }
  | {
      type: "tool_result";
      callId: string;
      content: string;
      isError: boolean;
      parentId?: string | null;
      id?: string;
    }
  | {
      type: "compaction";
      summary: string;
      firstKeptEntryId: string | null;
      parentId?: string | null;
      id?: string;
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

/** Newest activity first; the id breaks ties, so the order is total. */
export function compareSessions(a: SessionSummary, b: SessionSummary): number {
  return b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id);
}

/** One model-ready message rebuilt from the log, oldest first. */
export interface ContextMessage {
  role: MessageRole;
  content: string;
  attachments?: Attachment[];
  entryId: string;
  summary?: true;
  /** Tool calls of an assistant message; `arguments` is the JSON text as received. */
  toolCalls?: ToolCallRecord[];
  /** Set on a tool message: the call this result answers. */
  toolCallId?: string;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  arguments: string;
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
  /** Assistant message that consecutive tool calls are merged into. */
  let openAssistant: ContextMessage | null = null;
  for (const [index, entry] of chain.entries()) {
    if (index < firstKeptIndex || entry.id === newestCompaction?.id) continue;
    switch (entry.type) {
      case "message": {
        const message: ContextMessage = {
          role: entry.role,
          content: entry.content,
          entryId: entry.id,
          ...(entry.attachments === undefined
            ? {}
            : { attachments: entry.attachments }),
        };
        messages.push(message);
        openAssistant = entry.role === "assistant" ? message : null;
        break;
      }
      case "tool_call": {
        if (openAssistant === null) {
          openAssistant = { role: "assistant", content: "", entryId: entry.id };
          messages.push(openAssistant);
        }
        openAssistant.toolCalls ??= [];
        openAssistant.toolCalls.push({
          id: entry.callId,
          name: entry.name,
          arguments: entry.arguments,
        });
        break;
      }
      case "tool_result": {
        messages.push({
          role: "tool",
          content: entry.content,
          entryId: entry.id,
          toolCallId: entry.callId,
        });
        openAssistant = null;
        break;
      }
      case "compaction": {
        messages.push(summaryMessage(entry));
        openAssistant = null;
        break;
      }
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
