import type { CanvasDocument } from "../../src/shared/canvas.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { canvas, CanvasStore } from "../../src/kernel/canvas.ts";
import { emptyCanvasScene } from "../../src/shared/canvas.ts";
import { type RunningUiServer, startUiServer } from "../../src/workbench/ui-server.ts";
import { KernelClient } from "../../src/workbench/ui/client.ts";
import { api, connectEvents, type KernelHarness, startTestKernel } from "./harness.ts";

let harness: KernelHarness | undefined;
let ui: RunningUiServer | undefined;
afterEach(async () => {
  await ui?.close();
  await harness?.cleanup();
  ui = undefined;
  harness = undefined;
});

const box = { id: "node", type: "rectangle", x: 100, y: 80, width: 180, height: 90 };

it("persists isolated session canvases, publishes committed updates and removes deleted session data", async () => {
  harness = await startTestKernel();
  const client = new KernelClient({ baseUrl: harness.kernel.url });
  const first = await client.createSession({ workspace: harness.workspace });
  const second = await client.createSession({ workspace: harness.workspace });
  const events = await connectEvents(`${harness.kernel.url}/events`);
  try {
    expect(await client.readCanvas(first.id)).toMatchObject({
      revision: 0,
      scene: { elements: [] },
    });
    const saved = await client.saveCanvas(first.id, 0, {
      ...emptyCanvasScene(),
      elements: [box],
    });
    expect(saved.revision).toBe(1);
    expect(
      await events.waitFor((event) => event.type === "canvas.updated"),
    ).toMatchObject({ sessionId: first.id, revision: 1 });
    const reloaded = new CanvasStore(
      harness.dataDir,
      harness.kernel.kernel.ctx.sessions,
      () => {},
    );
    expect(await reloaded.read(first.id)).toEqual(saved);
    expect((await client.readCanvas(second.id)).scene.elements).toEqual([]);
    await client.deleteSession(first.id);
    await expect(
      readFile(join(harness.dataDir, "canvases", `${first.id}.json`)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(client.readCanvas(first.id)).rejects.toMatchObject({ status: 404 });
  } finally {
    events.close();
  }
});

it("stores unmeasured text without the zero size Excalidraw treats as invisible", async () => {
  harness = await startTestKernel();
  const client = new KernelClient({ baseUrl: harness.kernel.url });
  const session = await client.createSession({ workspace: harness.workspace });
  const saved = await client.saveCanvas(session.id, 0, {
    ...emptyCanvasScene(),
    elements: [
      {
        id: "label",
        type: "text",
        x: 10,
        y: 20,
        width: 0,
        height: 0,
        text: "会话画布",
      },
      { id: "empty", type: "text", x: 10, y: 90, width: 0, height: 0, text: "" },
      box,
    ],
  });
  const [label, empty] = saved.scene.elements;
  expect(label).toMatchObject({ id: "label", text: "会话画布" });
  expect(label).not.toHaveProperty("width");
  expect(label).not.toHaveProperty("height");
  // A hidden empty text keeps the zeros it was saved with.
  expect(empty).toMatchObject({ id: "empty", width: 0, height: 0 });
  expect((await client.readCanvas(session.id)).scene.elements[0]).toEqual(label);
});

it("rejects simultaneous stale saves and invalid scenes without overwriting valid data", async () => {
  harness = await startTestKernel();
  const client = new KernelClient({ baseUrl: harness.kernel.url });
  const session = await client.createSession({ workspace: harness.workspace });
  const path = `/sessions/${session.id}/canvas`;
  const results = await Promise.all(
    [1, 2].map((x) =>
      api(harness!.kernel.url, path, {
        method: "PUT",
        body: {
          revision: 0,
          scene: { ...emptyCanvasScene(), elements: [{ ...box, x }] },
        },
      }),
    ),
  );
  expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  const saved = await client.readCanvas(session.id);
  for (const scene of [
    { ...emptyCanvasScene(), elements: [box, box] },
    { ...emptyCanvasScene(), elements: [{ ...box, x: "invalid" }] },
    { ...emptyCanvasScene(), elements: [{ ...box, type: "arrow" }] },
  ]) {
    expect(
      (
        await api(harness.kernel.url, path, {
          method: "PUT",
          body: { revision: 1, scene },
        })
      ).status,
    ).toBe(400);
    expect(await client.readCanvas(session.id)).toEqual(saved);
  }
  expect(
    (await api(harness.kernel.url, "/sessions/missing-session/canvas")).status,
  ).toBe(404);
});

it("lets the agent read, add, patch and delete canvas elements, with plugin cleanup", async () => {
  harness = await startTestKernel({
    answers: [
      { toolCalls: [{ id: "read", name: "excalidraw_read", arguments: "{}" }] },
      {
        respond: (request) => {
          const read = JSON.parse(
            [...request.messages].reverse().find((message) => message.role === "tool")!
              .content!,
          );
          expect(read).toMatchObject({ revision: 0, total: 0 });
          return {
            toolCalls: [
              {
                id: "draw",
                name: "excalidraw_update",
                arguments: JSON.stringify({ revision: read.revision, elements: [box] }),
              },
            ],
          };
        },
      },
      {
        toolCalls: [
          {
            id: "patch",
            name: "excalidraw_update",
            arguments: JSON.stringify({
              revision: 1,
              backgroundColor: "#f8f9fa",
              elements: [
                { id: "node", backgroundColor: "#a5d8ff" },
                {
                  id: "label",
                  type: "text",
                  text: "开始",
                  x: 120,
                  y: 110,
                  fontSize: 24,
                },
              ],
            }),
          },
        ],
      },
      {
        toolCalls: [
          {
            id: "delete",
            name: "excalidraw_update",
            arguments: JSON.stringify({ revision: 2, deleteIds: ["node"] }),
          },
        ],
      },
      { text: ["画布已更新。"] },
    ],
  });
  const client = new KernelClient({ baseUrl: harness.kernel.url });
  const session = await client.createSession({ workspace: harness.workspace });
  await client.sendMessage(session.id, "画一张图");
  await harness.kernel.kernel.ctx.tasks.settle(session.id);
  const document: CanvasDocument = await client.readCanvas(session.id);
  expect(document).toMatchObject({
    revision: 3,
    scene: {
      appState: { viewBackgroundColor: "#f8f9fa" },
      elements: [
        { id: "node", isDeleted: true, backgroundColor: "#a5d8ff" },
        { id: "label", text: "开始" },
      ],
    },
  });
  const ctx = harness.kernel.kernel.ctx;
  await [...ctx.registry.get(canvas)!.fibers][0]!.dispose();
  expect(ctx.tools.get("excalidraw_read")).toBeUndefined();
  expect(ctx.tools.get("excalidraw_update")).toBeUndefined();
});

it("refuses agent drawing under read-only permissions", async () => {
  harness = await startTestKernel({
    scope: "read-only",
    answers: [
      {
        toolCalls: [
          {
            id: "draw",
            name: "excalidraw_update",
            arguments: JSON.stringify({ revision: 0, elements: [box] }),
          },
        ],
      },
      { text: ["当前权限不允许修改。"] },
    ],
  });
  const client = new KernelClient({ baseUrl: harness.kernel.url });
  const session = await client.createSession({ workspace: harness.workspace });
  await client.sendMessage(session.id, "画一张图");
  await harness.kernel.kernel.ctx.tasks.settle(session.id);
  expect((await client.readCanvas(session.id)).revision).toBe(0);
  expect((await client.readSession(session.id)).entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "tool_result",
        isError: true,
        content: expect.stringContaining("read-only"),
      }),
    ]),
  );
});

