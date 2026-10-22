import type { Context as CordisContext } from "cordis";
import type { Tool } from "../../../src/kernel/tool.ts";
export type { Tool, ToolContext, ToolResult } from "../../../src/kernel/tool.ts";

/** The supported host face; UI modules receive only the message bridge. */
export interface Context extends Pick<CordisContext, "effect"> {
  config: { dataDir: string };
  sessions: { read: (sessionId: string) => Promise<unknown> };
  tools: { register: (tool: Tool) => () => Promise<void> };
}

export const UI_SLOTS = [
  "workbench.header",
  "workbench.sidebar",
  "workbench.panel",
  "workbench.status",
  "session.header",
  "session.toolbar",
  "session.footer",
  "composer.toolbar",
  "inspector.panel",
  "settings.panel",
] as const;
export type UiSlot = (typeof UI_SLOTS)[number];

export interface UiContribution {
  id: string;
  slot: UiSlot;
  title: string;
  entry: string;
}

export interface BundleManifest {
  schemaVersion: 1;
  name: string;
  version: string;
  description: string;
  backend: string;
  dependencies?: Record<string, string>;
  ui?: UiContribution[];
  assets?: { from: string; to: string }[];
}

/** A portable source bundle. Paths are relative POSIX paths, never host paths. */
export interface PluginBundle {
  manifest: BundleManifest;
  files: Record<string, string>;
}

export interface PluginEvent {
  type: "plugin.event";
  plugin: string;
  name: string;
  sessionId?: string;
  data: unknown;
}

export interface RpcContext {
  sessionId: string;
  signal: AbortSignal;
}

export interface BundleApi {
  /** Persistent plugin data; independent of build revisions and source directories. */
  dataDir: string;
  rpc: {
    register: (
      name: string,
      handler: (input: unknown, context: RpcContext) => Promise<unknown>,
    ) => () => Promise<void>;
  };
  emit: (name: string, data: unknown, sessionId?: string) => void;
  onSessionRemoved: (listener: (sessionId: string) => Promise<void>) => () => void;
}

export interface BundlePlugin {
  inject?: string[];
  apply: (ctx: Context, api: BundleApi) => void | Promise<void>;
}

/** Plugin-defined failures cross the generic RPC transport without host-specific enums. */
export class PluginError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "PluginError";
    this.code = code;
    this.status = status;
  }
}

export interface PluginUiEntry extends UiContribution {
  plugin: string;
  revision: string;
  url: string;
}
