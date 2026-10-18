import type { CompactionOutcome, CompactionReason } from "./compaction.ts";

import type {
  BrowserConfig,
  ModelConfig,
  PrismConfig,
  SearchConfig,
} from "./config.ts";
import type { KernelEvent, KernelStatus } from "./events.ts";
import type { InstructionRoots } from "./instructions.ts";
import type { ApprovalRequest } from "./permissions.ts";
import type { SessionEntry, SessionSummary } from "./session.ts";
import type { Tool } from "./tool.ts";
import type { SkillToolRoots } from "./tools.ts";
import type { BrowserEngine, ExecutionTarget, PermissionScope } from "./types.ts";
import { randomUUID } from "node:crypto";
import { VERSION } from "../shared/version.ts";
import { createCommandTool } from "./command-tool.ts";
import { compactSession } from "./compaction.ts";
import { saveConfigPatch } from "./config.ts";
import { createFileTools } from "./file-tools.ts";
import { InstructionFiles } from "./instructions.ts";
import { runTask } from "./loop.ts";
import { PermissionPolicy } from "./permissions.ts";
import { SessionStore } from "./session-store.ts";
import { createSkillTool, ToolRegistry } from "./tools.ts";

export type KernelErrorCode =
  "INVALID_REQUEST" | "SESSION_NOT_FOUND" | "APPROVAL_NOT_FOUND" | "TASK_RUNNING";

/** A request the kernel refuses; the server maps the code to an HTTP status. */
export class KernelError extends Error {
  readonly code: KernelErrorCode;

  constructor(code: KernelErrorCode, message: string) {
    super(message);
    this.name = "KernelError";
    this.code = code;
  }
}

export interface KernelOptions {
  config: PrismConfig;
  /** Extra tools on top of the built-ins; 03, 06, 07 and 09 add theirs here. */
  tools?: Tool[];
  /** Roots of the skill scan; tests point them at temporary directories. */
  skillRoots?: SkillToolRoots;
  /** Roots of the `AGENTS.md` scan; tests point them at temporary directories. */
  instructionRoots?: InstructionRoots;
  scope?: PermissionScope;
  /** Forces browser actions through approval, independent of the scope. */
  browserActionsNeedApproval?: boolean;
  target?: ExecutionTarget;
}

export interface KernelSettings {
  dataDir: string;
  model: { baseUrl: string; model: string; hasApiKey: boolean };
  browser: { engine: BrowserEngine; actionsNeedApproval: boolean };
  search: { provider: string; baseUrl?: string };
  permissions: { scope: PermissionScope };
}

/** Settings the workbench may change while the kernel runs. */
export interface SettingsPatch {
  model?: Partial<ModelConfig>;
  browser?: Partial<Pick<BrowserConfig, "engine" | "actionsNeedApproval">>;
  search?: Partial<Pick<SearchConfig, "provider" | "baseUrl">>;
  permissions?: { scope?: PermissionScope };
}

export interface KernelStatusReport {
  status: KernelStatus;
  version: string;
  dataDir: string;
}

/**
 * Owns the sessions, the tool registry and the running tasks, and publishes
 * every state change as a `KernelEvent` for the transport to push.
 */
export class Kernel {
  readonly config: PrismConfig;
  readonly store: SessionStore;
  readonly tools: ToolRegistry;
  readonly skillRoots: SkillToolRoots;
  readonly instructions: InstructionFiles;
  readonly target: ExecutionTarget;
  /** Live permission settings: every task and tool call reads this object. */
  readonly permissions: PermissionPolicy;
  status: KernelStatus = "ready";

  private readonly listeners = new Set<(event: KernelEvent) => void>();
  private readonly runs = new Map<
    string,
    { controller: AbortController; settled: Promise<void> }
  >();
  /**
   * Every task that has not finished writing yet, cancelled ones included: a
   * cancelled task still appends its last entries, so `close` must wait for it
   * before the caller removes the data directory.
   */
  private readonly settlements = new Set<Promise<void>>();
  private readonly approvals = new Map<
    string,
    { sessionId: string; resolve: (approved: boolean) => void }
  >();

