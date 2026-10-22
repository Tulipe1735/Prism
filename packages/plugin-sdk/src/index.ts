import type { Context as CordisContext } from "cordis";
import type { KernelEvent } from "../../../src/kernel/events.ts";
import type { Attachment, SessionEntry } from "../../../src/kernel/session.ts";
import type { Tool } from "../../../src/kernel/tool.ts";
export type { Tool, ToolContext, ToolResult } from "../../../src/kernel/tool.ts";

/** Session-scoped file reference. The host retains the physical file path. */
export type ResourceReference = Omit<Attachment, "path">;

export interface AgentInput {
  text: string;
  /** UI state supplied as user-level context, separate from the visible message. */
  context?: string;
  attachments?: string[];
}

export interface AgentSnapshot {
  sessionId: string;
  running: boolean;
  entries: SessionEntry[];
  pending: { entryId: string; text: string }[];
  approvals: Extract<KernelEvent, { type: "approval.requested" }>[];
}

export type AgentCommand = "cancel" | "compact";
export type AgentEvent = Exclude<
  KernelEvent,
  PluginEvent | { type: "plugins.updated" | "kernel.status" | "stream.reset" }
>;

/** Explicit host methods, separate from a plugin's own RPC namespace. */
export const HOST_METHODS = [
  "agent.read",
  "agent.send",
  "agent.steer",
  "agent.command",
  "resources.upload",
  "resources.read",
  "app.open",
  "app.insertText",
] as const;
export type HostMethod = (typeof HOST_METHODS)[number];

/** Bounded message transport exposed by the desktop preload, without Node APIs. */
export interface NativeAppBridge {
  send: (message: unknown) => void;
  subscribe: (listener: (message: unknown) => void) => () => void;
}

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
  /** Desktop-owned remote page; its adapter remains part of this plugin. */
  webApp?: WebAppDefinition;
}

export interface WebAppDefinition {
  url: string;
  origins: string[];
  entry: string;
}

/** An observed editable selection, checked immediately before native text input. */
export interface WebAppEditGuard {
  token: string;
  url: string;
  content: string;
  selection: string;
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
  webApp?: WebAppDefinition & { scriptUrl: string; styleUrl: string };
}
