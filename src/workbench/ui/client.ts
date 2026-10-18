import type { KernelEvent } from "../../kernel/events.ts";
import type { KernelSettings, KernelStatusReport } from "../../kernel/kernel.ts";
import type { SessionEntry, SessionSummary } from "../../kernel/session.ts";
import type { PermissionScope } from "../../kernel/types.ts";

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

/**
 * The settings `PUT /settings` accepts; the kernel refuses any other key, so
 * the workbench can only change what 04 defined (scope, browser approvals).
 */
export interface SettingsPatch {
  permissions?: { scope: PermissionScope };
  browser?: { actionsNeedApproval: boolean };
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

  /** Applies the two settings 04 opened to the workbench; the answer is the new state. */
  updateSettings(patch: SettingsPatch): Promise<KernelSettings> {
    return this.request<KernelSettings>("/settings", { method: "PUT", body: patch });
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

  async sendMessage(sessionId: string, text: string): Promise<string> {
    const { entryId } = await this.request<{ entryId: string }>(
      `/sessions/${encodeURIComponent(sessionId)}/messages`,
      { method: "POST", body: { text } },
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
    options: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: options.body === undefined ? {} : { "content-type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
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
 * Turns the kernel's SSE body into events. Frames are separated by a blank
 * line, `:` lines are comments (the keep-alive) and `data:` lines of one frame
 * are joined before parsing. The body is read chunk by chunk: browsers do not
 * make streams async-iterable.
 */
export async function* parseSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<KernelEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trim())
        .join("\n");
      if (data === "") continue;
      try {
        yield JSON.parse(data) as KernelEvent;
      } catch {
        // A frame that is not JSON is not part of the contract; skip it.
      }
    }
  }
}
