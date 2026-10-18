import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
});
