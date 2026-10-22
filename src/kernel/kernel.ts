import type { Context } from "cordis";
import type { CompactionOutcome } from "./compaction.ts";
import type {
  BrowserConfig,
  ModelConfig,
  PrismConfig,
  SearchConfig,
} from "./config.ts";
import type { KernelEvent, KernelStatus } from "./events.ts";
import type { InstructionRoots } from "./instructions.ts";
import type { SessionEntry, SessionSummary } from "./session.ts";
import type { Tool } from "./tool.ts";
import type { SkillToolRoots } from "./tools.ts";
import type {
  BrowserEngine,
  ExecutionTarget,
  PermissionScope,
  ThinkingEffort,
} from "./types.ts";
import type { WebFetchOverrides } from "./web-tools.ts";
import { VERSION } from "../shared/version.ts";
import { saveConfigPatch } from "./config.ts";
import { KernelError } from "./errors.ts";
import { createContext } from "./plugins/index.ts";
import { initialSessionTitle } from "./session-title.ts";

export interface KernelOptions {
  config: PrismConfig;
  /** Extra tools registered with plugin-owned cleanup. */
  tools?: Tool[];
  /** Roots of the skill scan; tests point them at temporary directories. */
  skillRoots?: SkillToolRoots;
  /** Roots of the `AGENTS.md` scan; tests point them at temporary directories. */
  instructionRoots?: InstructionRoots;
  scope?: PermissionScope;
  /** Forces browser actions through approval, independent of the scope. */
  browserActionsNeedApproval?: boolean;
  target?: ExecutionTarget;
  webFetch?: WebFetchOverrides;
  /** Override discovery of prebuilt shipped bundles; false keeps an embedded host minimal. */
  bundledPlugins?: string | false;
}

export interface KernelSettings {
  dataDir: string;
  model: {
    baseUrl: string;
    model: string;
    hasApiKey: boolean;
    thinking: ThinkingEffort;
  };
  browser: { engine: BrowserEngine; actionsNeedApproval: boolean };
  search: { provider: string; baseUrl?: string };
  permissions: { scope: PermissionScope };
  creator: { enabled: boolean };
}

/** Settings the workbench may change while the kernel runs. */
export interface SettingsPatch {
  model?: Partial<ModelConfig>;
  browser?: Partial<Pick<BrowserConfig, "engine" | "actionsNeedApproval">>;
  search?: Partial<Pick<SearchConfig, "provider" | "baseUrl">>;
  permissions?: { scope?: PermissionScope };
  creator?: { enabled: boolean };
}

export interface KernelStatusReport {
  status: KernelStatus;
  version: string;
  dataDir: string;
  runningTasks: number;
}

/** Workbench interface over the capabilities owned by the Cordis context. */
export class Kernel {
  readonly ctx: Context;
  status: KernelStatus = "ready";
  private closing: Promise<void> | undefined;

  private constructor(ctx: Context) {
    this.ctx = ctx;
  }

  static async create(options: KernelOptions): Promise<Kernel> {
    return new Kernel(await createContext(options));
  }

  get config(): PrismConfig {
    return this.ctx.config;
  }

  get permissions(): Context["permissions"] {
    return this.ctx.permissions;
  }

  subscribe(listener: (event: KernelEvent) => void): () => void {
    return this.ctx.on("prism/event", listener);
  }

  emit(event: KernelEvent): void {
    this.ctx.emit("prism/event", event);
  }

  statusReport(): KernelStatusReport {
    const tasks = this.ctx.get("tasks");
    return {
      status: this.status === "ready" && tasks === undefined ? "starting" : this.status,
      version: VERSION,
      dataDir: this.config.dataDir,
      runningTasks: tasks?.count ?? 0,
    };
  }

  statusEvent(): Extract<KernelEvent, { type: "kernel.status" }> {
    return { type: "kernel.status", ...this.statusReport() };
  }

  settings(): KernelSettings {
    const { baseUrl, model, apiKey, thinking } = this.config.model;
    const { provider, baseUrl: searchBaseUrl } = this.config.search;
    return {
      dataDir: this.config.dataDir,
      model: {
        baseUrl,
        model,
        hasApiKey: apiKey !== undefined && apiKey !== "",
        thinking,
      },
      browser: {
        engine: this.config.browser.engine,
        actionsNeedApproval: this.permissions.browserActionsNeedApproval,
      },
      search: {
        provider,
        ...(searchBaseUrl === undefined ? {} : { baseUrl: searchBaseUrl }),
      },
      permissions: { scope: this.permissions.scope },
      creator: { ...this.config.creator },
    };
  }

