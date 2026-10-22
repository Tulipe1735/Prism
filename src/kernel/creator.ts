import type { Context } from "cordis";
import type { KernelOptions } from "./kernel.ts";
import type { Tool } from "./tool.ts";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  pluginActionSchema,
  PluginManager,
} from "../../packages/plugin-manager/src/index.ts";
import { UI_SLOTS } from "../../packages/plugin-sdk/src/index.ts";
import { bundledSkillsDirectory, loadSkill } from "../skills/loader.ts";

export type {
  PluginAction,
  PluginSummary,
} from "../../packages/plugin-manager/src/index.ts";

/** Load the shipped guide, independent of the user's workspace and skill overrides. */
export async function loadCreatorGuide(): Promise<string> {
  const directory = await bundledSkillsDirectory();
  if (directory === undefined)
    throw new Error(
      "Creator Mode instructions are missing from this Prism installation.",
    );
  return loadSkill({
    name: "creator",
    path: join(directory, "prism", "creator", "SKILL.md"),
  });
}

/** Authoring capabilities are a thin facade over the shared bundle manager. */
export class Creator extends PluginManager {
  private readonly context: Context;
  private authoringDisposers: (() => Promise<void>)[] = [];
  private readonly bundledPlugins: string | false | undefined;

  constructor(ctx: Context, options: KernelOptions) {
    super(ctx);
    this.context = ctx;
    this.bundledPlugins = options.bundledPlugins;
  }

  override async start(): Promise<void> {
    await super.start();
    if (typeof this.bundledPlugins === "string")
      await this.discover(this.bundledPlugins);
    else if (this.bundledPlugins !== false)
      for (const candidate of [
        new URL("./plugins/", import.meta.url),
        new URL("../../dist/plugins/", import.meta.url),
      ]) {
        const directory = fileURLToPath(candidate);
        const entries = await readdir(directory, { withFileTypes: true }).catch(
          () => [],
        );
        const distributions = await Promise.all(
          entries
            .filter((entry) => entry.isDirectory())
            .map((entry) =>
              stat(join(directory, entry.name, "bundle.json"))
                .then(() => true)
                .catch(() => false),
            ),
        );
        if (distributions.some(Boolean)) {
          await this.discover(directory);
          break;
        }
      }
    await this.setEnabled(this.context.config.creator.enabled);
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled && this.authoringDisposers.length === 0) {
      this.authoringDisposers = [
        this.context.tools.register(this.inspectionTool()),
        this.context.tools.register(this.managerTool()),
      ];
    } else if (!enabled) {
      await Promise.all(this.authoringDisposers.splice(0).map((dispose) => dispose()));
    }
  }

  override async close(): Promise<void> {
    await this.setEnabled(false);
    await super.close();
  }

  private inspectionTool(): Tool {
    return {
      name: "creator_inspect",
      description:
        "Inspect Prism's live tools, installed plugins and the complete plugin authoring contract. Call before creating or changing a plugin.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => ({
        content: `${await loadCreatorGuide()}\n\nRuntime:\n${JSON.stringify({
          directory: this.directory,
          dependencyPolicyPath: join(this.directory, "dependency-policy.json"),
          uiSlots: UI_SLOTS,
          tools: this.context.tools.list().map(({ name }) => name),
          plugins: this.list(),
        })}`,
      }),
    };
  }

  private managerTool(): Tool {
    return {
      name: "plugin_manager",
      description:
        "Prepare a multi-file plugin Bundle, then explicitly enable it; list, inspect, develop, disable, reload or remove bundles. Installation never activates code. Read creator_inspect for the contract. New tools appear on the next model request.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [
              "list",
              "inspect",
              "install",
              "develop",
              "enable",
              "disable",
              "reload",
              "remove",
            ],
          },
          name: {
            type: "string",
            description:
              "Required for inspect, enable, disable, reload and remove. Install uses bundle.manifest.name; develop uses directory.",
          },
          bundle: {
            type: "object",
            description:
              "For install: {manifest:{schemaVersion:1,name,version,description,backend,dependencies?,ui?,assets?},files:{relativePath:source}}. Exact npm versions require host policy approval.",
            properties: {},
            additionalProperties: true,
          },
          directory: {
            type: "string",
            description:
              "For develop: absolute path to a directory containing prism.plugin.json. Enable the prepared bundle separately to start watching.",
          },
        },
        required: ["action"],
        additionalProperties: false,
      },
      effects: (args) => {
        const action = pluginActionSchema.parse(args);
        return action.action === "list" || action.action === "inspect"
          ? []
          : [
              {
                kind: "command",
                command: `Prism plugin ${action.action} ${"name" in action ? action.name : action.action === "install" ? action.bundle.manifest.name : action.directory}`,
              },
            ];
      },
      execute: async (args) => {
        if (!this.context.config.creator.enabled)
          return { content: "Creator Mode is disabled.", isError: true };
        return { content: JSON.stringify(await this.manage(args)) };
      },
    };
  }
}

export const creator = {
  name: "creator",
  inject: ["config", "tools", "sessions"],
  async apply(ctx: Context, options: KernelOptions) {
    const service = new Creator(ctx, options);
    await ctx.effect(async function* () {
      yield ctx.provide("creator", service);
      yield () => service.close();
      await service.start();
    });
  },
};
