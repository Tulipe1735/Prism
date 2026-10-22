import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  rename as renameFile,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";

import {
  compareSessions,
  SESSION_FORMAT_VERSION,
  type SessionEntry,
  type SessionEntryInput,
  type SessionHeader,
  type SessionLog,
  type SessionSummary,
} from "./session.ts";

export type SessionStoreErrorCode =
  "SESSION_NOT_FOUND" | "INVALID_SESSION_LOG" | "INVALID_INPUT";

export class SessionStoreError extends Error {
  readonly code: SessionStoreErrorCode;

  constructor(code: SessionStoreErrorCode, message: string) {
    super(message);
    this.name = "SessionStoreError";
    this.code = code;
  }
}

const SESSION_ID_PATTERN = /^[0-9a-z-]{8,64}$/i;

const headerSchema = z.object({
  type: z.literal("header"),
  version: z.literal(SESSION_FORMAT_VERSION),
  id: z.string().min(1),
  workspace: z.string().min(1),
  title: z.string().optional(),
  timestamp: z.string().min(1),
});

const permissionActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file-write"), path: z.string().min(1) }),
  z.object({ kind: z.literal("command"), command: z.string() }),
  z.object({
    kind: z.literal("browser-action"),
    action: z.string().min(1),
    target: z.string(),
  }),
]);

const entrySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("message"),
    id: z.string().min(1),
    parentId: z.string().nullable(),
    timestamp: z.string().min(1),
    role: z.enum(["user", "assistant", "system", "tool"]),
    content: z.string(),
    context: z.string().optional(),
    attachments: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          path: z.string(),
          size: z.number().nonnegative(),
          mediaType: z.string(),
        }),
      )
      .optional(),
    reasoning: z.string().optional(),
  }),
  z.object({
    type: z.literal("tool_call"),
    id: z.string().min(1),
    parentId: z.string().nullable(),
    timestamp: z.string().min(1),
    callId: z.string().min(1),
    name: z.string().min(1),
    arguments: z.string(),
    effects: z.array(permissionActionSchema).optional(),
    reasoning: z.string().optional(),
  }),
  z.object({
    type: z.literal("tool_result"),
    id: z.string().min(1),
    parentId: z.string().nullable(),
    timestamp: z.string().min(1),
    callId: z.string().min(1),
    content: z.string(),
    isError: z.boolean(),
  }),
  z.object({
    type: z.literal("compaction"),
    id: z.string().min(1),
    parentId: z.string().nullable(),
    timestamp: z.string().min(1),
    summary: z.string(),
    firstKeptEntryId: z.string().nullable(),
  }),
]);

/** Directory name that keeps sessions of one workspace together. */
function workspaceKey(workspace: string): string {
  const path = resolve(workspace);
  const slug =
    basename(path)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "root";
  return `${slug}-${createHash("sha256").update(path).digest("hex").slice(0, 12)}`;
}

/**
 * Append-only JSONL session logs, grouped by workspace under
 * `<dataDir>/sessions/<workspace>/<sessionId>.jsonl`.
 */