  /**
   * Applies the settings the workbench changed, keeps them for the next kernel
   * start and reports the settings now in effect. The model, the browser engine
   * and the search source are read from `config` on every use, so a change
   * applies to the next model request, browser session or search.
   */
  async updateSettings(patch: SettingsPatch): Promise<KernelSettings> {
    const scope = patch.permissions?.scope;
    if (scope !== undefined) {
      this.permissions.scope = scope;
      this.config.permissions.scope = scope;
    }
    const actionsNeedApproval = patch.browser?.actionsNeedApproval;
    if (actionsNeedApproval !== undefined) {
      this.permissions.browserActionsNeedApproval = actionsNeedApproval;
      this.config.browser.actionsNeedApproval = actionsNeedApproval;
    }
    if (patch.browser?.engine !== undefined)
      this.config.browser.engine = patch.browser.engine;
    if (patch.model !== undefined)
      this.config.model = { ...this.config.model, ...patch.model };
    if (patch.search !== undefined)
      this.config.search = { ...this.config.search, ...patch.search };
    await saveConfigPatch(this.config.dataDir, patch);
    if (patch.creator !== undefined) {
      this.config.creator = { ...patch.creator };
      await this.ctx.creator.setEnabled(patch.creator.enabled);
    }
    return this.settings();
  }

  async createSession(input: {
    workspace: string;
    title?: string;
  }): Promise<SessionSummary> {
    const header = await this.ctx.sessions.create({
      ...input,
      title: input.title ?? initialSessionTitle(input.workspace),
    });
    const session = await this.ctx.sessions.summary(header.id);
    this.emit({ type: "session.updated", session });
    return session;
  }

  async listSessions(options: { workspace?: string } = {}): Promise<SessionSummary[]> {
    return this.ctx.sessions.list(options);
  }

  async readSession(sessionId: string): Promise<{
    session: SessionSummary;
    entries: SessionEntry[];
    running: boolean;
    approvals: ReturnType<Context["approvals"]["list"]>;
  }> {
    const log = await this.ctx.sessions.read(sessionId);
    return {
      session: await this.ctx.sessions.summary(sessionId),
      entries: log.entries,
      running: this.isRunning(sessionId),
      approvals: this.ctx.approvals.list(sessionId),
    };
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.ctx.tasks.cancel(sessionId);
    await this.ctx.tasks.settle(sessionId);
    if (!(await this.ctx.sessions.delete(sessionId)))
      throw new KernelError("SESSION_NOT_FOUND", `Session ${sessionId} does not exist`);
    await this.ctx.attachments.removeSession(sessionId);
    await this.ctx.creator.sessionRemoved(sessionId);
  }

  async renameSession(sessionId: string, title: string): Promise<SessionSummary> {
    await this.ctx.tasks.idle(sessionId);
    await this.ctx.sessions.rename(sessionId, title);
    const session = await this.ctx.sessions.summary(sessionId);
    this.emit({ type: "session.updated", session });
    return session;
  }

  sendMessage(
    sessionId: string,
    text: string,
    attachmentIds: string[] = [],
    inputContext?: string,
  ): Promise<string> {
    return this.ctx.tasks.send(sessionId, text, attachmentIds, inputContext);
  }

  isRunning(sessionId: string): boolean {
    return this.ctx.tasks.isRunning(sessionId);
  }

  steerSession(
    sessionId: string,
    text: string,
    attachmentIds: string[] = [],
    inputContext?: string,
  ): Promise<string> {
    return this.ctx.tasks.steer(sessionId, text, attachmentIds, inputContext);
  }

  async compactManually(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<CompactionOutcome> {
    await this.ctx.tasks.idle(sessionId);
    signal?.throwIfAborted();
    return this.ctx.compaction.compact(sessionId, { reason: "manual", signal });
  }

  cancelSession(sessionId: string): boolean {
    return this.ctx.tasks.cancel(sessionId);
  }

  resolveApproval(sessionId: string, requestId: string, approved: boolean): boolean {
    return this.ctx.approvals.resolve(sessionId, requestId, approved);
  }

  close(): Promise<void> {
    this.status = "stopping";
    this.closing ??= this.ctx.fiber.dispose();
    return this.closing;
  }
}
