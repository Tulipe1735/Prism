import type { Context } from "cordis";
import type {
  PluginBundle,
  PluginEvent,
  PluginUiEntry,
} from "../../plugin-sdk/src/index.ts";
import type { BuiltBundle, MountedBundle } from "../../runtime/src/index.ts";
import { randomUUID } from "node:crypto";
import { type FSWatcher, watch } from "node:fs";
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { KernelError } from "../../../src/kernel/errors.ts";
import { buildBundle, mountBundle, readUiAsset } from "../../runtime/src/index.ts";
import { bundleSchema, pluginName, readBundle } from "./bundle.ts";
import { Dependencies } from "./dependencies.ts";

const recordSchema = z
  .object({
    name: pluginName,
    revision: z.string().uuid(),
    stagedRevision: z.string().uuid().optional(),
    stagedDevelopment: z.string().optional(),
    enabled: z.boolean(),
    development: z.string().optional(),
  })
  .strict();
type PluginRecord = z.infer<typeof recordSchema>;

export const pluginActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list") }).strict(),
  z.object({ action: z.literal("inspect"), name: pluginName }).strict(),
  z.object({ action: z.literal("install"), bundle: bundleSchema }).strict(),
  z
    .object({
      action: z.literal("develop"),
      directory: z
        .string()
        .refine(isAbsolute, "Development directory must be absolute"),
    })
    .strict(),
  z
    .object({
      action: z.enum(["enable", "disable", "reload", "remove"]),
      name: pluginName,
    })
    .strict(),
]);
export type PluginAction = z.infer<typeof pluginActionSchema>;

export interface PluginSummary {
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  state: "active" | "installed" | "disabled" | "failed";
  tools: string[];
  ui: string[];
  staged: boolean;
  development?: string;
  error?: string;
}

interface Installed {
  record: PluginRecord;
  build?: BuiltBundle;
  mounted?: MountedBundle;
  watcher?: FSWatcher;
  timer?: ReturnType<typeof setTimeout>;
  error?: string;
}

export class PluginManager {
  readonly directory: string;
  private readonly dependencies: Dependencies;
  private readonly installed = new Map<string, Installed>();
  private readonly removedListeners = new Set<(sessionId: string) => Promise<void>>();
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private readonly ctx: Context;

  constructor(ctx: Context) {
    this.ctx = ctx;
    this.directory = join(ctx.config.dataDir, "plugins");
    this.dependencies = new Dependencies(this.directory);
  }

  async start(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    for (const file of (await readdir(this.directory)).sort()) {
      if (
        !file.endsWith(".json") ||
        !pluginName.safeParse(file.slice(0, -5)).success ||
        file === "dependency-policy.json"
      )
        continue;
      const name = file.slice(0, -5);
      let record: PluginRecord = { name, revision: randomUUID(), enabled: false };
      try {
        const raw = JSON.parse(await readFile(this.recordPath(name), "utf8"));
        if (raw.name !== name)
          throw new Error("Plugin name does not match its filename");
        // A data migration only: the obsolete source-based installation API is removed.
        if (typeof raw.source === "string") {
          const bundle = bundleSchema.parse({
            manifest: {
              schemaVersion: 1,
              name,
              version: "1.0.0",
              description: raw.description,
              backend: "index.js",
            },
            files: { "index.js": raw.source },
          });
          const build = await this.prepare(bundle);
          record = { name, revision: build.revision, enabled: raw.enabled === true };
          await this.persist(record);
        } else record = recordSchema.parse(raw);
        if (record.name !== name)
          throw new Error("Plugin name does not match its filename");
        const build = await this.loadBuild(name, record.revision);
        const item: Installed = { record, build };
        this.installed.set(name, item);
        if (record.enabled) item.mounted = await this.mount(build);
        this.watch(item);
      } catch (error) {
        this.installed.set(name, { record, error: message(error) });
      }
    }
  }