export class SessionStore {
  readonly dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = resolve(dataDir);
  }

  async create(input: { workspace: string; title?: string }): Promise<SessionHeader> {
    const header: SessionHeader = {
      type: "header",
      version: SESSION_FORMAT_VERSION,
      id: randomUUID(),
      workspace: resolve(input.workspace),
      timestamp: new Date().toISOString(),
      ...(input.title === undefined ? {} : { title: input.title }),
    };
    const directory = join(this.dataDir, "sessions", workspaceKey(header.workspace));
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, `${header.id}.jsonl`),
      `${JSON.stringify(header)}\n`,
      {
        flag: "wx",
      },
    );
    return header;
  }

  async append(sessionId: string, input: SessionEntryInput): Promise<SessionEntry> {
    const path = await this.locate(sessionId);
    const { entries } = await this.readLog(path, sessionId);
    const parentId =
      input.parentId === undefined ? (entries.at(-1)?.id ?? null) : input.parentId;
    const base = {
      id: input.id ?? randomUUID(),
      parentId,
      timestamp: new Date().toISOString(),
    };
    const entry: SessionEntry = (() => {
      switch (input.type) {
        case "message":
          return {
            type: "message",
            ...base,
            role: input.role,
            content: input.content,
            ...(input.context === undefined ? {} : { context: input.context }),
            ...(input.attachments === undefined
              ? {}
              : { attachments: input.attachments }),
            ...(input.reasoning === undefined ? {} : { reasoning: input.reasoning }),
          };
        case "tool_call":
          return {
            type: "tool_call",
            ...base,
            callId: input.callId,
            name: input.name,
            arguments: input.arguments,
            ...(input.effects === undefined ? {} : { effects: input.effects }),
            ...(input.reasoning === undefined ? {} : { reasoning: input.reasoning }),
          };
        case "tool_result":
          return {
            type: "tool_result",
            ...base,
            callId: input.callId,
            content: input.content,
            isError: input.isError,
          };
        case "compaction":
          return {
            type: "compaction",
            ...base,
            summary: input.summary,
            firstKeptEntryId: input.firstKeptEntryId,
          };
      }
    })();
    await appendFile(path, `${JSON.stringify(entry)}\n`);
    return entry;
  }

  async read(sessionId: string): Promise<SessionLog> {
    return this.readLog(await this.locate(sessionId), sessionId);
  }

  /**
   * Replaces the title in the header line. Entries are append-only, so the
   * whole file is rewritten; the kernel refuses to rename a session whose task
   * is running, which is the only time the log grows.
   */
  async rename(sessionId: string, title: string): Promise<SessionHeader> {
    const path = await this.locate(sessionId);
    const text = await readFile(path, "utf8");
    const lines = text.split("\n");
    const header = parseLine(headerSchema, lines[0] ?? "", sessionId);
    const renamed: SessionHeader = { ...header, title };
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(
        temporary,
        [JSON.stringify(renamed), ...lines.slice(1)].join("\n"),
        { flag: "wx" },
      );
      await renameFile(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
    return renamed;
  }

  async summary(sessionId: string): Promise<SessionSummary> {
    return summarize(await this.read(sessionId));
  }

  async filePath(sessionId: string): Promise<string> {
    return this.locate(sessionId);
  }

  /** Sessions of every workspace, or of one workspace, most recent activity first. */
  async list(options: { workspace?: string } = {}): Promise<SessionSummary[]> {
    const workspace = options.workspace && resolve(options.workspace);
    const summaries: SessionSummary[] = [];
    for (const path of await this.logFiles()) {
      const log = await this.readLog(path, basename(path, ".jsonl"));
      if (workspace && log.header.workspace !== workspace) continue;
      summaries.push(summarize(log));
    }
    return summaries.sort(compareSessions);
  }

  async delete(sessionId: string): Promise<boolean> {
    const path = await this.locate(sessionId).catch(() => null);
    if (path === null) return false;
    await rm(path);
    await rmdir(dirname(path)).catch(() => undefined);
    return true;
  }

  /** Removes sessions whose last activity is older than `olderThan`, and returns their ids. */
  async prune(options: { olderThan: string; workspace?: string }): Promise<string[]> {
    const cutoff = Date.parse(options.olderThan);
    if (Number.isNaN(cutoff))
      throw new SessionStoreError(
        "INVALID_INPUT",
        `prune needs an ISO timestamp, received ${JSON.stringify(options.olderThan)}`,
      );
    const stale = (await this.list(options)).filter(
      (session) => Date.parse(session.updatedAt) < cutoff,
    );
    for (const session of stale) await this.delete(session.id);
    return stale.map((session) => session.id);
  }

  private async logFiles(): Promise<string[]> {
    const root = join(this.dataDir, "sessions");
    const directories = await readdir(root).catch(() => [] as string[]);
    const files: string[] = [];
    for (const directory of directories) {
      const entries = await readdir(join(root, directory)).catch(() => [] as string[]);
      for (const entry of entries) {
        if (entry.endsWith(".jsonl")) files.push(join(root, directory, entry));
      }
    }
    return files;
  }

  private async readLog(path: string, sessionId: string): Promise<SessionLog> {
    const lines = (await readFile(path, "utf8"))
      .split("\n")
      .filter((line) => line.trim() !== "");
    const [headerLine, ...entryLines] = lines;
    if (headerLine === undefined)
      throw new SessionStoreError(
        "INVALID_SESSION_LOG",
        `Session ${sessionId} has no header line`,
      );
    return {
      header: parseLine(headerSchema, headerLine, sessionId),
      entries: entryLines.map((line) => parseLine(entrySchema, line, sessionId)),
    };
  }

  private async locate(sessionId: string): Promise<string> {
    if (!SESSION_ID_PATTERN.test(sessionId))
      throw new SessionStoreError(
        "SESSION_NOT_FOUND",
        `Session ${sessionId} does not exist`,
      );
    const root = join(this.dataDir, "sessions");
    const directories = await readdir(root).catch(() => [] as string[]);
    for (const directory of directories) {
      const path = join(root, directory, `${sessionId}.jsonl`);
      if (await exists(path)) return path;
    }
    throw new SessionStoreError(
      "SESSION_NOT_FOUND",
      `Session ${sessionId} does not exist`,
    );
  }
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

function summarize(log: SessionLog): SessionSummary {
  const { header, entries } = log;
  const last = entries.at(-1);
  return {
    id: header.id,
    workspace: header.workspace,
    ...(header.title === undefined ? {} : { title: header.title }),
    createdAt: header.timestamp,
    updatedAt: last?.timestamp ?? header.timestamp,
    entryCount: entries.length,
    leafId: last?.id ?? null,
  };
}

function parseLine<T>(schema: z.ZodType<T>, line: string, sessionId: string): T {
  try {
    return schema.parse(JSON.parse(line));
  } catch (error) {
    throw new SessionStoreError(
      "INVALID_SESSION_LOG",
      `Session ${sessionId} contains an invalid log line: ${(error as Error).message}`,
    );
  }
}
