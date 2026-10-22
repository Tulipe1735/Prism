import type { PluginUiEntry } from "../../../packages/plugin-sdk/src/index.ts";
import type { PluginSummary } from "../../kernel/creator.ts";
import type { KernelEvent } from "../../kernel/events.ts";
import type {
  KernelSettings,
  KernelStatusReport,
  SettingsPatch,
} from "../../kernel/kernel.ts";
import type { Attachment, SessionEntry, SessionSummary } from "../../kernel/session.ts";
import type { TerminalEvent } from "../../kernel/terminal.ts";
import { readSseData } from "../../shared/sse.ts";

export type { SettingsPatch };

/** Milliseconds before the client reopens the event stream (matches the kernel's retry hint). */
const RETRY_MS = 2_000;

/** An error answer from the kernel, carrying the machine-readable code. */
export class KernelApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "KernelApiError";
    this.code = code;
    this.status = status;
  }
}

export interface KernelClientOptions {
  /** Base URL of the kernel; the workbench UI uses its own origin by default. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface SessionLogPayload {
  session: SessionSummary;
  entries: SessionEntry[];
}

export interface EventStreamHandlers {
  onEvent: (event: KernelEvent) => void;
  onState?: (state: "open" | "closed") => void;
}

/**
 * The workbench side of the kernel contract: HTTP requests plus one long-lived
 * event stream. The stream reopens after a drop; callers reload session state
 * on `open` because the kernel never replays events.
 */
export class KernelClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: KernelClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "kernel").replace(/\/$/, "");
    // Wrapped: browsers refuse `fetch` when it is called on another receiver.
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  status(): Promise<KernelStatusReport> {
    return this.request<KernelStatusReport>("/status");
  }

  settings(): Promise<KernelSettings> {
    return this.request<KernelSettings>("/settings");
  }

  /** Applies a settings change; the answer is the settings now in effect. */
  updateSettings(patch: SettingsPatch): Promise<KernelSettings> {
    return this.request<KernelSettings>("/settings", { method: "PUT", body: patch });
  }

  async plugins(): Promise<PluginSummary[]> {
    const { plugins } = await this.request<{ plugins: PluginSummary[] }>("/plugins");
    return plugins;
  }

  async pluginUi(): Promise<PluginUiEntry[]> {
    const { entries } = await this.request<{ entries: PluginUiEntry[] }>("/plugins/ui");
    return entries.map((entry) => ({ ...entry, url: `${this.baseUrl}${entry.url}` }));
  }

  async pluginRequest(
    plugin: string,
    method: string,
    sessionId: string,
    input: unknown,
  ): Promise<unknown> {
    const { result } = await this.request<{ result: unknown }>(
      `/plugins/${encodeURIComponent(plugin)}/rpc/${encodeURIComponent(method)}`,
      { method: "POST", body: { sessionId, input } },
    );
    return result;
  }

  async developPlugin(directory: string): Promise<PluginSummary[]> {
    const { result } = await this.request<{ result: PluginSummary[] }>("/plugins", {
      method: "POST",
      body: { action: "develop", directory },
    });
    return result;
  }

  async managePlugin(
    action: "enable" | "disable" | "reload" | "remove",
    name: string,
  ): Promise<PluginSummary[]> {
    const { result } = await this.request<{ result: PluginSummary[] }>("/plugins", {
      method: "POST",
      body: { action, name },
    });
    return result;
  }

  async listSessions(workspace?: string): Promise<SessionSummary[]> {
    const query =
      workspace === undefined ? "" : `?workspace=${encodeURIComponent(workspace)}`;
    const { sessions } = await this.request<{ sessions: SessionSummary[] }>(
      `/sessions${query}`,
    );
    return sessions;
  }

  async createSession(input: {
    workspace: string;
    title?: string;
  }): Promise<SessionSummary> {
    const { session } = await this.request<{ session: SessionSummary }>("/sessions", {
      method: "POST",
      body: input,
    });
    return session;
  }

  readSession(sessionId: string): Promise<SessionLogPayload> {
    return this.request<SessionLogPayload>(
      `/sessions/${encodeURIComponent(sessionId)}`,
    );
  }

  async renameSession(sessionId: string, title: string): Promise<SessionSummary> {
    const { session } = await this.request<{ session: SessionSummary }>(
      `/sessions/${encodeURIComponent(sessionId)}`,
      { method: "PATCH", body: { title } },
    );
    return session;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.request(`/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    });
  }

  async uploadAttachment(sessionId: string, file: File): Promise<Attachment> {
    const { attachment } = await this.request<{ attachment: Attachment }>(
      `/sessions/${encodeURIComponent(sessionId)}/attachments?name=${encodeURIComponent(file.name)}`,
      { method: "POST", upload: file },
    );
    return attachment;
  }

  async sendMessage(
    sessionId: string,
    text: string,
    attachments: string[] = [],
  ): Promise<string> {
    const { entryId } = await this.request<{ entryId: string }>(
      `/sessions/${encodeURIComponent(sessionId)}/messages`,
      { method: "POST", body: { text, attachments } },
    );
    return entryId;
  }

  async cancelSession(sessionId: string): Promise<boolean> {
    const { cancelled } = await this.request<{ cancelled: boolean }>(
      `/sessions/${encodeURIComponent(sessionId)}/cancel`,
      { method: "POST" },
    );
    return cancelled;
  }

  /**
   * Compacts the session's context into a summary entry. `compacted: false`
   * means the context was still inside the keep window and nothing changed.
   */
  compactSession(sessionId: string): Promise<{ compacted: boolean }> {
    return this.request<{ compacted: boolean }>(
      `/sessions/${encodeURIComponent(sessionId)}/compact`,
      { method: "POST" },
    );
  }

  async answerApproval(
    sessionId: string,
    requestId: string,
    approved: boolean,
  ): Promise<void> {
    await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(requestId)}`,
      { method: "POST", body: { approved } },
    );
  }

  async shutdown(): Promise<void> {
    await this.request("/shutdown", { method: "POST" });
  }

  openTerminal(workspace: string, cols: number, rows: number): Promise<{ id: string }> {
    return this.request("/terminals", {
      method: "POST",
      body: { workspace, cols, rows },
    });
  }

  async writeTerminal(id: string, data: string): Promise<void> {
    await this.request(`/terminals/${encodeURIComponent(id)}/input`, {
      method: "POST",
      body: { data },
    });
  }

  async resizeTerminal(id: string, cols: number, rows: number): Promise<void> {
    await this.request(`/terminals/${encodeURIComponent(id)}/resize`, {
      method: "POST",
      body: { cols, rows },
    });
  }

  async readTerminal(
    id: string,
    onEvent: (event: TerminalEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/terminals/${encodeURIComponent(id)}/events`,
      { signal },
    );
    if (!response.ok || response.body === null)
      throw new Error("终端连接失败，请重新连接。");
    for await (const data of readSseData(response.body))
      onEvent(JSON.parse(data) as TerminalEvent);
    if (!signal.aborted) throw new Error("终端连接已断开，请重新连接。");
  }

  /** Subscribes to `/events`; the returned function stops the stream for good. */
  openEvents(handlers: EventStreamHandlers): () => void {
    const controller = new AbortController();
    const run = async (): Promise<void> => {
      for (;;) {
        if (controller.signal.aborted) return;
        try {
          const response = await this.fetchImpl(`${this.baseUrl}/events`, {
            headers: { accept: "text/event-stream" },
            signal: controller.signal,
          });
          if (!response.ok || response.body === null)
            throw new Error(`Event stream refused with HTTP ${response.status}`);
          handlers.onState?.("open");
          for await (const event of parseSse(response.body)) handlers.onEvent(event);
        } catch (error) {
          // Dropped or refused: report why and try again below.
          console.warn("Kernel event stream interrupted:", error);
        }
        if (controller.signal.aborted) return;
        handlers.onState?.("closed");
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
      }
    };
    void run();
    return () => controller.abort();
  }

  private async request<T = unknown>(
    path: string,
    options: { method?: string; body?: unknown; upload?: File } = {},
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers:
        options.upload !== undefined
          ? { "content-type": options.upload.type || "application/octet-stream" }
          : options.body === undefined
            ? {}
            : { "content-type": "application/json" },
      body:
        options.upload ??
        (options.body === undefined ? undefined : JSON.stringify(options.body)),
    });
    const payload = (await response.json().catch(() => null)) as {
      error?: { code: string; message: string };
    } | null;
    if (!response.ok) {
      throw new KernelApiError(
        response.status,
        payload?.error?.code ?? "INTERNAL_ERROR",
        payload?.error?.message ?? `Kernel answered HTTP ${response.status}`,
      );
    }
    return payload as T;
  }
}

/**
 * Turns the kernel's SSE body into events. Frames are read by
 * `readSseData`; a frame that is not a `KernelEvent` is skipped.
 */
export async function* parseSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<KernelEvent> {
  for await (const data of readSseData(body)) {
    try {
      yield JSON.parse(data) as KernelEvent;
    } catch {
      // A frame that is not JSON is not part of the contract; skip it.
    }
  }
}
