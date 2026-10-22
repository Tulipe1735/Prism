import type { KernelEvent } from "../../src/kernel/events.ts";
import { afterEach, expect, it } from "vitest";
import { readSseFrames } from "../../src/shared/sse.ts";
import { type RunningUiServer, startUiServer } from "../../src/workbench/ui-server.ts";
import { KernelClient } from "../../src/workbench/ui/client.ts";
import { type KernelHarness, startTestKernel } from "../kernel/harness.ts";

let harness: KernelHarness;
let ui: RunningUiServer | undefined;
afterEach(async () => {
  await ui?.close();
  ui = undefined;
  await harness?.cleanup();
});

it("replays missed events through the UI proxy and signals expired or foreign cursors", async () => {
  harness = await startTestKernel();
  ui = await startUiServer({
    kernelUrl: harness.kernel.url,
    uiRoot: harness.workspace,
  });
  const client = new KernelClient({ baseUrl: `${ui.url}/kernel` });
  const first = await fetch(`${ui.url}/kernel/events`, {
    signal: AbortSignal.timeout(10_000),
  });
  const reader = readSseFrames(first.body!);
  expect(JSON.parse((await reader.next()).value!.data)).toMatchObject({
    type: "kernel.status",
  });
  const session = await client.createSession({ workspace: harness.workspace });
  const frame = (await reader.next()).value!;
  expect(JSON.parse(frame.data)).toMatchObject({
    type: "session.updated",
    session: { id: session.id },
  });
  expect(frame.id).toBeDefined();
  await reader.return(undefined);

  await client.renameSession(session.id, "离线期间的修改");
  const replay = await fetch(`${ui.url}/kernel/events`, {
    headers: { "last-event-id": frame.id! },
    signal: AbortSignal.timeout(10_000),
  });
  const resumed = readSseFrames(replay.body!);
  const missed = (await resumed.next()).value!;
  expect(JSON.parse(missed.data)).toMatchObject({
    type: "session.updated",
    session: { title: "离线期间的修改" },
  });
  expect(missed.id).not.toBe(frame.id);
  await resumed.return(undefined);

  for (let index = 0; index < 513; index++)
    harness.kernel.kernel.emit({ type: "plugins.updated" });
  for (const cursor of [frame.id!, "previous-process:1"]) {
    const response = await fetch(`${ui.url}/kernel/events`, {
      headers: { "last-event-id": cursor },
      signal: AbortSignal.timeout(10_000),
    });
    const events = readSseFrames(response.body!);
    expect(JSON.parse((await events.next()).value!.data)).toEqual({
      type: "stream.reset",
    });
    await events.return(undefined);
  }
});

it("reconnects with the last delivered cursor and stops reconnecting after close", async () => {
  const requests: RequestInit[] = [];
  const events: KernelEvent[] = [];
  const client = new KernelClient({
    fetchImpl: async (_input, init) => {
      requests.push(init ?? {});
      return new Response(
        `id: cursor-${requests.length}\ndata: {"type":"plugins.updated"}\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  const close = client.openEvents({
    onEvent: (event) => {
      events.push(event);
      if (events.length === 2) close();
    },
  });
  try {
    await expect.poll(() => events.length, { timeout: 5_000 }).toBe(2);
    expect(requests[0]?.headers).toEqual({ accept: "text/event-stream" });
    expect(requests[1]?.headers).toEqual({
      accept: "text/event-stream",
      "last-event-id": "cursor-1",
    });
    expect(requests).toHaveLength(2);
  } finally {
    close();
  }
});

it("preserves UTF-8 and CRLF delimiters split between binary chunks", async () => {
  const bytes = new TextEncoder().encode(
    'id: example\r\ndata: {"text":"中文"}\r\n\r\n',
  );
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  });
  const frames = [];
  for await (const frame of readSseFrames(body)) frames.push(frame);
  expect(frames).toEqual([{ id: "example", data: '{"text":"中文"}' }]);
});
