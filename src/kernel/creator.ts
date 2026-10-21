import type { Context, Fiber } from "cordis";
import type { Tool } from "./tool.ts";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { KernelError } from "./errors.ts";

const nameSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const recordSchema = z
  .object({
    name: nameSchema,
    description: z.string().min(1).max(1000),
    source: z.string().min(1).max(64_000),
    enabled: z.boolean(),
  })
  .strict();

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list") }).strict(),
  z.object({ action: z.literal("inspect"), name: nameSchema }).strict(),
  z
    .object({
      action: z.literal("install"),
      name: nameSchema,
      description: z.string().min(1).max(1000),
      source: z.string().min(1).max(64_000),
    })
    .strict(),
  z
    .object({
      action: z.enum(["enable", "disable", "reload", "remove"]),
      name: nameSchema,
    })
    .strict(),
]);

type PluginRecord = z.infer<typeof recordSchema>;
export type PluginAction = z.infer<typeof actionSchema>;

export interface PluginSummary {
  name: string;
  description: string;
  enabled: boolean;
  state: "active" | "disabled" | "failed";
  tools: string[];
  error?: string;
}

interface InstalledPlugin {
  record: PluginRecord;
  fiber?: Fiber;
  tools: string[];
  error?: string;
}

/** The same contract is returned to the model by creator_inspect. */
export const CREATOR_GUIDE = `Creator Mode: turn the user's requested capability into a persistent Prism Cordis plugin.
1. Inspect the runtime with creator_inspect and inspect an existing plugin before editing it.
2. Author a self-contained JavaScript ES module. Export inject (an array of required service names) and apply(ctx). Node built-in imports are supported. Relative imports, npm imports and TypeScript syntax are not supported; call existing tools for external programs instead.
3. Register every tool with ctx.effect(() => ctx.tools.register(tool)). Use ctx.on for events and ctx.effect for resource cleanup. Keep mutable state inside apply. A tool has name, description, parameters (JSON Schema with type: 'object' and properties), optional effects(args, context), and async execute(args, context) returning { content: string, isError?: boolean }.
4. Declare file writes, commands and browser actions in effects. Tool context supplies workspace, sessionId, target, signal and requestApproval. Honour context.signal. A plugin executes trusted code in the kernel process; effects are permission declarations, not an OS sandbox.
5. Call plugin_manager with action='install', name, description and the COMPLETE source. Names use lowercase letters, digits and hyphens and start with a letter. Installation also updates an existing name, activates it immediately and persists it for restart. On failure the previous version is restored; read the error and fix the source.
6. Newly registered tools appear on the NEXT model request. Call the new tool to verify the requested behavior. Do not claim success from installation alone. Do not call a new tool in the same batch as install.
7. plugin_manager also supports list, inspect (includes source), enable, disable, reload and remove. Disabling/removing a plugin withdraws its tools and cancels their running calls. Disabling Creator Mode removes authoring tools; installed enabled plugins continue running.
Available host events: prism/event (KernelEvent notifications). This host does not provide DSH services, DSH UI slots or arbitrary Web UI injection.
Example source:
export const inject = ['tools'];
export function apply(ctx) {
  ctx.effect(() => ctx.tools.register({
    name: 'word_count', description: 'Count whitespace-separated words in text.',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
    async execute(args) {
      if (typeof args.text !== 'string') return { content: 'text must be a string', isError: true };
      return { content: String(args.text.trim() === '' ? 0 : args.text.trim().split(/\\s+/u).length) };
    }
  }));
}`;

/** Owns persistent plugin records and their live Cordis fibers. */
export class Creator {
  private readonly installed = new Map<string, InstalledPlugin>();
  private queue: Promise<unknown> = Promise.resolve();
  private authoringDisposers: (() => Promise<void>)[] = [];
  private closed = false;
  readonly directory: string;
  private readonly ctx: Context;

  constructor(ctx: Context) {
    this.ctx = ctx;
    this.directory = join(ctx.config.dataDir, "plugins");
  }