  list(): PluginSummary[] {
    return [...this.installed.values()].map((item) => ({
      name: item.record.name,
      description: item.build?.bundle.manifest.description ?? "Unavailable bundle",
      version: item.build?.bundle.manifest.version ?? "",
      enabled: item.record.enabled,
      state:
        item.mounted !== undefined
          ? "active"
          : item.error !== undefined
            ? "failed"
            : item.record.enabled
              ? "installed"
              : "disabled",
      tools: item.mounted?.tools ?? [],
      ui: (item.mounted?.build.bundle.manifest.ui ?? []).map((ui) => ui.id),
      staged: item.record.stagedRevision !== undefined,
      ...(item.record.development === undefined
        ? {}
        : { development: item.record.development }),
      ...(item.error === undefined ? {} : { error: item.error }),
    }));
  }

  ui(): PluginUiEntry[] {
    return [...this.installed.values()].flatMap(({ mounted }) =>
      mounted === undefined
        ? []
        : (mounted.build.bundle.manifest.ui ?? []).map(({ webApp, ...ui }) => ({
            ...ui,
            plugin: mounted.build.bundle.manifest.name,
            revision: mounted.build.revision,
            url: `/plugins/${mounted.build.bundle.manifest.name}/assets/${mounted.build.revision}/${ui.id}/index.html`,
            ...(webApp === undefined
              ? {}
              : {
                  webApp: {
                    ...webApp,
                    scriptUrl: `/plugins/${mounted.build.bundle.manifest.name}/assets/${mounted.build.revision}/${ui.id}/webapp.js`,
                    styleUrl: `/plugins/${mounted.build.bundle.manifest.name}/assets/${mounted.build.revision}/${ui.id}/webapp.css`,
                  },
                }),
          })),
    );
  }

  manage(input: unknown): Promise<PluginSummary[] | PluginBundle> {
    const parsed = pluginActionSchema.safeParse(input);
    if (!parsed.success)
      return Promise.reject(new KernelError("INVALID_REQUEST", parsed.error.message));
    const action = parsed.data;
    return this.enqueue(async () => {
      try {
        if (action.action === "list") return this.list();
        if (action.action === "install" || action.action === "develop") {
          if (!this.ctx.config.creator.enabled)
            throw new KernelError(
              "CREATOR_DISABLED",
              "Enable Creator Mode before preparing plugin bundles.",
            );
          const development =
            action.action === "develop" ? resolve(action.directory) : undefined;
          const bundle =
            action.action === "install"
              ? action.bundle
              : await readBundle(development!);
          const build = await this.prepare(bundle);
          const current = this.installed.get(bundle.manifest.name);
          const record: PluginRecord =
            current === undefined
              ? { name: bundle.manifest.name, revision: build.revision, enabled: false }
              : { ...current.record, stagedRevision: build.revision };
          if (current === undefined) {
            if (development !== undefined) record.development = development;
          } else {
            delete record.stagedDevelopment;
            if (development !== undefined) record.stagedDevelopment = development;
          }
          await this.persist(record);
          if (current === undefined) this.installed.set(record.name, { record, build });
          else {
            this.stopWatch(current);
            current.record = record;
          }
          await this.prune(this.installed.get(record.name)!);
        } else {
          const item = this.installed.get(action.name);
          if (item === undefined)
            throw new KernelError(
              "PLUGIN_NOT_FOUND",
              `Plugin "${action.name}" is not installed.`,
            );
          if (action.action === "inspect")
            return (
              await this.loadBuild(
                action.name,
                item.record.stagedRevision ?? item.record.revision,
              )
            ).bundle;
          if (action.action === "remove") {
            this.stopWatch(item);
            await item.mounted?.dispose();
            await rm(this.recordPath(action.name), { force: true });
            this.installed.delete(action.name);
            await rm(join(this.directory, "revisions", action.name), {
              recursive: true,
              force: true,
            });
          } else if (action.action === "disable") {
            this.stopWatch(item);
            await this.persist({ ...item.record, enabled: false });
            await item.mounted?.dispose();
            delete item.mounted;
            item.record.enabled = false;
            delete item.error;
          } else {
            if (action.action === "reload" && item.mounted === undefined)
              throw new Error("Enable the plugin before reloading it.");
            if (action.action === "reload" && item.record.development !== undefined)
              await this.reloadDevelopment(item);
            else {
              const build = await this.loadBuild(
                action.name,
                action.action === "enable"
                  ? (item.record.stagedRevision ?? item.record.revision)
                  : item.record.revision,
              );
              await this.activate(item, build, action.action === "enable");
            }
            this.watch(item);
          }
        }
        this.changed();
        return this.list();
      } catch (error) {
        this.changed();
        if (error instanceof KernelError) throw error;
        throw new KernelError("PLUGIN_FAILED", message(error));
      }
    });
  }

