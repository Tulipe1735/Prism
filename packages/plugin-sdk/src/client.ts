import type { PluginEvent } from "./index.ts";

export interface UiContext {
  sessionId: string | null;
  connected: boolean;
}

/** The frame has no kernel credentials or service objects: requests use the parent bridge. */
export class PluginClient {
  private sequence = 0;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly listeners = new Set<(event: PluginEvent) => void>();
  private readonly contextListeners = new Set<(context: UiContext) => void>();
  private context: UiContext = { sessionId: null, connected: false };

  constructor() {
    window.addEventListener("message", this.receive);
    window.parent.postMessage({ prism: "ready" }, "*");
  }

  private readonly receive = (event: MessageEvent): void => {
    if (
      event.source !== window.parent ||
      event.data === null ||
      typeof event.data !== "object"
    )
      return;
    const message = event.data as {
      prism?: string;
      id?: number;
      result?: unknown;
      error?: { code: string; message: string };
      context?: UiContext;
      event?: PluginEvent;
    };
    if (message.prism === "context" && message.context !== undefined) {
      this.context = message.context;
      for (const listener of this.contextListeners) listener(this.context);
    } else if (message.prism === "event" && message.event !== undefined) {
      for (const listener of this.listeners) listener(message.event);
    } else if (message.prism === "result" && typeof message.id === "number") {
      const call = this.pending.get(message.id);
      if (call === undefined) return;
      this.pending.delete(message.id);
      clearTimeout(call.timer);
      if (message.error !== undefined)
        call.reject(
          Object.assign(new Error(message.error.message), { code: message.error.code }),
        );
      else call.resolve(message.result);
    }
  };

  request<T>(method: string, input?: unknown): Promise<T> {
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("插件请求超时，请重试。"));
      }, 30_000);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      window.parent.postMessage(
        { prism: "request", id, method, input, sessionId: this.context.sessionId },
        "*",
      );
    });
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
    window.removeEventListener("message", this.receive);
    for (const call of this.pending.values()) {
      clearTimeout(call.timer);
      call.reject(new Error("插件界面已关闭。"));
    }
    this.pending.clear();
    this.listeners.clear();
    this.contextListeners.clear();
  }
}