  async start(): Promise<void> {
    const files = await readdir(this.directory).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    for (const file of files.sort()) {
      if (!file.endsWith(".json") || !nameSchema.safeParse(file.slice(0, -5)).success)
        continue;
      const name = file.slice(0, -5);
      let record: PluginRecord = { name, description: "", source: "", enabled: true };
      try {
        record = recordSchema.parse(
          JSON.parse(await readFile(this.path(name), "utf8")),
        );
        if (record.name !== name)
          throw new Error("Plugin name does not match its filename");
        this.installed.set(
          name,
          record.enabled ? await this.mount(record) : { record, tools: [] },
        );
      } catch (error) {
        this.installed.set(name, { record, tools: [], error: message(error) });
      }
    }
    await this.setEnabled(this.ctx.config.creator.enabled);
  }

  list(): PluginSummary[] {
    return [...this.installed.values()].map(({ record, fiber, tools, error }) => ({
      name: record.name,
      description: record.description,
      enabled: record.enabled,
      state:
        error !== undefined ? "failed" : fiber === undefined ? "disabled" : "active",
      tools,
      ...(error === undefined ? {} : { error }),
    }));
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled && this.authoringDisposers.length === 0) {
      this.authoringDisposers = [
        this.ctx.tools.register(this.inspectionTool()),
        this.ctx.tools.register(this.managerTool()),
      ];
    } else if (!enabled) {
      const disposers = this.authoringDisposers.splice(0);
      await Promise.all(disposers.map((dispose) => dispose()));
    }
  }

  manage(input: unknown): Promise<PluginSummary[] | PluginRecord> {
    const parsed = actionSchema.safeParse(input);
    if (!parsed.success)
      return Promise.reject(new KernelError("INVALID_REQUEST", parsed.error.message));
    const action = parsed.data;
    return this.enqueue(async () => {
      if (action.action === "list") return this.list();
      if (action.action === "install") {
        if (!this.ctx.config.creator.enabled)
          throw new KernelError(
            "CREATOR_DISABLED",
            "Enable Creator Mode in Settings before installing plugins.",
          );
        await this.replace({
          name: action.name,
          description: action.description,
          source: action.source,
          enabled: true,
        });
      } else {
        const current = this.installed.get(action.name);
        if (current === undefined)
          throw new KernelError(
            "PLUGIN_NOT_FOUND",
            `Plugin "${action.name}" is not installed.`,
          );
        if (action.action === "inspect") return { ...current.record };
        if (action.action === "remove") {
          await current.fiber?.dispose();
          await rm(this.path(action.name), { force: true });
          this.installed.delete(action.name);
        } else if (action.action === "disable") {
          const record = { ...current.record, enabled: false };
          await this.persist(record);
          await current.fiber?.dispose();
          this.installed.set(action.name, { record, tools: [] });
        } else {
          await this.replace({ ...current.record, enabled: true });
        }
      }
      return this.list();
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.setEnabled(false);
    await this.queue.catch(() => {});
    await Promise.all(
      [...this.installed.values()].map((item) => item.fiber?.dispose()),
    );
    this.installed.clear();
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed)
      return Promise.reject(
        new KernelError("INVALID_REQUEST", "Plugin manager is stopping."),
      );
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }

  private path(name: string): string {
    return join(this.directory, `${name}.json`);
  }

  private async persist(record: PluginRecord): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const temporary = join(this.directory, `.${record.name}-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, "utf8");
      await rename(temporary, this.path(record.name));
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private async mount(record: PluginRecord): Promise<InstalledPlugin> {
    // Self-contained modules run in source, ESM and the packaged CJS kernel alike.
    const url = `data:text/javascript;base64,${Buffer.from(record.source).toString("base64")}#${randomUUID()}`;
    const module = await import(/* @vite-ignore */ url);
    if (typeof module.apply !== "function")
      throw new Error("Plugin must export apply(ctx).");
    const inject = z.array(z.string().min(1)).parse(module.inject ?? []);
    for (const dependency of inject)
      if (
        dependency === "creator" ||
        this.ctx.root.get(dependency, false) === undefined
      )
        throw new Error(
          `Required service "${dependency}" is unavailable. DSH-specific interfaces are not provided by Prism.`,
        );
    const before = new Set(this.ctx.tools.list().map((tool) => tool.name));
    const fiber = this.ctx.plugin({
      name: `user:${record.name}`,
      inject,
      apply: module.apply,
    });
    try {
      await fiber;
      const added = this.ctx.tools.list().filter((tool) => !before.has(tool.name));
      for (const tool of added) {
        if (tool.name === "creator_inspect" || tool.name === "plugin_manager")
          throw new Error(`Tool name "${tool.name}" is reserved for Creator Mode.`);
        if (
          !/^[\w-]{1,64}$/.test(tool.name) ||
          typeof tool.description !== "string" ||
          tool.parameters?.type !== "object" ||
          typeof tool.parameters.properties !== "object" ||
          typeof tool.execute !== "function"
        )
          throw new Error(
            `Tool "${tool.name}" does not match the Prism tool contract.`,
          );
      }
      return { record, fiber, tools: added.map((tool) => tool.name) };
    } catch (error) {
      await fiber.dispose();
      throw error;
    }
  }

  private async replace(record: PluginRecord): Promise<void> {
    recordSchema.parse(record);
    const previous = this.installed.get(record.name);
    await previous?.fiber?.dispose();
    let next: InstalledPlugin | undefined;
    try {
      next = await this.mount(record);
      await this.persist(record);
      this.installed.set(record.name, next);
    } catch (error) {
      await next?.fiber?.dispose();
      if (previous !== undefined) {
        if (previous.record.enabled && previous.error === undefined) {
          try {
            this.installed.set(record.name, await this.mount(previous.record));
          } catch (restoreError) {
            this.installed.set(record.name, {
              record: previous.record,
              tools: [],
              error: message(restoreError),
            });
          }
        } else this.installed.set(record.name, { ...previous, fiber: undefined });
      }
      throw new KernelError("PLUGIN_FAILED", message(error));
    }
  }

  private inspectionTool(): Tool {
    return {
      name: "creator_inspect",
      description:
        "Inspect Prism's live tools, installed plugins and the complete plugin authoring contract. Call before creating or changing a plugin.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => ({
        content: `${CREATOR_GUIDE}\n\nRuntime:\n${JSON.stringify({
          directory: this.directory,
          tools: this.ctx.tools.list().map(({ name }) => name),
          plugins: this.list(),
        })}`,
      }),
    };
  }

  private managerTool(): Tool {
    return {
      name: "plugin_manager",
      description:
        "Create or update a persistent Cordis plugin and hot-load it immediately; list, inspect, enable, disable, reload or remove installed plugins. Read creator_inspect for the contract. New tools appear on the next model request.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [
              "list",
              "inspect",
              "install",
              "enable",
              "disable",
              "reload",
              "remove",
            ],
          },
          name: {
            type: "string",
            description: "Plugin identifier. Required except for list.",
          },
          description: {
            type: "string",
            description: "What the plugin does. Required for install.",
          },
          source: {
            type: "string",
            description:
              "Complete self-contained JavaScript ES module exporting apply(ctx). Required for install.",
          },
        },
        required: ["action"],
        additionalProperties: false,
      },
      effects: (args) => {
        const action = actionSchema.parse(args);
        return action.action === "list" || action.action === "inspect"
          ? []
          : [
              {
                kind: "command",
                command: `Prism plugin ${action.action} ${action.name}`,
              },
            ];
      },
      execute: async (args) => {
        if (!this.ctx.config.creator.enabled)
          return { content: "Creator Mode is disabled.", isError: true };
        return { content: JSON.stringify(await this.manage(args)) };
      },
    };
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const creator = {
  name: "creator",
  inject: ["config", "tools"],
  async apply(ctx: Context) {
    const service = new Creator(ctx);
    await ctx.effect(async function* () {
      yield ctx.provide("creator", service);
      yield () => service.close();
      await service.start();
    });
  },
};