  /** Import prebuilt shipped bundles as ordinary disabled installations, with no npm at startup. */
  async discover(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || this.installed.has(entry.name)) continue;
      const distribution = join(directory, entry.name);
      const bundle = bundleSchema.parse(
        JSON.parse(await readFile(join(distribution, "bundle.json"), "utf8")),
      );
      if (bundle.manifest.name !== entry.name)
        throw new Error("Distribution name mismatch");
      const revision = randomUUID();
      const destination = this.buildPath(entry.name, revision);
      await cp(distribution, destination, { recursive: true });
      const record = { name: entry.name, revision, enabled: false };
      await this.persist(record);
      this.installed.set(entry.name, {
        record,
        build: { bundle, revision, directory: destination },
      });
    }
  }

  async request(
    name: string,
    method: string,
    input: unknown,
    sessionId: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    const mounted = this.installed.get(name)?.mounted;
    if (mounted === undefined)
      throw new KernelError("PLUGIN_NOT_FOUND", `Plugin "${name}" is not active.`);
    await this.ctx.sessions.read(sessionId);
    return mounted.request(method, input, { sessionId, signal });
  }

  async asset(
    name: string,
    revision: string,
    id: string,
    path: string,
  ): Promise<Awaited<ReturnType<typeof readUiAsset>>> {
    const mounted = this.installed.get(name)?.mounted;
    if (mounted === undefined || mounted.build.revision !== revision)
      throw new KernelError(
        "PLUGIN_NOT_FOUND",
        "Plugin UI revision is no longer active.",
      );
    try {
      return await readUiAsset(mounted.build, id, path);
    } catch {
      throw new KernelError("PLUGIN_NOT_FOUND", "Plugin asset is unavailable.");
    }
  }

  async sessionRemoved(sessionId: string): Promise<void> {
    await Promise.all(
      [...this.removedListeners].map((listener) => listener(sessionId)),
    );
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const item of this.installed.values()) this.stopWatch(item);
    await this.queue.catch(() => {});
    await Promise.all(
      [...this.installed.values()].map((item) => item.mounted?.dispose()),
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

  private buildPath(name: string, revision: string): string {
    return join(this.directory, "revisions", name, revision);
  }
  private recordPath(name: string): string {
    return join(this.directory, `${name}.json`);
  }
  private changed(): void {
    this.ctx.emit("prism/event", { type: "plugins.updated" });
  }

  private async persist(record: PluginRecord): Promise<void> {
    const temporary = join(this.directory, `.${record.name}-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`);
      await rename(temporary, this.recordPath(record.name));
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private async prepare(bundle: PluginBundle): Promise<BuiltBundle> {
    const dependencies = await this.dependencies.prepare(bundle.manifest);
    const revision = randomUUID();
    const directory = this.buildPath(bundle.manifest.name, revision);
    try {
      return await buildBundle(bundle, directory, dependencies, revision);
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  private async loadBuild(name: string, revision: string): Promise<BuiltBundle> {
    const directory = this.buildPath(name, revision);
    const bundle = bundleSchema.parse(
      JSON.parse(await readFile(join(directory, "bundle.json"), "utf8")),
    );
    if (bundle.manifest.name !== name) throw new Error("Stored bundle name mismatch");
    return { revision, directory, bundle };
  }

  private mount(build: BuiltBundle): Promise<MountedBundle> {
    return mountBundle(
      this.ctx,
      build,
      join(this.ctx.config.dataDir, "plugin-data", build.bundle.manifest.name),
      (event: PluginEvent) => this.ctx.emit("prism/event", event),
      (listener) => {
        this.removedListeners.add(listener);
        return () => {
          this.removedListeners.delete(listener);
        };
      },
    );
  }

  private async activate(
    item: Installed,
    build: BuiltBundle,
    acceptStaged = false,
  ): Promise<void> {
    const previous = item.mounted?.build;
    this.stopWatch(item);
    await item.mounted?.dispose();
    delete item.mounted;
    let mounted: MountedBundle | undefined;
    try {
      mounted = await this.mount(build);
      const record = { ...item.record, revision: build.revision, enabled: true };
      if (acceptStaged && record.stagedRevision !== undefined) {
        delete record.development;
        if (record.stagedDevelopment !== undefined)
          record.development = record.stagedDevelopment;
        delete record.stagedRevision;
        delete record.stagedDevelopment;
      }
      await this.persist(record);
      item.record = record;
      item.build = build;
      item.mounted = mounted;
      delete item.error;
      this.watch(item);
    } catch (error) {
      await mounted?.dispose();
      item.error = message(error);
      if (previous !== undefined) {
        try {
          item.mounted = await this.mount(previous);
        } catch (restoreError) {
          item.error += `; restore failed: ${message(restoreError)}`;
        }
      }
      this.watch(item);
      throw error;
    }
    await this.prune(item);
  }

  private async reloadDevelopment(item: Installed): Promise<void> {
    try {
      const bundle = await readBundle(item.record.development!);
      if (bundle.manifest.name !== item.record.name)
        throw new Error("Development reload cannot change the bundle name");
      await this.activate(item, await this.prepare(bundle));
    } catch (error) {
      item.error = message(error);
      throw error;
    } finally {
      await this.prune(item);
    }
  }

  private async prune(item: Installed): Promise<void> {
    const root = join(this.directory, "revisions", item.record.name);
    const keep = new Set([item.record.revision, item.record.stagedRevision]);
    try {
      for (const revision of await readdir(root))
        if (!keep.has(revision))
          await rm(join(root, revision), { recursive: true, force: true });
    } catch (error) {
      item.error ??= `Old bundle cleanup failed: ${message(error)}`;
    }
  }

  private watch(item: Installed): void {
    if (
      this.closed ||
      item.watcher !== undefined ||
      item.mounted === undefined ||
      item.record.development === undefined
    )
      return;
    try {
      item.watcher = watch(
        item.record.development,
        { recursive: true },
        (_event, filename) => {
          if (
            filename === null ||
            filename
              .split(/[\\/]/)
              .some(
                (part) =>
                  ["node_modules", ".git", "dist", ".prism-build"].includes(part) ||
                  part.startsWith("."),
              )
          )
            return;
          clearTimeout(item.timer);
          item.timer = setTimeout(() => {
            void this.enqueue(async () => {
              if (
                this.closed ||
                this.installed.get(item.record.name) !== item ||
                !item.record.enabled
              )
                return;
              try {
                await this.reloadDevelopment(item);
              } catch {
                /* Previous build remains active; expose the error. */
              }
              this.changed();
            }).catch(() => {});
          }, 150);
        },
      );
      item.watcher.on("error", (error) => {
        item.error = `Development watcher failed: ${message(error)}`;
        this.changed();
      });
    } catch (error) {
      item.error = `Development watcher failed: ${message(error)}`;
    }
  }

  private stopWatch(item: Installed): void {
    clearTimeout(item.timer);
    item.watcher?.close();
    delete item.watcher;
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
