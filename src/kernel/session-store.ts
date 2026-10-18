import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { z } from "zod";

import {
  SESSION_FORMAT_VERSION,
  type SessionEntry,
  type SessionEntryInput,
  type SessionHeader,
  type SessionLog,
} from "./session.ts";

export type SessionStoreErrorCode = "SESSION_NOT_FOUND" | "INVALID_SESSION_LOG";

export class SessionStoreError extends Error {
  readonly code: SessionStoreErrorCode;

  constructor(code: SessionStoreErrorCode, message: string) {
    super(message);
    this.name = "SessionStoreError";
    this.code = code;
  }
}

const SESSION_ID_PATTERN = /^[0-9a-zA-Z-]{8,64}$/;

const headerSchema = z.object({
  type: z.literal("header"),
  version: z.literal(SESSION_FORMAT_VERSION),
  id: z.string().min(1),
  workspace: z.string().min(1),
  title: z.string().optional(),
  timestamp: z.string().min(1),
});

const entrySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("message"),
    id: z.string().min(1),
    parentId: z.string().nullable(),
    timestamp: z.string().min(1),
    role: z.enum(["user", "assistant", "system", "tool"]),
    content: z.string(),
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
    await writeFile(join(directory, `${header.id}.jsonl`), `${JSON.stringify(header)}\n`, {
      flag: "wx",
    });
    return header;
  }

  async append(sessionId: string, input: SessionEntryInput): Promise<SessionEntry> {
    const path = await this.locate(sessionId);
    const { entries } = await this.readLog(path, sessionId);
    const parentId =
      input.parentId === undefined ? (entries.at(-1)?.id ?? null) : input.parentId;
    const base = { id: randomUUID(), parentId, timestamp: new Date().toISOString() };
    const entry: SessionEntry =
      input.type === "message"
        ? { type: "message", ...base, role: input.role, content: input.content }
        : {
            type: "compaction",
            ...base,
            summary: input.summary,
            firstKeptEntryId: input.firstKeptEntryId,
          };
    await appendFile(path, `${JSON.stringify(entry)}\n`);
    return entry;
  }

  async read(sessionId: string): Promise<SessionLog> {
    return this.readLog(await this.locate(sessionId), sessionId);
  }

  async filePath(sessionId: string): Promise<string> {
    return this.locate(sessionId);
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
