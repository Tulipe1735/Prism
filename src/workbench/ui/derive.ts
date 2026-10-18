import type {
  MessageRole,
  SessionEntry,
  SessionSummary,
} from "../../kernel/session.ts";

/** Sessions of one workspace, most recent first. */
export interface SessionGroup {
  workspace: string;
  sessions: SessionSummary[];
}

/** Groups the session list by workspace; the group with the newest session comes first. */
export function groupSessions(sessions: SessionSummary[]): SessionGroup[] {
  const byWorkspace = new Map<string, SessionSummary[]>();
  for (const session of sessions) {
    const list = byWorkspace.get(session.workspace);
    if (list === undefined) byWorkspace.set(session.workspace, [session]);
    else list.push(session);
  }
  return [...byWorkspace]
    .map(([workspace, list]) => ({ workspace, sessions: byUpdated(list) }))
    .sort(
      (a, b) =>
        (b.sessions[0]?.updatedAt ?? "").localeCompare(
          a.sessions[0]?.updatedAt ?? "",
        ) || a.workspace.localeCompare(b.workspace),
    );
}

/** Sessions whose title, workspace or id contains the query (case-insensitive). */
export function searchSessions(
  sessions: SessionSummary[],
  query: string,
): SessionSummary[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return sessions;
  return sessions.filter((session) =>
    [session.title ?? "", session.workspace, session.id].some((field) =>
      field.toLowerCase().includes(needle),
    ),
  );
}

function byUpdated(sessions: SessionSummary[]): SessionSummary[] {
  return [...sessions].sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id),
  );
}

/**
 * A turn runs while the last log entry is not a finished message: the loop
 * appends the assistant (or system) message only when the turn is over, so the
 * workbench can show and cancel a running task from events alone.
 */
export function isTaskRunning(entries: SessionEntry[]): boolean {
  const leaf = entries.at(-1);
  if (leaf === undefined) return false;
  return leaf.type === "message" ? leaf.role === "user" : true;
}

export type ToolState = "running" | "ok" | "failed";

export interface MessageStep {
  kind: "message";
  id: string;
  role: MessageRole;
  content: string;
  /** Text that arrived as `message.delta` and is not in the log yet. */
  streaming: boolean;
}

export interface ToolStep {
  kind: "tool";
  id: string;
  callId: string;
  name: string;
  /** Arguments as stored in the log (JSON text). */
  arguments: string;
  /** Path the call touches, when its arguments name one. */
  target?: string;
  result?: string;
  state: ToolState;
}

export interface CompactionStep {
  kind: "compaction";
  id: string;
  summary: string;
}

export type TimelineStep = MessageStep | ToolStep | CompactionStep;

/**
 * Renders the session log as steps, pairing every tool call with its result.
 * `deltas` carries text that is still streaming; it becomes part of the log
 * once the kernel persists the message.
 */
export function toTimeline(
  entries: SessionEntry[],
  options: { deltas?: ReadonlyMap<string, string> } = {},
): TimelineStep[] {
  const results = new Map<string, string>();
  const errors = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "tool_result") continue;
    results.set(entry.callId, entry.content);
    if (entry.isError) errors.add(entry.callId);
  }

  const steps: TimelineStep[] = [];
  const logged = new Set<string>();
  for (const entry of entries) {
    logged.add(entry.id);
    switch (entry.type) {
      case "message":
        steps.push({
          kind: "message",
          id: entry.id,
          role: entry.role,
          content: entry.content,
          streaming: false,
        });
        break;
      case "tool_call": {
        const result = results.get(entry.callId);
        steps.push({
          kind: "tool",
          id: entry.id,
          callId: entry.callId,
          name: entry.name,
          arguments: entry.arguments,
          ...(targetOf(entry.arguments) === undefined
            ? {}
            : { target: targetOf(entry.arguments) as string }),
          ...(result === undefined ? {} : { result }),
          state:
            result === undefined
              ? "running"
              : errors.has(entry.callId)
                ? "failed"
                : "ok",
        });
        break;
      }
      case "compaction":
        steps.push({ kind: "compaction", id: entry.id, summary: entry.summary });
        break;
      case "tool_result":
        break;
    }
  }

  for (const [entryId, content] of options.deltas ?? []) {
    if (logged.has(entryId) || content === "") continue;
    steps.push({
      kind: "message",
      id: entryId,
      role: "assistant",
      content,
      streaming: true,
    });
  }
  return steps;
}

