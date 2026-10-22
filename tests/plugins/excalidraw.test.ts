import type {
  CanvasDocument,
  CanvasScene,
} from "../../plugins/excalidraw/src/scene.ts";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { readBundle } from "../../packages/plugin-manager/src/bundle.ts";
import { buildBundle } from "../../packages/runtime/src/build.ts";
import { CanvasStore } from "../../plugins/excalidraw/src/canvas.ts";
import { emptyCanvasScene } from "../../plugins/excalidraw/src/scene.ts";
import { type RunningUiServer, startUiServer } from "../../src/workbench/ui-server.ts";
import { KernelClient as BaseClient } from "../../src/workbench/ui/client.ts";
import {
  api,
  connectEvents,
  type KernelHarness,
  startTestKernel as startBase,
} from "../kernel/harness.ts";

let distribution: string;
beforeAll(async () => {
  distribution = await mkdtemp(join(tmpdir(), "prism-standard-plugin-"));
  const bundle = await readBundle(resolve("plugins/excalidraw"));
  bundle.manifest.ui = [];
  bundle.manifest.assets = [];
  bundle.manifest.dependencies = { zod: "4.6.5" };
  await buildBundle(
    bundle,
    join(distribution, "excalidraw"),
    resolve("plugins/excalidraw"),
    "test",
    resolve("node_modules"),
  );
});
afterAll(async () => {
  await rm(distribution, { recursive: true, force: true });
});

async function startTestKernel(
  options: Parameters<typeof startBase>[0] = {},
): Promise<KernelHarness> {
  const harness = await startBase({ ...options, bundledPlugins: distribution });
  await harness.kernel.kernel.ctx.creator.manage({
    action: "enable",
    name: "excalidraw",
  });
  return harness;
}

class KernelClient extends BaseClient {
  readCanvas(sessionId: string): Promise<CanvasDocument> {
    return this.pluginRequest(
      "excalidraw",
      "canvas.read",
      sessionId,
      {},
    ) as Promise<CanvasDocument>;
  }
  saveCanvas(
    sessionId: string,
    revision: number,
    scene: CanvasScene,
  ): Promise<CanvasDocument> {
    return this.pluginRequest("excalidraw", "canvas.save", sessionId, {
      revision,
      scene,
    }) as Promise<CanvasDocument>;
  }
}

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
      await events.waitFor(
        (event) => event.type === "plugin.event" && event.name === "canvas.updated",
      ),
    ).toMatchObject({ sessionId: first.id, data: { revision: 1 } });
    const reloaded = new CanvasStore(
      join(harness.dataDir, "plugin-data", "excalidraw"),
      harness.kernel.kernel.ctx.sessions,
      () => {},
    );
    expect(await reloaded.read(first.id)).toEqual(saved);
    expect((await client.readCanvas(second.id)).scene.elements).toEqual([]);
    await client.deleteSession(first.id);
    await expect(
      readFile(
        join(
          harness.dataDir,
          "plugin-data",
          "excalidraw",
          "canvases",
          `${first.id}.json`,
        ),
      ),
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

it("reads legacy session canvases and saves future revisions in plugin-owned storage", async () => {
  harness = await startTestKernel();
  const client = new KernelClient({ baseUrl: harness.kernel.url });
  const session = await client.createSession({ workspace: harness.workspace });
  const legacy = { revision: 7, scene: { ...emptyCanvasScene(), elements: [box] } };
  const directory = join(harness.dataDir, "canvases");
  await mkdir(directory, { recursive: true });
  const original = join(directory, `${session.id}.json`);
  await writeFile(original, JSON.stringify(legacy));
  expect(await client.readCanvas(session.id)).toEqual(legacy);
  const saved = await client.saveCanvas(session.id, 7, {
    ...legacy.scene,
    appState: { viewBackgroundColor: "#eeeeee" },
  });
  expect(saved.revision).toBe(8);
  await harness.kernel.kernel.ctx.creator.manage({
    action: "reload",
    name: "excalidraw",
  });
  expect(await client.readCanvas(session.id)).toEqual(saved);
  expect(JSON.parse(await readFile(original, "utf8"))).toEqual(legacy);
  expect(
    JSON.parse(
      await readFile(
        join(
          harness.dataDir,
          "plugin-data",
          "excalidraw",
          "canvases",
          `${session.id}.json`,
        ),
        "utf8",
      ),
    ),
  ).toEqual(saved);
});

it("rejects simultaneous stale saves and invalid scenes without overwriting valid data", async () => {
  harness = await startTestKernel();
  const client = new KernelClient({ baseUrl: harness.kernel.url });
  const session = await client.createSession({ workspace: harness.workspace });
  const path = "/plugins/excalidraw/rpc/canvas.save";
  const results = await Promise.all(
    [1, 2].map((x) =>
      api(harness!.kernel.url, path, {
        method: "POST",
        body: {
          sessionId: session.id,
          input: {
            revision: 0,
            scene: { ...emptyCanvasScene(), elements: [{ ...box, x }] },
          },
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
          method: "POST",
          body: { sessionId: session.id, input: { revision: 1, scene } },
        })
      ).status,
    ).toBe(400);
    expect(await client.readCanvas(session.id)).toEqual(saved);
  }
  await expect(client.readCanvas("missing-session")).rejects.toMatchObject({
    status: 404,
  });
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
  await ctx.creator.manage({ action: "disable", name: "excalidraw" });
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
  await ctx.creator.manage({ action: "disable", name: "excalidraw" });
  const blocker = ctx.tools.register({
    name: "excalidraw_update",
    description: "Reserve a tool name for this test.",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: "reserved" }),
  });
  try {
    await expect(
      ctx.creator.manage({ action: "enable", name: "excalidraw" }),
    ).rejects.toThrow("already registered");
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
  const store = new CanvasStore(
    join(harness.dataDir, "plugin-data", "excalidraw"),
    harness.kernel.kernel.ctx.sessions,
    () => {},
  );
  const signal = AbortSignal.abort();
  await expect(
    store.update(session.id, { revision: 0, elements: [box] }, signal),
  ).rejects.toThrow();
  expect((await store.read(session.id)).revision).toBe(0);
});
