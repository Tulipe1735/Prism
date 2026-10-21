import type { Context } from "cordis";
import type { CanvasDocument, CanvasScene } from "../shared/canvas.ts";
import type { SessionStore } from "./session-store.ts";
import type { Tool } from "./tool.ts";
import { Buffer } from "node:buffer";
import { randomInt, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { emptyCanvasScene, MAX_CANVAS_BYTES } from "../shared/canvas.ts";
import { KernelError } from "./errors.ts";

const idSchema = z.string().min(1).max(200);
const elementSchema = z
  .object({
    id: idSchema,
    type: z.enum([
      "rectangle",
      "diamond",
      "ellipse",
      "text",
      "arrow",
      "line",
      "freedraw",
      "image",
      "frame",
      "magicframe",
      "embeddable",
      "iframe",
    ]),
    x: z.number(),
    y: z.number(),
    width: z.number().nonnegative().optional(),
    height: z.number().nonnegative().optional(),
    text: z.string().optional(),
    isDeleted: z.boolean().optional(),
    version: z.number().int().nonnegative().optional(),
  })
  .catchall(z.json());
const sceneSchema = z.object({
  type: z.literal("excalidraw"),
  version: z.literal(2),
  source: z.string(),
  elements: z.array(elementSchema).max(10_000),
  appState: z.record(z.string(), z.json()),
  files: z.record(z.string(), z.json()),
});
const saveSchema = z.object({
  revision: z.number().int().nonnegative(),
  scene: sceneSchema,
});
const updateSchema = z.object({
  revision: z.number().int().nonnegative(),
  elements: z
    .array(elementSchema.partial().required({ id: true }))
    .max(100)
    .default([]),
  deleteIds: z.array(idSchema).max(100).default([]),
});

/**
 * Excalidraw discards a text element whose width and height are both zero, and
 * both the editor and the agent can produce text before anything has measured
 * it. Dropping those zeros stores the text as unmeasured, so restoring it with
 * refreshDimensions measures it instead of silently losing the element.
 */
function withoutUnmeasuredSize(
  element: Record<string, unknown>,
): Record<string, unknown> {
  const unmeasured =
    element.type === "text" &&
    element.isDeleted !== true &&
    (element.width === undefined || element.width === 0) &&
    (element.height === undefined || element.height === 0) &&
    typeof element.text === "string" &&
    element.text.length > 0;
  if (!unmeasured) return element;
  const { width: _width, height: _height, ...measured } = element;
  return measured;
}

/** One persisted scene per session, with revision checks shared by UI and tools. */
export class CanvasStore {
  private readonly directory: string;
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly sessions: SessionStore;
  private readonly notify: (sessionId: string, revision: number) => void;

  constructor(
    dataDir: string,
    sessions: SessionStore,
    notify: (sessionId: string, revision: number) => void,
  ) {
    this.directory = join(dataDir, "canvases");
    this.sessions = sessions;
    this.notify = notify;
  }

  async read(sessionId: string): Promise<CanvasDocument> {
    await this.pending.get(sessionId)?.catch(() => {});
    return this.load(sessionId);
  }

  save(sessionId: string, input: unknown): Promise<CanvasDocument> {
    const parsed = saveSchema.safeParse(input);
    if (!parsed.success) throw new KernelError("INVALID_REQUEST", parsed.error.message);
    return this.enqueue(sessionId, async () => {
      const current = await this.load(sessionId);
      this.checkRevision(current, parsed.data.revision);
      return this.commit(sessionId, current.revision + 1, parsed.data.scene);
    });
  }

  update(sessionId: string, input: unknown): Promise<CanvasDocument> {
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) throw new KernelError("INVALID_REQUEST", parsed.error.message);
    return this.enqueue(sessionId, async () => {
      const current = await this.load(sessionId);
      this.checkRevision(current, parsed.data.revision);
      const elements = new Map(current.scene.elements.map((item) => [item.id, item]));
      for (const patch of parsed.data.elements) {
        const previous = elements.get(patch.id);
        const element = elementSchema.safeParse({
          ...previous,
          ...patch,
          version: Number(previous?.version ?? 0) + 1,
          versionNonce: randomInt(0x7fff_ffff),
          updated: Date.now(),
        });
        if (!element.success)
          throw new KernelError("INVALID_REQUEST", element.error.message);
        elements.set(patch.id, element.data);
      }
      for (const id of parsed.data.deleteIds) {
        const element = elements.get(id);
        if (element !== undefined)
          elements.set(id, {
            ...element,
            isDeleted: true,
            version: Number(element.version ?? 0) + 1,
            versionNonce: randomInt(0x7fff_ffff),
          });
      }
      return this.commit(sessionId, current.revision + 1, {
        ...current.scene,
        elements: [...elements.values()],
      });
    });
  }

  removeSession(sessionId: string): Promise<void> {
    return this.enqueue(sessionId, async () => {
      await rm(join(this.directory, `${sessionId}.json`), { force: true });
    });
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.pending.values());
  }

  private async load(sessionId: string): Promise<CanvasDocument> {
    // Validate session existence before using its ID in a path, including on writes.
    await this.sessions.read(sessionId);
    const raw = await readFile(join(this.directory, `${sessionId}.json`), "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );
    if (raw === null) return { revision: 0, scene: emptyCanvasScene() };
    return saveSchema.parse(JSON.parse(raw));
  }

  private checkRevision(current: CanvasDocument, revision: number): void {
    if (current.revision !== revision)
      throw new KernelError(
        "CANVAS_CONFLICT",
        "画布已有更新。请先读取最新画布，再应用修改；本次内容未覆盖已保存的版本。",
      );
  }

  private async commit(
    sessionId: string,
    revision: number,
    scene: CanvasScene,
  ): Promise<CanvasDocument> {
    const parsed = sceneSchema.safeParse(scene);
    if (!parsed.success) throw new KernelError("INVALID_REQUEST", parsed.error.message);
    const elements = parsed.data.elements.map(withoutUnmeasuredSize);
    const ids = elements.map((element) => element.id);
    if (new Set(ids).size !== ids.length)
      throw new KernelError("INVALID_REQUEST", "画布中存在重复的元素 ID。");
    const document: CanvasDocument = { revision, scene: { ...parsed.data, elements } };
    const content = JSON.stringify(document);
    if (Buffer.byteLength(content) > MAX_CANVAS_BYTES)
      throw new KernelError("INVALID_REQUEST", "画布不能超过 20 MB。");
    await mkdir(this.directory, { recursive: true });
    const temporary = join(this.directory, `${sessionId}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, content, { flag: "wx" });
      await rename(temporary, join(this.directory, `${sessionId}.json`));
    } finally {
      await rm(temporary, { force: true });
    }
    this.notify(sessionId, revision);
    return document;
  }

  private enqueue<T>(sessionId: string, action: () => Promise<T>): Promise<T> {
    const next = (this.pending.get(sessionId) ?? Promise.resolve())
      .catch(() => {})
      .then(action);
    this.pending.set(sessionId, next);
    void next
      .finally(() => {
        if (this.pending.get(sessionId) === next) this.pending.delete(sessionId);
      })
      .catch(() => {});
    return next;
  }
}

export function createCanvasTools(store: CanvasStore): Tool[] {
  return [
    {
      name: "excalidraw_read",
      description:
        "Read this session's editable Excalidraw canvas before drawing or changing it. Returns revision, total, and paginated native elements. Use offset/limit for large drawings. Coordinates are canvas pixels. The user can edit the same canvas in the workbench.",
      parameters: {
        type: "object",
        properties: {
          offset: { type: "integer", minimum: 0 },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
        additionalProperties: false,
      },
      async execute(args, context) {
        const page = z
          .object({
            offset: z.number().int().nonnegative().default(0),
            limit: z.number().int().min(1).max(50).default(20),
          })
          .parse(args);
        const { revision, scene } = await store.read(context.sessionId);
        const elements = scene.elements.filter((item) => item.isDeleted !== true);
        return {
          content: JSON.stringify({
            revision,
            total: elements.length,
            elements: elements.slice(page.offset, page.offset + page.limit),
            nextOffset:
              page.offset + page.limit < elements.length
                ? page.offset + page.limit
                : null,
          }),
        };
      },
    },
    {
      name: "excalidraw_update",
      description:
        'Create or modify this session\'s Excalidraw canvas, then the user can edit and export it. First read the current revision. Send native Excalidraw element objects in elements: existing IDs merge only supplied fields; new IDs require type, x, y. Shapes use width/height, strokeColor, backgroundColor, fillStyle. Text requires text, fontSize and optionally containerId; create text as its own element, not a shape label. Arrows use points:[[0,0],[dx,dy]], endArrowhead:"arrow" and optional startBinding/endBinding. Example: {revision:0,elements:[{id:"box",type:"rectangle",x:100,y:100,width:200,height:100},{id:"title",type:"text",x:125,y:135,text:"开始",fontSize:24}]}. deleteIds removes specified elements. On conflict, read again and reapply only the intended changes.',
      parameters: {
        type: "object",
        properties: {
          revision: { type: "integer", minimum: 0 },
          elements: {
            type: "array",
            maxItems: 100,
            items: {
              type: "object",
              properties: { id: { type: "string" } },
              required: ["id"],
              additionalProperties: true,
            },
          },
          deleteIds: { type: "array", items: { type: "string" }, maxItems: 100 },
        },
        required: ["revision"],
        additionalProperties: false,
      },
      effects: () => [
        { kind: "command", command: "Update the session's Excalidraw canvas" },
      ],
      async execute(args, context) {
        context.signal.throwIfAborted();
        const document = await store.update(context.sessionId, args);
        return {
          content: JSON.stringify({
            revision: document.revision,
            total: document.scene.elements.filter((item) => item.isDeleted !== true)
              .length,
            message: "画布已更新，可在工作台打开画板继续编辑和导出。",
          }),
        };
      },
    },
  ];
}

export const canvas = {
  name: "excalidraw",
  inject: ["config", "sessions", "tools"],
  apply(ctx: Context) {
    const store = new CanvasStore(
      ctx.config.dataDir,
      ctx.sessions,
      (sessionId, revision) =>
        ctx.emit("prism/event", { type: "canvas.updated", sessionId, revision }),
    );
    ctx.effect(function* () {
      yield ctx.provide("canvas", store);
      yield () => store.close();
      for (const tool of createCanvasTools(store)) yield ctx.tools.register(tool);
    });
  },
};
