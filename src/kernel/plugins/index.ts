import type { KernelOptions } from "../kernel.ts";
import process from "node:process";
import { Context } from "cordis";
import { creator } from "../creator.ts";
import { Tasks } from "../tasks.ts";
import * as capabilities from "./capabilities.ts";
import * as conversation from "./conversation.ts";
import * as core from "./core.ts";
import "../context.ts";

export const tasks = {
  name: "tasks",
  inject: [
    "config",
    "sessions",
    "tools",
    "permissions",
    "approvals",
    "instructions",
    "skills",
    "model",
    "compaction",
  ],
  apply(ctx: Context, options: KernelOptions) {
    const service = new Tasks(
      ctx,
      options.target ?? (process.platform === "win32" ? "windows" : "wsl"),
    );
    ctx.effect(function* () {
      yield ctx.provide("tasks", service);
      yield () => service.close();
    });
  },
};

/** Each stage finishes before the next can accept requests; inject governs teardown too. */
export async function createContext(options: KernelOptions): Promise<Context> {
  const ctx = new Context();
  try {
    await ctx.plugin(core.configuration, options);
    await Promise.all([
      ctx.plugin(core.sessions),
      ctx.plugin(core.tools),
      ctx.plugin(core.model),
      ctx.plugin(core.approvals),
      ctx.plugin(core.permissions, options),
      ctx.plugin(conversation.instructions, options),
    ]);
    await Promise.all([
      ctx.plugin(conversation.skills, options),
      ctx.plugin(conversation.compaction),
      ctx.plugin(capabilities.files),
      ctx.plugin(capabilities.commands),
      ctx.plugin(capabilities.browser),
      ctx.plugin(capabilities.web, options),
      ctx.plugin(capabilities.mcp),
      ctx.plugin(capabilities.extraTools, options),
    ]);
    await ctx.plugin(tasks, options);
    await ctx.plugin(creator);
    return ctx;
  } catch (error) {
    await ctx.fiber.dispose();
    throw error;
  }
}
