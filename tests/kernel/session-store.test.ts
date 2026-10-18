import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionStore, SessionStoreError } from "../../src/kernel/session-store.ts";
import { rebuildContext } from "../../src/kernel/session.ts";

describe("session store", () => {
  let dataDir: string;
  let store: SessionStore;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "prism-sessions-"));
    store = new SessionStore(dataDir);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("creates a session for a workspace and appends messages in order", async () => {
    const header = await store.create({ workspace: "/work/demo", title: "Demo" });
    expect(header.workspace).toBe("/work/demo");
    expect(header.title).toBe("Demo");
    expect(header.id).toMatch(/^[0-9a-f-]{8,}$/);

    const first = await store.append(header.id, {
      type: "message",
      role: "user",
      content: "Fix the failing test",
    });
    const second = await store.append(header.id, {
      type: "message",
      role: "assistant",
      content: "Running the suite now",
    });

    expect(first.parentId).toBeNull();
    expect(second.parentId).toBe(first.id);

    const log = await store.read(header.id);
    expect(log.header).toEqual(header);
    expect(log.entries).toEqual([first, second]);
  });

  it("stores each session as an append-only JSONL log starting with its header", async () => {
    const header = await store.create({ workspace: "/work/demo" });
    await store.append(header.id, { type: "message", role: "user", content: "hi" });

    const lines = (await readFile(await store.filePath(header.id), "utf8"))
      .trimEnd()
      .split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual(header);
    expect(JSON.parse(lines[1]!)).toMatchObject({ type: "message", content: "hi" });
  });

  it("rebuilds the context from the summary and the entries kept by a compaction", async () => {
    const header = await store.create({ workspace: "/work/demo" });
    await store.append(header.id, {
      type: "message",
      role: "user",
      content: "one",
    });
    await store.append(header.id, {
      type: "message",
      role: "assistant",
      content: "two",
    });
    const three = await store.append(header.id, {
      type: "message",
      role: "user",
      content: "three",
    });
    const four = await store.append(header.id, {
      type: "message",
      role: "assistant",
      content: "four",
    });
    const log = await store.read(header.id);
    expect(rebuildContext(log.entries).map((message) => message.content)).toEqual([
      "one",
      "two",
      "three",
      "four",
    ]);

    const compaction = await store.append(header.id, {
      type: "compaction",
      summary: "The user asked for one; the assistant answered two.",
      firstKeptEntryId: three.id,
    });

    const compacted = await store.read(header.id);
    expect(rebuildContext(compacted.entries)).toEqual([
      {
        role: "system",
        content: "The user asked for one; the assistant answered two.",
        entryId: compaction.id,
        summary: true,
      },
      { role: "user", content: "three", entryId: three.id },
      { role: "assistant", content: "four", entryId: four.id },
    ]);
  });

  it("continues the branch from a compaction entry", async () => {
    const header = await store.create({ workspace: "/work/demo" });
    const first = await store.append(header.id, {
      type: "message",
      role: "user",
      content: "one",
    });
    const compaction = await store.append(header.id, {
      type: "compaction",
      summary: "Summary of one.",
      firstKeptEntryId: first.id,
    });
    const next = await store.append(header.id, {
      type: "message",
      role: "assistant",
      content: "two",
    });
    expect(next.parentId).toBe(compaction.id);

    const log = await store.read(header.id);
    expect(rebuildContext(log.entries)).toEqual([
      {
        role: "system",
        content: "Summary of one.",
        entryId: compaction.id,
        summary: true,
      },
      { role: "user", content: "one", entryId: first.id },
      { role: "assistant", content: "two", entryId: next.id },
    ]);
  });

  it("lists sessions grouped by workspace, most recent activity first", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const alpha = await store.create({ workspace: "/work/alpha", title: "Alpha work" });
    vi.setSystemTime(new Date("2026-01-01T01:00:00.000Z"));
    const beta = await store.create({ workspace: "/work/beta" });
    vi.setSystemTime(new Date("2026-01-01T02:00:00.000Z"));
    const secondAlpha = await store.create({ workspace: "/work/alpha" });
    vi.setSystemTime(new Date("2026-01-02T00:00:00.000Z"));
    const entry = await store.append(alpha.id, {
      type: "message",
      role: "user",
      content: "hi",
    });

    expect(await store.list()).toEqual([
      {
        id: alpha.id,
        workspace: "/work/alpha",
        title: "Alpha work",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        entryCount: 1,
        leafId: entry.id,
      },
      {
        id: secondAlpha.id,
        workspace: "/work/alpha",
        createdAt: "2026-01-01T02:00:00.000Z",
        updatedAt: "2026-01-01T02:00:00.000Z",
        entryCount: 0,
        leafId: null,
      },
      {
        id: beta.id,
        workspace: "/work/beta",
        createdAt: "2026-01-01T01:00:00.000Z",
        updatedAt: "2026-01-01T01:00:00.000Z",
        entryCount: 0,
        leafId: null,
      },
    ]);
    expect(await store.list({ workspace: "/work/beta" })).toHaveLength(1);
    expect(await store.list({ workspace: "/work/nowhere" })).toEqual([]);

    expect(dirname(await store.filePath(alpha.id))).toBe(
      dirname(await store.filePath(secondAlpha.id)),
    );
    expect(dirname(await store.filePath(alpha.id))).not.toBe(
      dirname(await store.filePath(beta.id)),
    );
  });

  it("rejects a session log with a corrupted line", async () => {
    const header = await store.create({ workspace: "/work/demo" });
    const path = await store.filePath(header.id);
    await appendFile(path, "{not json}\n");

    await expect(store.read(header.id)).rejects.toMatchObject({
      code: "INVALID_SESSION_LOG",
    });
  });

  it("deletes a session and refuses unknown session ids", async () => {
    const header = await store.create({ workspace: "/work/demo" });
    expect(await store.delete(header.id)).toBe(true);
    expect(await store.list()).toEqual([]);
    expect(await store.delete(header.id)).toBe(false);

    await expect(store.read(header.id)).rejects.toBeInstanceOf(SessionStoreError);
    await expect(store.read("../../etc/passwd")).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
    });
  });

  it("prunes sessions whose last activity is older than the cutoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const stale = await store.create({ workspace: "/work/alpha" });
    vi.setSystemTime(new Date("2026-01-03T00:00:00.000Z"));
    const fresh = await store.create({ workspace: "/work/alpha" });

    expect(await store.prune({ olderThan: "2026-01-02T00:00:00.000Z" })).toEqual([
      stale.id,
    ]);
    expect((await store.list()).map((session) => session.id)).toEqual([fresh.id]);
    await expect(store.prune({ olderThan: "yesterday" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });
});
