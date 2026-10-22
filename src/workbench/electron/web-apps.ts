import type { IpcMainEvent } from "electron";
import type {
  HostMethod,
  PluginUiEntry,
} from "../../../packages/plugin-sdk/src/index.ts";
import type { KernelEvent } from "../../kernel/events.ts";
import { BrowserWindow, ipcMain } from "electron";
import { HOST_METHODS } from "../../../packages/plugin-sdk/src/index.ts";
import { KernelClient } from "../ui/client.ts";
import {
  allowsWebAppUrl,
  editGuardExpression,
  webAppEditSchema,
  webAppOpenSchema,
} from "./web-app-policy.ts";

interface AppWindow {
  window: BrowserWindow;
  entry: PluginUiEntry;
  sessionId: string;
  calls: Map<number, AbortController>;
  popups: Set<BrowserWindow>;
  controller: AbortController;
  generation: number;
}

/** Native remote pages are scoped to an activated contribution and one session. */
export class DesktopWebApps {
  private readonly client: KernelClient;
  private readonly parent: BrowserWindow;
  private readonly preload: string;
  private readonly windows = new Map<number, AppWindow>();
  private readonly stopEvents: () => void;
  private connected = false;
  private closed = false;
  private reconciliation = 0;

  constructor(options: { kernelUrl: string; parent: BrowserWindow; preload: string }) {
    this.client = new KernelClient({ baseUrl: options.kernelUrl });
    this.parent = options.parent;
    this.preload = options.preload;
    ipcMain.on("prism:web-app:message", this.receive);
    this.stopEvents = this.client.openEvents({
      onState: (state) => {
        this.connected = state === "open";
        for (const record of this.windows.values()) this.context(record);
        if (this.connected) void this.reconcile();
      },
      onEvent: (event) => this.publish(event),
    });
  }

