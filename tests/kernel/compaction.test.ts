import type {
  CompactionEntry,
  SessionEntry,
  SessionSummary,
} from "../../src/kernel/session.ts";
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

async function sendMessage(
  url: string,
  sessionId: string,
  text: string,
): Promise<void> {
  const response = await api(url, `/sessions/${sessionId}/messages`, {
    method: "POST",
    body: { text },
  });
  expect(response.status).toBe(202);
}

function compactionEntries(entries: SessionEntry[]): CompactionEntry[] {
  return entries.filter(
    (entry): entry is CompactionEntry => entry.type === "compaction",
  );
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
  await events.waitFor(
    (event) => event.type === "session.updated" && event.session.entryCount === 2,
  );
  await sendMessage(kernel.url, session.id, "again ".repeat(40));
  await events.waitFor(
    (event) => event.type === "session.updated" && event.session.entryCount === 4,
  );

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
  // The log update that carries the entry comes before the compaction event.
  const updatedIndex = events.events.findIndex(
    (event) => event.type === "session.updated" && event.session.entryCount === 5,
  );
  const compactedIndex = events.events.findIndex(
    (event) => event.type === "session.compacted",
  );
  expect(updatedIndex).toBeGreaterThanOrEqual(0);
  expect(compactedIndex).toBeGreaterThan(updatedIndex);

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
  expect(served.body.entries.map((entry) => entry.id)).toEqual(
    after.map((entry) => entry.id),
  );
  expect(before.every((entry) => after.some((kept) => kept.id === entry.id))).toBe(
    true,
  );

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
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);
  await sendMessage(kernel.url, session.id, "start");
  // The task is running once the model has streamed its first text.
  await events.waitFor((event) => event.type === "message.delta");

  const refused = await api<{ error: { code: string } }>(
    kernel.url,
    `/sessions/${session.id}/compact`,
    { method: "POST" },
  );
  expect(refused.status).toBe(409);
  expect(refused.body).toMatchObject({ error: { code: "TASK_RUNNING" } });
  await api(kernel.url, `/sessions/${session.id}/cancel`, { method: "POST" });
  events.close();
});

it("reports a failed summary and continues with the full history", async () => {
  const long = "B".repeat(2_000);
  const { kernel, model, workspace, dataDir } = await start({
    compaction: { triggerTokens: 100, keepTokens: 700 },
    answers: [
      { text: [long] },
      { status: 500 },
      { toolCalls: [{ id: "call_1", name: "echo", arguments: '{"text":"pong"}' }] },
      { text: ["Done anyway."] },
    ],
  });
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);
  await sendMessage(kernel.url, session.id, "first turn ".repeat(40));
  await events.waitFor(
    (event) => event.type === "session.updated" && event.session.entryCount === 2,
  );

  await sendMessage(kernel.url, session.id, "carry on ".repeat(60));
  await events.waitFor(
    (event) => event.type === "session.updated" && event.session.entryCount === 7,
  );

  const log = await readSessionLog(dataDir, session.id);
  expect(compactionEntries(log)).toHaveLength(0);
  const failure = log.find(
    (entry) => entry.type === "message" && entry.role === "system",
  );
  expect((failure as { content: string }).content).toMatch(/compaction failed/i);
  expect((failure as { content: string }).content).toContain("HTTP 500");
  expect(log.at(-1)).toMatchObject({ role: "assistant", content: "Done anyway." });

  // The summary is attempted once per task; the failed run keeps the full history.
  const internal = model.requests.filter((request) => request.tools === undefined);
  expect(internal).toHaveLength(1);
  const round = model.requests[2];
  expect(round?.messages.map((message) => message.content).join("\n")).toContain(long);
  events.close();
});

it("compacts automatically near the context limit and carries the session on", async () => {
  const long = "A".repeat(2_000);
  const { kernel, model, workspace, dataDir } = await start({
    compaction: { triggerTokens: 100, keepTokens: 700 },
    answers: [
      { text: [long] },
      { text: ["SUMMARY-MARKER: goal=long answer; next=carry on."] },
      { text: ["Done."] },
    ],
  });
  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);
  await sendMessage(kernel.url, session.id, "first turn ".repeat(40));
  await events.waitFor(
    (event) => event.type === "session.updated" && event.session.entryCount === 2,
  );
  const original = await readSessionLog(dataDir, session.id);

  await sendMessage(kernel.url, session.id, "carry on ".repeat(60));
  const compacted = await events.waitFor((event) => event.type === "session.compacted");
  expect(compacted).toMatchObject({ sessionId: session.id, reason: "auto" });
  await events.waitFor(
    (event) => event.type === "session.updated" && event.session.entryCount === 5,
  );

  // One internal summary call without tools, then the next task round.
  expect(model.requests).toHaveLength(3);
  const summaryRequest = model.requests[1];
  const summarized = summaryRequest?.messages
    .map((message) => message.content)
    .join("\n");
  expect(summaryRequest?.tools).toBeUndefined();
  expect(summaryRequest?.messages[0]?.content).toMatch(/summari[sz]e/i);
  // The replaced turn is summarized; the newest history stays verbatim.
  expect(summarized).toContain("first turn");
  expect(summarized).not.toContain(long);

  const round = model.requests[2];
  expect(round?.messages.map((message) => message.content).join("\n")).toContain(long);
  const summaries = round?.messages.filter(
    (message) =>
      message.role === "system" && (message.content ?? "").includes("SUMMARY-MARKER"),
  );
  expect(summaries).toHaveLength(1);

  const log = await readSessionLog(dataDir, session.id);
  expect(log.map((entry) => entry.type)).toEqual([
    "message",
    "message",
    "message",
    "compaction",
    "message",
  ]);
  expect(compactionEntries(log)[0]).toMatchObject({
    summary: "SUMMARY-MARKER: goal=long answer; next=carry on.",
    firstKeptEntryId: log[1]?.id,
  });
  // The task continued after the compaction and nothing was dropped from disk.
  expect(log.at(-1)).toMatchObject({ role: "assistant", content: "Done." });
  expect(log).toHaveLength(5);
  expect(original.every((entry) => log.some((kept) => kept.id === entry.id))).toBe(
    true,
  );
  events.close();
});
