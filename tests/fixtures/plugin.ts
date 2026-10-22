import type { PluginBundle } from "../../packages/plugin-sdk/src/index.ts";

export function pluginBundle(
  source: string,
  name = "wish",
  description = "A wish",
): PluginBundle {
  return {
    manifest: {
      schemaVersion: 1,
      name,
      version: "1.0.0",
      description,
      backend: "index.ts",
    },
    files: { "index.ts": source },
  };
}

export function echoPlugin(
  result = "Hello from a plugin",
  toolName = "wish_echo",
): string {
  return `export const inject = ['tools'];
export function apply(ctx) {
  ctx.effect(() => ctx.tools.register({
    name: ${JSON.stringify(toolName)}, description: 'A test wish.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() { return { content: ${JSON.stringify(result)} }; }
  }));
}`;
}