  async open(value: unknown): Promise<{ opened: boolean }> {
    if (this.closed) throw new Error("网页应用服务已关闭。");
    const input = webAppOpenSchema.parse(value);
    const entries = await this.client.pluginUi();
    const entry = entries.find(
      (item) => item.plugin === input.plugin && item.id === input.id,
    );
    if (entry?.webApp === undefined)
      throw new Error("网页应用插件尚未启用或版本已经改变。");
    await this.client.readSession(input.sessionId);
    const url = input.url ?? entry.webApp.url;
    if (!allowsWebAppUrl(entry.webApp, url))
      throw new Error("此地址不属于插件声明的站点。");
    for (const record of this.windows.values()) {
      if (
        record.entry.plugin === entry.plugin &&
        record.entry.id === entry.id &&
        record.sessionId === input.sessionId &&
        record.entry.revision === entry.revision
      ) {
        record.window.show();
        record.window.focus();
        if (input.url !== undefined && record.window.webContents.getURL() !== url)
          await record.window.loadURL(url);
        return { opened: true };
      }
    }
    const partition = `persist:prism-web-app-${entry.plugin}-${entry.id}`;
    const window = new BrowserWindow({
      parent: this.parent,
      width: 1380,
      height: 920,
      minWidth: 720,
      minHeight: 560,
      title: `${entry.title} · Prism`,
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: this.preload,
      },
    });
    const record: AppWindow = {
      window,
      entry,
      sessionId: input.sessionId,
      calls: new Map(),
      popups: new Set(),
      controller: new AbortController(),
      generation: 0,
    };
    const contentsId = window.webContents.id;
    this.windows.set(contentsId, record);
    window.webContents.session.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
    window.webContents.session.setPermissionCheckHandler(() => false);
    window.webContents.on("will-navigate", (event, target) => {
      if (!this.https(target)) event.preventDefault();
    });
    window.webContents.on("will-redirect", (event, target) => {
      if (!this.https(target)) event.preventDefault();
    });
    window.webContents.on(
      "did-start-navigation",
      (_event, _url, inPlace, mainFrame) => {
        if (!mainFrame || inPlace) return;
        record.generation++;
        for (const call of record.calls.values()) call.abort();
        record.calls.clear();
      },
    );
    window.webContents.setWindowOpenHandler(({ url: target }) => {
      if (!this.https(target)) return { action: "deny" };
      return {
        action: "allow",
        createWindow: (options) => {
          // Keep Chromium's opener relationship for sign-in callbacks, without the app preload.
          const popup = new BrowserWindow({
            ...options,
            parent: window,
            width: 800,
            height: 800,
            autoHideMenuBar: true,
            webPreferences: {
              partition,
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: true,
            },
          });
          record.popups.add(popup);
          popup.on("closed", () => record.popups.delete(popup));
          popup.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
          popup.webContents.on("will-navigate", (event, value) => {
            if (!this.https(value)) event.preventDefault();
          });
          popup.webContents.on("will-redirect", (event, value) => {
            if (!this.https(value)) event.preventDefault();
          });
          return popup.webContents;
        },
      };
    });
    window.on("closed", () => {
      this.windows.delete(contentsId);
      record.controller.abort();
      for (const call of record.calls.values()) call.abort();
      for (const popup of record.popups) if (!popup.isDestroyed()) popup.destroy();
      record.calls.clear();
    });
    window.webContents.on("did-finish-load", () => {
      if (this.allowed(record))
        void this.install(record).catch((error: unknown) => {
          if (!window.isDestroyed())
            window.setTitle(`${entry.title} · Prism 连接失败：${String(error)}`);
        });
    });
    try {
      await window.loadURL(url);
      await this.current(record);
      window.show();
      return { opened: true };
    } catch (error) {
      if (!window.isDestroyed()) window.destroy();
      throw error;
    }
  }

  private https(value: string): boolean {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.username === "" && url.password === "";
    } catch {
      return false;
    }
  }

  private allowed(record: AppWindow): boolean {
    return (
      !record.window.isDestroyed() &&
      record.entry.webApp !== undefined &&
      allowsWebAppUrl(record.entry.webApp, record.window.webContents.getURL())
    );
  }

  private send(record: AppWindow, message: unknown): void {
    if (this.allowed(record))
      record.window.webContents.send("prism:web-app:message", message);
  }

  private context(record: AppWindow): void {
    this.send(record, {
      prism: "context",
      context: {
        sessionId: record.sessionId,
        connected: this.connected,
        desktop: true,
      },
    });
  }

  private async current(record: AppWindow): Promise<void> {
    const [entries] = await Promise.all([
      this.client.pluginUi(),
      this.client.readSession(record.sessionId),
    ]);
    if (
      this.closed ||
      record.window.isDestroyed() ||
      !entries.some(
        (entry) =>
          entry.plugin === record.entry.plugin &&
          entry.id === record.entry.id &&
          entry.revision === record.entry.revision &&
          entry.webApp !== undefined,
      )
    )
      throw Object.assign(new Error("插件版本已停用，请从工作台重新打开。"), {
        code: "PLUGIN_NOT_FOUND",
      });
  }

  private async install(record: AppWindow): Promise<void> {
    const generation = record.generation;
    await this.current(record);
    const app = record.entry.webApp!;
    const load = async (url: string): Promise<string> => {
      const address = new URL(url);
      if (
        address.origin !== new URL(this.client.baseUrl).origin ||
        !address.pathname.startsWith(
          `/plugins/${record.entry.plugin}/assets/${record.entry.revision}/${record.entry.id}/`,
        )
      )
        throw new Error("插件脚本地址无效。");
      const response = await fetch(address, { signal: record.controller.signal });
      if (!response.ok) throw new Error("插件适配脚本不可用。");
      return response.text();
    };
    const [source, css] = await Promise.all([load(app.scriptUrl), load(app.styleUrl)]);
    if (!this.allowed(record) || generation !== record.generation) return;
    await record.window.webContents.insertCSS(css);
    if (!this.allowed(record) || generation !== record.generation) return;
    await record.window.webContents.executeJavaScript(source);
  }

  private readonly receive = (event: IpcMainEvent, value: unknown): void => {
    const record = this.windows.get(event.sender.id);
    if (
      record === undefined ||
      event.senderFrame !== event.sender.mainFrame ||
      !this.allowed(record) ||
      !allowsWebAppUrl(record.entry.webApp!, event.senderFrame.url)
    )
      return;
    if (value === null || typeof value !== "object") return;
    const message = value as {
      prism?: string;
      id?: number;
      method?: string;
      sessionId?: string;
      input?: unknown;
    };
    if (message.prism === "ready") {
      this.context(record);
      return;
    }
    if (message.prism === "cancel" && typeof message.id === "number") {
      record.calls.get(message.id)?.abort();
      return;
    }
    if (
      (message.prism !== "request" && message.prism !== "host.request") ||
      !Number.isSafeInteger(message.id) ||
      typeof message.method !== "string" ||
      !/^[a-z][\w.-]{0,63}$/.test(message.method)
    )
      return;
    const id = message.id!;
    if (record.calls.has(id)) return;
    if (message.sessionId !== record.sessionId || !this.connected) {
      this.send(record, {
        prism: "result",
        id,
        error: { code: "UNAVAILABLE", message: "会话不匹配或内核已断开。" },
      });
      return;
    }
    const controller = new AbortController();
    record.calls.set(id, controller);
    void this.dispatch(
      record,
      message.prism,
      message.method,
      message.input,
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted)
          this.send(record, { prism: "result", id, result });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          this.send(record, {
            prism: "result",
            id,
            error: {
              code:
                error !== null && typeof error === "object" && "code" in error
                  ? String(error.code)
                  : "APP_FAILED",
              message: error instanceof Error ? error.message : String(error),
            },
          });
      })
      .finally(() => {
        if (record.calls.get(id) === controller) record.calls.delete(id);
      });
  };

  private async dispatch(
    record: AppWindow,
    channel: string,
    method: string,
    input: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    await this.current(record);
    signal.throwIfAborted();
    if (!this.allowed(record)) throw new Error("网页已经离开插件声明的站点。");
    if (channel === "request")
      return this.client.pluginRequest(
        record.entry.plugin,
        method,
        record.sessionId,
        input,
        signal,
      );
    if (method === "app.insertText") {
      const parsed = webAppEditSchema.parse(input);
      if (
        !(await record.window.webContents.executeJavaScript(
          editGuardExpression(parsed),
        ))
      )
        throw Object.assign(new Error("页面或选区已改变，请重新选中要编辑的位置。"), {
          code: "APP_STALE",
        });
      signal.throwIfAborted();
      record.window.webContents.focus();
      await record.window.webContents.insertText(parsed.text);
      return { inserted: true };
    }
    if (method === "app.open") {
      record.window.show();
      record.window.focus();
      return { opened: true };
    }
    if (!HOST_METHODS.includes(method as HostMethod))
      throw new Error("不支持的宿主接口。");
    return this.client.pluginHostRequest(
      record.entry.plugin,
      method as HostMethod,
      record.sessionId,
      input,
      signal,
    );
  }

  private publish(event: KernelEvent): void {
    if (event.type === "plugins.updated") void this.reconcile();
    for (const record of this.windows.values()) {
      if (event.type === "stream.reset") this.send(record, { prism: "resync" });
      else if (event.type === "plugin.event") {
        if (
          event.plugin === record.entry.plugin &&
          (event.sessionId === undefined || event.sessionId === record.sessionId)
        )
          this.send(record, { prism: "event", event });
      } else if (
        event.type === "session.updated"
          ? event.session.id === record.sessionId
          : "sessionId" in event && event.sessionId === record.sessionId
      )
        this.send(record, { prism: "agent.event", agentEvent: event });
    }
  }

  private async reconcile(): Promise<void> {
    const request = ++this.reconciliation;
    try {
      const [entries, sessions] = await Promise.all([
        this.client.pluginUi(),
        this.client.listSessions(),
      ]);
      if (this.closed || request !== this.reconciliation) return;
      for (const record of this.windows.values())
        if (
          !sessions.some((session) => session.id === record.sessionId) ||
          !entries.some(
            (entry) =>
              entry.plugin === record.entry.plugin &&
              entry.id === record.entry.id &&
              entry.revision === record.entry.revision &&
              entry.webApp !== undefined,
          )
        )
          record.window.destroy();
    } catch {
      /* A dropped connection preserves the page and its login state. */
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopEvents();
    ipcMain.removeListener("prism:web-app:message", this.receive);
    for (const record of this.windows.values())
      if (!record.window.isDestroyed()) record.window.destroy();
    this.windows.clear();
  }
}
