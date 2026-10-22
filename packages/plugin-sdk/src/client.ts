import type {
  AgentCommand,
  AgentEvent,
  AgentInput,
  AgentSnapshot,
  HostMethod,
  NativeAppBridge,
  PluginEvent,
  ResourceReference,
  WebAppEditGuard,
} from "./index.ts";

export interface UiContext {
  sessionId: string | null;
  connected: boolean;
  desktop?: boolean;
}

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ResourceContent {
  resource: ResourceReference;
  data: ArrayBuffer;
}

/** The frame has no kernel credentials or service objects: requests use the parent bridge. */
export class PluginClient {
  private sequence = 0;
  private closed = false;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
      cleanup: () => void;
    }
  >();
  private readonly listeners = new Set<(event: PluginEvent) => void>();
  private readonly contextListeners = new Set<(context: UiContext) => void>();
  private readonly agentListeners = new Set<(event: AgentEvent) => void>();
  private context: UiContext = { sessionId: null, connected: false };
  private readonly native: NativeAppBridge | undefined;
  private readonly stopNative: (() => void) | undefined;

  constructor() {
    this.native = (
      window as Window & { prismNativeApp?: NativeAppBridge }
    ).prismNativeApp;
    if (this.native === undefined) window.addEventListener("message", this.receive);
    else this.stopNative = this.native.subscribe((message) => this.accept(message));
    this.post({ prism: "ready" });
  }

  readonly app = {
    open: (url?: string, options?: RequestOptions): Promise<{ opened: boolean }> =>
      this.host("app.open", { url }, options),
    insertText: (
      text: string,
      guard: WebAppEditGuard,
      options?: RequestOptions,
    ): Promise<{ inserted: boolean }> =>
      this.host("app.insertText", { text, guard }, options),
  };

  private post(message: unknown, transfer: Transferable[] = []): void {
    if (this.native === undefined) window.parent.postMessage(message, "*", transfer);
    else this.native.send(message);
  }

  readonly agent = {
    read: (options?: RequestOptions): Promise<AgentSnapshot> =>
      this.host("agent.read", undefined, options),
    send: (input: AgentInput, options?: RequestOptions): Promise<{ entryId: string }> =>
      this.host("agent.send", input, options),
    steer: (
      input: AgentInput,
      options?: RequestOptions,
    ): Promise<{ entryId: string }> => this.host("agent.steer", input, options),
    command: (
      command: AgentCommand,
      options?: RequestOptions,
    ): Promise<{ cancelled?: boolean; compacted?: boolean }> =>
      this.host("agent.command", { command }, options),
    subscribe: (listener: (event: AgentEvent) => void): (() => void) => {
      this.agentListeners.add(listener);
      return () => {
        this.agentListeners.delete(listener);
      };
    },
  };

  readonly resources = {
    upload: async (
      file: Blob,
      name: string,
      options?: RequestOptions,
    ): Promise<ResourceReference> => {
      if (file.size > 20 * 1024 * 1024) throw new Error("单个文件不能超过 20 MB。");
      const sessionId = this.context.sessionId;
      const data = await file.arrayBuffer();
      if (sessionId !== this.context.sessionId)
        throw Object.assign(new Error("会话已切换。"), { code: "SESSION_CHANGED" });
      return this.host(
        "resources.upload",
        { name, mediaType: file.type || "application/octet-stream", data },
        options,
        [data],
      );
    },
    read: (id: string, options?: RequestOptions): Promise<ResourceContent> =>
      this.host("resources.read", { id }, options),
  };

  private host<T>(
    method: HostMethod,
    input?: unknown,
    options?: RequestOptions,
    transfer: Transferable[] = [],
  ): Promise<T> {
    return this.call("host.request", method, input, options, transfer);
  }

  private readonly receive = (event: MessageEvent): void => {
    if (event.source === window.parent) this.accept(event.data);
  };

  private accept(data: unknown): void {
    if (data === null || typeof data !== "object") return;
    const message = data as {
      prism?: string;
      id?: number;
      result?: unknown;
      error?: { code: string; message: string };
      context?: UiContext;
      event?: PluginEvent;
      agentEvent?: AgentEvent;
    };
    if (message.prism === "resync") {
      for (const listener of this.contextListeners) listener(this.context);
    } else if (message.prism === "context" && message.context !== undefined) {
      if (
        message.context.sessionId !== this.context.sessionId ||
        !message.context.connected
      )
        for (const id of this.pending.keys())
          this.reject(
            id,
            Object.assign(new Error("会话已切换或连接已断开，请确认状态后重试。"), {
              code:
                message.context.sessionId !== this.context.sessionId
                  ? "SESSION_CHANGED"
                  : "DISCONNECTED",
            }),
          );
      this.context = message.context;
      for (const listener of this.contextListeners) listener(this.context);
    } else if (message.prism === "event" && message.event !== undefined) {
      for (const listener of this.listeners) listener(message.event);
    } else if (message.prism === "agent.event" && message.agentEvent !== undefined) {
      for (const listener of this.agentListeners) listener(message.agentEvent);
    } else if (message.prism === "result" && typeof message.id === "number") {
      const call = this.pending.get(message.id);
      if (call === undefined) return;
      this.pending.delete(message.id);
      clearTimeout(call.timer);
      call.cleanup();
      if (message.error !== undefined)
        call.reject(
          Object.assign(new Error(message.error.message), { code: message.error.code }),
        );
      else call.resolve(message.result);
    }
  }

  request<T>(method: string, input?: unknown, options?: RequestOptions): Promise<T> {
    return this.call("request", method, input, options);
  }

  private call<T>(
    prism: "request" | "host.request",
    method: string,
    input?: unknown,
    options: RequestOptions = {},
    transfer: Transferable[] = [],
  ): Promise<T> {
    if (this.closed || this.context.sessionId === null || !this.context.connected)
      return Promise.reject(
        Object.assign(new Error("请先打开会话并连接内核。"), { code: "UNAVAILABLE" }),
      );
    if (options.signal?.aborted) return Promise.reject(options.signal.reason);
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.reject(
          id,
          Object.assign(new Error("插件请求超时，请先确认操作结果再重试。"), {
            code: "TIMEOUT",
          }),
        );
      }, options.timeoutMs ?? 30_000);
      const abort = (): void => this.reject(id, new Error("插件请求已取消。"));
      const cleanup = (): void => options.signal?.removeEventListener("abort", abort);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
        cleanup,
      });
      options.signal?.addEventListener("abort", abort, { once: true });
      try {
        this.post(
          { prism, id, method, input, sessionId: this.context.sessionId },
          transfer,
        );
      } catch (error) {
        this.reject(id, error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private reject(id: number, reason: Error): void {
    const call = this.pending.get(id);
    if (call === undefined) return;
    this.pending.delete(id);
    clearTimeout(call.timer);
    call.cleanup();
    this.post({ prism: "cancel", id });
    call.reject(reason);
  }

  subscribe(listener: (event: PluginEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onContext(listener: (context: UiContext) => void): () => void {
    this.contextListeners.add(listener);
    listener(this.context);
    return () => {
      this.contextListeners.delete(listener);
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    window.removeEventListener("message", this.receive);
    this.stopNative?.();
    for (const id of this.pending.keys())
      this.reject(id, new Error("插件界面已关闭。"));
    this.listeners.clear();
    this.agentListeners.clear();
    this.contextListeners.clear();
  }
}
