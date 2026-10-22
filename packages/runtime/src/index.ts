import type { Context, Fiber } from "cordis";
import type { Tool } from "../../../src/kernel/tool.ts";
import type {
  BundleApi,
  BundlePlugin,
  PluginEvent,
  RpcContext,
} from "../../plugin-sdk/src/index.ts";
import type { BuiltBundle } from "./build.ts";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, join } from "node:path";
import { PluginError } from "../../plugin-sdk/src/index.ts";

export { buildBundle } from "./build.ts";
export type { BuiltBundle } from "./build.ts";

export interface MountedBundle {
  build: BuiltBundle;
  tools: string[];
  request: (method: string, input: unknown, context: RpcContext) => Promise<unknown>;
  dispose: () => Promise<void>;
}

/** Cordis owns effects; this adapter adds only bundle-scoped RPC and notifications. */
export async function mountBundle(
  ctx: Context,
  build: BuiltBundle,
  dataDir: string,
  emit: (event: PluginEvent) => void,
  onSessionRemoved: BundleApi["onSessionRemoved"],
): Promise<MountedBundle> {
  const load = createRequire(import.meta.url);
  const entry = load.resolve(join(build.directory, "build/backend.cjs"));
  delete load.cache[entry];
  const module = load(entry) as BundlePlugin;
  const invalid = (reason: string): never => {
    delete load.cache[entry];
    throw new Error(reason);
  };
  if (typeof module.apply !== "function")
    invalid("Plugin must export apply(ctx, api).");
  if (
    module.inject !== undefined &&
    (!Array.isArray(module.inject) ||
      module.inject.some((item) => typeof item !== "string"))
  )
    invalid("Plugin inject must be an array of service names.");
  for (const dependency of module.inject ?? [])
    if (dependency === "creator" || ctx.root.get(dependency, false) === undefined)
      invalid(`Required service "${dependency}" is unavailable.`);
  const routes = new Map<
    string,
    (input: unknown, context: RpcContext) => Promise<unknown>
  >();
  const calls = new Set<{ controller: AbortController; settled: Promise<void> }>();
  const cleanups = new Set<() => void>();
  let disposed = false;
  const tools: string[] = [];
  const toolDisposers: (() => Promise<void>)[] = [];
  const registry = new Proxy(ctx.tools, {
    get(target, property) {
      if (property === "register")
        return (tool: Tool): (() => Promise<void>) => {
          if (["creator_inspect", "plugin_manager"].includes(tool.name))
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
          if (disposed) throw new Error("Plugin is stopping.");
          const stop = target.register(tool);
          toolDisposers.push(stop);
          tools.push(tool.name);
          return stop;
        };
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await mkdir(dataDir, { recursive: true });
  const api: BundleApi = {
    dataDir,
    rpc: {
      register(name, handler) {
        if (
          !/^[a-z][a-z0-9._-]{0,63}$/.test(name) ||
          routes.has(name) ||
          typeof handler !== "function"
        )
          throw new Error(`Invalid or duplicate plugin RPC: ${name}`);
        routes.set(name, handler);
        return async () => {
          if (routes.get(name) === handler) routes.delete(name);
        };
      },
    },
    emit: (name, data, sessionId) => {
      if (!disposed)
        emit({
          type: "plugin.event",
          plugin: build.bundle.manifest.name,
          name,
          data,
          ...(sessionId === undefined ? {} : { sessionId }),
        });
    },
    onSessionRemoved(listener) {
      const stop = onSessionRemoved(listener);
      cleanups.add(stop);
      return () => {
        cleanups.delete(stop);
        stop();
      };
    },
  };
  let fiber: Fiber | undefined;
  async function dispose(): Promise<void> {
    disposed = true;
    routes.clear();
    for (const stop of cleanups) stop();
    cleanups.clear();
    for (const call of calls) call.controller.abort();
    await Promise.all(
      [...calls]
        .map((call) => call.settled)
        .concat(toolDisposers.map((stop) => stop())),
    );
    await fiber?.dispose();
    if (load.cache[entry]?.exports === module) delete load.cache[entry];
  }
  try {
    fiber = ctx.plugin({
      name: `bundle:${build.bundle.manifest.name}`,
      inject: module.inject ?? [],
      apply: (child: Context) =>
        module.apply(
          new Proxy(child, {
            get(target, property, receiver) {
              return property === "tools"
                ? registry
                : Reflect.get(target, property, receiver);
            },
          }),
          api,
        ),
    });
    await fiber;
    return {
      build,
      tools,
      dispose,
      async request(method, input, context) {
        const handler = routes.get(method);
        if (disposed || handler === undefined)
          throw new PluginError(
            "RPC_NOT_FOUND",
            `Plugin RPC is unavailable: ${method}`,
            404,
          );
        const controller = new AbortController();
        const execution = Promise.resolve().then(() => {
          context.signal.throwIfAborted();
          return handler(input, {
            ...context,
            signal: AbortSignal.any([context.signal, controller.signal]),
          });
        });
        const call = {
          controller,
          settled: execution.then(
            () => {},
            () => {},
          ),
        };
        calls.add(call);
        try {
          return await execution;
        } finally {
          calls.delete(call);
        }
      },
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}

export const PLUGIN_CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

export async function readUiAsset(
  build: BuiltBundle,
  id: string,
  path: string,
): Promise<{ content: Uint8Array; contentType: string }> {
  if (
    !(build.bundle.manifest.ui ?? []).some((ui) => ui.id === id) ||
    path.split("/").some((part) => part === ".." || part === "." || part === "") ||
    /[\\:\0]/.test(path)
  )
    throw new Error("Invalid plugin asset path");
  const content = await readFile(join(build.directory, "build/ui", id, path));
  return {
    content,
    contentType: PLUGIN_CONTENT_TYPES[extname(path)] ?? "application/octet-stream",
  };
}
