import type { Context } from "cordis";
import type { KernelOptions } from "../kernel.ts";
import { join } from "node:path";
import { loadMcpConfig } from "../../mcp/config.ts";
import { McpHost } from "../../mcp/host.ts";
import { createBrowserTools } from "../browser-tools.ts";
import { createCommandTool } from "../command-tool.ts";
import { createFileTools } from "../file-tools.ts";
import { createWebTools } from "../web-tools.ts";

export const files = {
  name: "files",
  inject: ["tools"],
  apply(ctx: Context) {
    ctx.effect(function* () {
      for (const tool of createFileTools()) yield ctx.tools.register(tool);
    });
  },
};

export const commands = {
  name: "commands",
  inject: ["tools", "config"],
  apply(ctx: Context) {
    ctx.effect(() =>
      ctx.tools.register(
        createCommandTool({ timeoutMs: ctx.config.command.timeoutMs }),
      ),
    );
  },
};

export const browser = {
  name: "browser",
  inject: ["tools", "config"],
  apply(ctx: Context) {
    ctx.effect(function* () {
      const capability = createBrowserTools({
        directory: join(ctx.config.dataDir, "browser"),
        engine: () => ctx.config.browser,
      });
      yield () => capability.close();
      for (const tool of capability.tools) yield ctx.tools.register(tool);
    });
  },
};

export const web = {
  name: "web",
  inject: ["tools", "config"],
  apply(ctx: Context, options: KernelOptions) {
    ctx.effect(function* () {
      const capability = createWebTools({
        search: () => ({
          ...ctx.config.search,
          apiKey: ctx.config.search.apiKey ?? ctx.config.model.apiKey,
        }),
        ...(options.webFetch === undefined ? {} : { fetch: options.webFetch }),
      });
      for (const tool of capability) yield ctx.tools.register(tool);
    });
  },
};

export const mcp = {
  name: "mcp",
  inject: ["tools", "config"],
  async apply(ctx: Context) {
    await ctx.effect(async function* () {
      const config = await loadMcpConfig(ctx.config.dataDir).catch((error: unknown) => {
        console.error("MCP configuration could not be read:", error);
        return { servers: {} };
      });
      const host = await McpHost.connect(config);
      yield () => host.close();
      for (const failure of host.failures)
        console.error(
          `MCP server "${failure.server}" is unavailable: ${failure.message}`,
        );
      for (const tool of host.tools) yield ctx.tools.register(tool);
    });
  },
};

/** Explicit additional tools use exactly the same registration ownership as built-ins. */
export const extraTools = {
  name: "extra-tools",
  inject: ["tools"],
  apply(ctx: Context, options: KernelOptions) {
    ctx.effect(function* () {
      for (const tool of options.tools ?? []) yield ctx.tools.register(tool);
    });
  },
};
