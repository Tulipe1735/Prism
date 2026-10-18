import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { rebuildContext } from "../../src/kernel/session.ts";
import { SessionStore } from "../../src/kernel/session-store.ts";

describe("session store", () => {
  let dataDir: string;
  let store: SessionStore;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "prism-sessions-"));
    store = new SessionStore(dataDir);
  });

  afterEach(async () => {
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
    const one = await store.append(header.id, {
      type: "message",
      role: "user",
      content: "one",
    });
    await store.append(header.id, { type: "message", role: "assistant", content: "two" });
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
});