it("proxies scenes with embedded images larger than the ordinary request limit", async () => {
  harness = await startTestKernel();
  ui = await startUiServer({
    kernelUrl: harness.kernel.url,
    uiRoot: "src/workbench/ui",
  });
  const client = new KernelClient({ baseUrl: `${ui.url}/kernel` });
  const session = await client.createSession({ workspace: harness.workspace });
  const scene = {
    ...emptyCanvasScene(),
    elements: [box],
    files: { image: { dataURL: `data:image/png;base64,${"a".repeat(1_100_000)}` } },
  };
  await client.saveCanvas(session.id, 0, scene);
  expect((await client.readCanvas(session.id)).scene.files).toEqual(scene.files);
});

it("cleans up partial registration when a canvas tool name collides", async () => {
  harness = await startTestKernel();
  const ctx = harness.kernel.kernel.ctx;
  await [...ctx.registry.get(canvas)!.fibers][0]!.dispose();
  const blocker = ctx.tools.register({
    name: "excalidraw_update",
    description: "Reserve a tool name for this test.",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: "reserved" }),
  });
  try {
    await expect(ctx.plugin(canvas)).rejects.toThrow("already registered");
    expect(ctx.tools.get("excalidraw_read")).toBeUndefined();
    expect(ctx.get("canvas")).toBeUndefined();
  } finally {
    await blocker();
  }
});

it("cancels a queued agent change before committing it", async () => {
  harness = await startTestKernel();
  const session = await harness.kernel.kernel.createSession({
    workspace: harness.workspace,
  });
  const store = harness.kernel.kernel.ctx.canvas;
  const signal = AbortSignal.abort();
  await expect(
    store.update(session.id, { revision: 0, elements: [box] }, signal),
  ).rejects.toThrow();
  expect((await store.read(session.id)).revision).toBe(0);
});