export interface DiffLine {
  kind: "add" | "remove" | "context" | "hunk" | "meta";
  text: string;
}

const DIFF_START = /^(?:diff --git |@@ |--- )/;
const META =
  /^(?:diff --git |--- |\+\+\+ |index |new file mode |deleted file mode |similarity index |rename )/;

/**
 * Reads the first unified diff inside a tool result. Text before the diff
 * (progress notes, summaries) is dropped; `null` means the result carries no
 * diff and the workbench shows the raw result instead.
 */
export function parseUnifiedDiff(text: string): DiffLine[] | null {
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  const lines = body.split("\n");
  const start = lines.findIndex((line) => DIFF_START.test(line));
  if (start === -1) return null;
  const hunks = lines.slice(start);
  return hunks.map((line) => {
    if (line.startsWith("@@")) return { kind: "hunk", text: line } as const;
    if (META.test(line)) return { kind: "meta", text: line } as const;
    if (line.startsWith("+")) return { kind: "add", text: line } as const;
    if (line.startsWith("-")) return { kind: "remove", text: line } as const;
    return { kind: "context", text: line } as const;
  });
}

/** One file a tool call touched, with the diff the result carried. */
export interface FileChange {
  path: string;
  tool: string;
  callId: string;
  state: ToolState;
  added: number;
  removed: number;
  diff: DiffLine[] | null;
  /** Content a writing tool was asked to write, when the result has no diff. */
  written: string | null;
  result: string;
}

/** Tools whose name says they only read; their path arguments are not changes. */
const READ_ONLY =
  /^(?:read|cat|list|ls|glob|grep|search|find|skill|echo|status|observe|screenshot|web_)/i;

/** File changes a session made, oldest first. */
export function toChanges(entries: SessionEntry[]): FileChange[] {
  return toTimeline(entries)
    .filter(
      (step): step is ToolStep =>
        step.kind === "tool" && step.target !== undefined && !READ_ONLY.test(step.name),
    )
    .map((step) => {
      const diff = parseUnifiedDiff(step.result ?? "");
      return {
        path: step.target as string,
        tool: step.name,
        callId: step.callId,
        state: step.state,
        added: count(diff, "add"),
        removed: count(diff, "remove"),
        diff,
        written: diff === null ? writtenContent(step.arguments) : null,
        result: step.result ?? "",
      };
    });
}

/** The content argument of a writing tool call, when it carries one. */
function writtenContent(argumentsText: string): string | null {
  try {
    const parsed = JSON.parse(argumentsText) as Record<string, unknown>;
    const content = parsed?.content;
    return typeof content === "string" ? content : null;
  } catch {
    return null;
  }
}

/** One artifact of a session: the latest state and diff of a touched file. */
export interface Artifact {
  path: string;
  tool: string;
  state: ToolState;
  added: number;
  removed: number;
  diff: DiffLine[] | null;
  written: string | null;
  result: string;
  calls: number;
}

/** Reduces the changes to one entry per file, keeping the newest diff seen. */
export function toArtifacts(entries: SessionEntry[]): Artifact[] {
  const byPath = new Map<string, Artifact>();
  for (const change of toChanges(entries)) {
    const seen = byPath.get(change.path);
    byPath.set(change.path, {
      path: change.path,
      tool: change.tool,
      state: change.state,
      result: change.result,
      calls: (seen?.calls ?? 0) + 1,
      ...(change.diff === null
        ? {
            added: seen?.added ?? 0,
            removed: seen?.removed ?? 0,
            diff: seen?.diff ?? null,
            written: change.written ?? seen?.written ?? null,
          }
        : {
            added: change.added,
            removed: change.removed,
            diff: change.diff,
            written: change.written,
          }),
    });
  }
  return [...byPath.values()];
}

function count(lines: DiffLine[] | null, kind: DiffLine["kind"]): number {
  return lines?.filter((line) => line.kind === kind).length ?? 0;
}

const PATH_KEYS = ["path", "file", "filePath", "file_path", "filename"];
const PATH_LIKE = /[/.]/;

/** The file path a tool call names, when its JSON arguments carry one. */
export function targetOf(argumentsText: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsText);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return undefined;
  const record = parsed as Record<string, unknown>;
  for (const key of PATH_KEYS) {
    const value = record[key];
    if (typeof value === "string" && PATH_LIKE.test(value) && !value.includes("\n"))
      return value;
  }
  return undefined;
}