  constructor(options: KernelOptions) {
    this.config = options.config;
    this.store = new SessionStore(options.config.dataDir);
    this.skillRoots = options.skillRoots ?? {};
    this.instructions = new InstructionFiles(options.instructionRoots ?? {});
    this.tools = new ToolRegistry([
      createSkillTool(this.skillRoots),
      ...createFileTools(),
      createCommandTool({ timeoutMs: this.config.command.timeoutMs }),
      ...(options.tools ?? []),
    ]);
    this.permissions = new PermissionPolicy({
      scope: options.scope ?? options.config.permissions.scope,
      browserActionsNeedApproval:
        options.browserActionsNeedApproval ??
        options.config.browser.actionsNeedApproval,
    });
    this.target = options.target ?? "wsl";
  }

  subscribe(listener: (event: KernelEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: KernelEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  statusReport(): KernelStatusReport {
    return { status: this.status, version: VERSION, dataDir: this.config.dataDir };
  }

  statusEvent(): Extract<KernelEvent, { type: "kernel.status" }> {
    return { type: "kernel.status", ...this.statusReport() };
  }

  settings(): KernelSettings {
    const { baseUrl, model, apiKey } = this.config.model;
    const { provider, baseUrl: searchBaseUrl } = this.config.search;
    return {
      dataDir: this.config.dataDir,
      model: { baseUrl, model, hasApiKey: apiKey !== undefined && apiKey !== "" },
      browser: {
        engine: this.config.browser.engine,
        actionsNeedApproval: this.permissions.browserActionsNeedApproval,
      },
      search: {
        provider,
        ...(searchBaseUrl === undefined ? {} : { baseUrl: searchBaseUrl }),
      },
      permissions: { scope: this.permissions.scope },
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
    return this.settings();
  }

  async createSession(input: {
    workspace: string;
    title?: string;
  }): Promise<SessionSummary> {
    const header = await this.store.create(input);
    const session = await this.store.summary(header.id);
    this.emit({ type: "session.updated", session });
    return session;
  }

  async listSessions(options: { workspace?: string } = {}): Promise<SessionSummary[]> {
    return this.store.list(options);
  }

  async readSession(
    sessionId: string,
  ): Promise<{ session: SessionSummary; entries: SessionEntry[] }> {
    const log = await this.store.read(sessionId);
    return { session: await this.store.summary(sessionId), entries: log.entries };
  }

  async deleteSession(sessionId: string): Promise<void> {
    const active = this.runs.get(sessionId);
    this.cancelSession(sessionId);
    // The cancelled task appends its last entries; the log goes away after that.
    await active?.settled;
    if (!(await this.store.delete(sessionId)))
      throw new KernelError("SESSION_NOT_FOUND", `Session ${sessionId} does not exist`);
  }

  /** Rewrites the session title; a session with a running task is refused. */
  async renameSession(sessionId: string, title: string): Promise<SessionSummary> {
    const active = this.runs.get(sessionId);
    if (active !== undefined) {
      if (!active.controller.signal.aborted)
        throw new KernelError(
          "TASK_RUNNING",
          `Session ${sessionId} has a running task; cancel it before renaming`,
        );
      // A cancelled task may still be appending; rewriting the header could lose it.
      await active.settled;
    }
    await this.store.rename(sessionId, title);
    const session = await this.store.summary(sessionId);
    this.emit({ type: "session.updated", session });
    return session;
  }

  /** Appends the user message and starts the task in the background. */
  async sendMessage(sessionId: string, text: string): Promise<string> {
    const active = this.runs.get(sessionId);
    if (active !== undefined) {
      if (!active.controller.signal.aborted)
        throw new KernelError(
          "TASK_RUNNING",
          `Session ${sessionId} already has a running task`,
        );
      // A cancelled task may still be writing its last entries.
      await active.settled;
    }
    const session = await this.store.summary(sessionId);
    const entry = await this.store.append(sessionId, {
      type: "message",
      role: "user",
      content: text,
    });
    await this.notifySession(sessionId);

    const controller = new AbortController();
    const run = { controller, settled: Promise.resolve() };
    const settled = runTask({
      kernel: this,
      sessionId,
      workspace: session.workspace,
      scope: this.permissions.scope,
      target: this.target,
      signal: controller.signal,
    })
      .catch((error) => {
        console.error(
          `Task in session ${sessionId} failed outside the loop:`,
          error instanceof Error ? error.message : error,
        );
      })
      .finally(() => {
        if (this.runs.get(sessionId) === run) this.runs.delete(sessionId);
        this.settlements.delete(settled);
      });
    run.settled = settled;
    this.settlements.add(settled);
    this.runs.set(sessionId, run);
    return entry.id;
  }

  isRunning(sessionId: string): boolean {
    return this.runs.has(sessionId);
  }

  /**
   * Compacts the session's context into a summary entry. The task loop calls
   * this when the automatic trigger fires; the manual endpoint calls
   * `compactManually` instead, which refuses a running task.
   */
  async compactSession(
    sessionId: string,
    options: { reason: CompactionReason; signal?: AbortSignal },
  ): Promise<CompactionOutcome> {
    const outcome = await compactSession({
      store: this.store,
      model: this.config.model,
      compaction: this.config.compaction,
      sessionId,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    if (outcome.compacted && outcome.entryId !== undefined) {
      await this.notifySession(sessionId);
      this.emit({
        type: "session.compacted",
        sessionId,
        entryId: outcome.entryId,
        reason: options.reason,
      });
    }
    return outcome;
  }

  /** Manual compaction from the workbench; refuses while the session runs a task. */
  async compactManually(sessionId: string): Promise<CompactionOutcome> {
    if (this.runs.has(sessionId))
      throw new KernelError(
        "TASK_RUNNING",
        `Session ${sessionId} is running a task; cancel it or wait before compacting`,
      );
    return this.compactSession(sessionId, { reason: "manual" });
  }

  /** Stops the running task; pending approvals of that session are refused. */
  cancelSession(sessionId: string): boolean {
    const run = this.runs.get(sessionId);
    if (run === undefined) return false;
    this.refuseApprovals(sessionId);
    this.runs.delete(sessionId);
    run.controller.abort();
    return true;
  }

  /** Publishes the current summary of a session whose log changed. */
  async notifySession(sessionId: string): Promise<void> {
    const session = await this.store.summary(sessionId);
    this.emit({ type: "session.updated", session });
  }

  /** Asks the user once; the answer is never remembered (ADR-0005). */
  requestApproval(
    sessionId: string,
    request: ApprovalRequest & { tool: string },
  ): Promise<boolean> {
    const requestId = randomUUID();
    return new Promise<boolean>((resolve) => {
      this.approvals.set(requestId, { sessionId, resolve });
      this.emit({ type: "approval.requested", sessionId, requestId, ...request });
    });
  }

  /** Answers one approval; every request accepts a single answer. */
  resolveApproval(sessionId: string, requestId: string, approved: boolean): boolean {
    const pending = this.approvals.get(requestId);
    if (pending === undefined || pending.sessionId !== sessionId) return false;
    this.approvals.delete(requestId);
    this.emit({ type: "approval.resolved", sessionId, requestId, approved });
    pending.resolve(approved);
    return true;
  }

  async close(): Promise<void> {
    for (const sessionId of [...this.runs.keys()]) this.cancelSession(sessionId);
    await Promise.allSettled([...this.settlements]);
    this.listeners.clear();
  }

  private refuseApprovals(sessionId: string): void {
    for (const [requestId, pending] of [...this.approvals]) {
      if (pending.sessionId !== sessionId) continue;
      this.approvals.delete(requestId);
      pending.resolve(false);
    }
  }
}
