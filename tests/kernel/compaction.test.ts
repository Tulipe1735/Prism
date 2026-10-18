import type { CompactionEntry, SessionEntry, SessionSummary } from "../../src/kernel/session.ts";
import { afterEach, expect, it } from "vitest";
import {
  api,
  connectEvents,
  type KernelHarness,
  readSessionLog,
  startTestKernel,
} from "./harness.ts";

let harness: KernelHarness | undefined;

afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
});

async function start(
  options: Parameters<typeof startTestKernel>[0] = {},
): Promise<KernelHarness> {
  harness = await startTestKernel(options);
  return harness;
}

async function createSession(url: string, workspace: string): Promise<SessionSummary> {
  const response = await api<{ session: SessionSummary }>(url, "/sessions", {
    method: "POST",
    body: { workspace },
  });
  expect(response.status).toBe(201);
  return response.body.session;
}

async function sendMessage(url: string, sessionId: string, text: string): Promise<void> {
  const response = await api(url, `/sessions/${sessionId}/messages`, {
    method: "POST",
    body: { text },
  });
  expect(response.status).toBe(202);
}

function compactionEntries(entries: SessionEntry[]): CompactionEntry[] {
  return entries.filter((entry): entry is CompactionEntry => entry.type === "compaction");
}

it("compacts a session on request and keeps the original entries", async () => {
  const { kernel, model, workspace, dataDir } = await start({
    compaction: { triggerTokens: 1_000_000, keepTokens: 25 },
    answers: [
      { text: ["one"] },
      { text: ["two"] },
      { text: ["MANUAL-SUMMARY: goal=greet; decisions=none; next=wait."] },
    ],
  });
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);
  // Long user turns, so the tiny kept window holds only the newest message.
  await sendMessage(kernel.url, session.id, "hello ".repeat(40));
  await events.waitFor((event) => event.type === "session.updated" && event.session.entryCount === 2);
  await sendMessage(kernel.url, session.id, "again ".repeat(40));
  await events.waitFor((event) => event.type === "session.updated" && event.session.entryCount === 4);

  const before = await readSessionLog(dataDir, session.id);
  expect(before.map((entry) => entry.type)).toEqual([
    "message",
    "message",
    "message",
    "message",
  ]);

  const compacted = await api<{ compacted: boolean; entryId?: string }>(
    kernel.url,
    `/sessions/${session.id}/compact`,
    { method: "POST" },
  );
  expect(compacted.status).toBe(200);
  expect(compacted.body.compacted).toBe(true);

  const requested = await events.waitFor((event) => event.type === "session.compacted");
  if (requested.type !== "session.compacted") throw new Error("Expected a compaction");
  expect(requested).toMatchObject({
    sessionId: session.id,
    entryId: compacted.body.entryId,
    reason: "manual",
  });

  // The summary came from the session model, as an internal request without tools.
  const summaryRequest = model.requests.at(-1);
  expect(summaryRequest?.tools).toBeUndefined();
  expect(summaryRequest?.messages[0]?.content).toMatch(/summari[sz]e/i);

  const after = await readSessionLog(dataDir, session.id);
  const compactions = compactionEntries(after);
  expect(compactions).toHaveLength(1);
  expect(compactions[0]).toMatchObject({
    id: compacted.body.entryId,
    summary: "MANUAL-SUMMARY: goal=greet; decisions=none; next=wait.",
    firstKeptEntryId: before.at(-1)?.id,
  });
  expect(after.length).toBe(before.length + 1);

  // The original log lines stay readable, and the continued session replays them.
  const served = await api<{ session: SessionSummary; entries: SessionEntry[] }>(
    kernel.url,
    `/sessions/${session.id}`,
  );
  expect(served.body.entries.map((entry) => entry.id)).toEqual(after.map((entry) => entry.id));
  expect(before.every((entry) => after.some((kept) => kept.id === entry.id))).toBe(true);

  // A second request has nothing left to compact.
  const again = await api<{ compacted: boolean }>(
    kernel.url,
    `/sessions/${session.id}/compact`,
    { method: "POST" },
  );
  expect(again.status).toBe(200);
  expect(again.body.compacted).toBe(false);
  events.close();
});

it("refuses manual compaction while a task is running", async () => {
  const { kernel, workspace } = await start({
    compaction: { keepTokens: 25 },
    answers: [{ text: ["thinking..."], hold: true }],
  });
  const session = await createSession(kernel.url, workspace);
  await sendMessage(kernel.url, session.id, "start");

  const refused = await api<{ error: { code: string } }>(
    kernel.url,
    `/sessions/${session.id}/compact`,
    { method: "POST" },
  );
  expect(refused.status).toBe(409);
  expect(refused.body).toMatchObject({ error: { code: "TASK_RUNNING" } });
  await api(kernel.url, `/sessions/${session.id}/cancel`, { method: "POST" });
});
