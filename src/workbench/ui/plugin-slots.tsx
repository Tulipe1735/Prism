import type { JSX, ReactNode } from "react";
import type {
  PluginEvent,
  PluginUiEntry,
  UiSlot,
} from "../../../packages/plugin-sdk/src/index.ts";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { KernelClient } from "./client.ts";

/** Slots the host layout renders in place; the panel slot opens in the drawer. */
export type InlineSlot = Exclude<UiSlot, "workbench.panel">;

interface SlotsState {
  entries: PluginUiEntry[];
  sessionId: string | null;
  connected: boolean;
  client: KernelClient;
  subscribe: (listener: (event: PluginEvent) => void) => () => void;
  /** Composite `plugin/id` of the panel shown in the drawer, if any. */
  activePanel: string | null;
  openPanel: (key: string) => void;
  closePanel: () => void;
}
const Slots = createContext<SlotsState | null>(null);

const layouts = {
  "workbench.header": "toolbar",
  "workbench.sidebar": "content",
  "workbench.status": "toolbar",
  "session.header": "toolbar",
  "session.toolbar": "toolbar",
  "session.footer": "content",
  "composer.toolbar": "toolbar",
  "inspector.panel": "content",
  "settings.panel": "content",
} as const satisfies Record<InlineSlot, "toolbar" | "content">;

/** Stable identity for one panel contribution; also the drawer's selection key. */
export function panelKey(entry: { plugin: string; id: string }): string {
  return `${entry.plugin}/${entry.id}`;
}

export function panelEntries(entries: PluginUiEntry[]): PluginUiEntry[] {
  return entries.filter((entry) => entry.slot === "workbench.panel");
}

/** Read the shared plugin state; the drawer and the plugin list both use it. */
export function usePluginSlots(): SlotsState | null {
  return useContext(Slots);
}

export function PluginProvider({
  connected,
  sessionId,
  children,
}: {
  connected: boolean;
  sessionId: string | null;
  children: ReactNode;
}): JSX.Element {
  const [client] = useState(() => new KernelClient());
  const [entries, setEntries] = useState<PluginUiEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<string | null>(null);
  const listeners = useRef(new Set<(event: PluginEvent) => void>());
  const subscribe = useCallback((listener: (event: PluginEvent) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);
  const openPanel = useCallback((key: string) => setActivePanel(key), []);
  const closePanel = useCallback(() => setActivePanel(null), []);
  const value = useMemo(
    () => ({
      entries,
      sessionId,
      connected,
      client,
      subscribe,
      activePanel,
      openPanel,
      closePanel,
    }),
    [
      entries,
      sessionId,
      connected,
      client,
      subscribe,
      activePanel,
      openPanel,
      closePanel,
    ],
  );
  useEffect(() => {
    if (!connected) return;
    let live = true;
    let sequence = 0;
    const refresh = (): void => {
      const current = ++sequence;
      void client
        .pluginUi()
        .then((value) => {
          if (live && current === sequence) {
            setEntries(value);
            setError(null);
          }
        })
        .catch((reason: unknown) => {
          if (live) setError(reason instanceof Error ? reason.message : String(reason));
        });
    };
    const close = client.openEvents({
      onState: (state) => {
        if (state === "open") refresh();
      },
      onEvent: (event) => {
        if (event.type === "plugins.updated") refresh();
        if (event.type === "plugin.event")
          for (const listener of listeners.current) listener(event);
      },
    });
    refresh();
    return () => {
      live = false;
      close();
    };
  }, [client, connected]);
  return (
    <Slots value={value}>
      {error === null ? null : (
        <p role="alert" className="fixed bottom-0 z-50 bg-paper p-2 text-xs">
          插件界面加载失败：{error}
        </p>
      )}
      {children}
    </Slots>
  );
}

export function PluginSlot({ slot }: { slot: InlineSlot }): JSX.Element | null {
  const state = useContext(Slots);
  if (state === null) return null;
  const entries = state.entries.filter((entry) => entry.slot === slot);
  if (entries.length === 0) return null;
  const layout = layouts[slot];
  return (
    <section
      data-plugin-slot={slot}
      className={
        layout === "toolbar"
          ? "flex min-w-0 shrink items-center gap-2 overflow-x-auto"
          : "max-h-64 min-w-0 shrink-0 overflow-y-auto"
      }
    >
      {entries.map((entry) => (
        <PluginFrame
          key={`${panelKey(entry)}/${entry.revision}/${state.sessionId}`}
          entry={entry}
          state={state}
          layout={layout}
        />
      ))}
    </section>
  );
}

/**
 * Full-height drawer for `workbench.panel` contributions. It opens on demand from
 * the inspector's plugin list so the canvas keeps the whole area instead of a
 * narrow column, and it holds a single frame per selected contribution so the
 * editor's revision guard is never split across two copies.
 */
export function PluginPanelDrawer(): JSX.Element | null {
  const state = useContext(Slots);
  const closePanel = state?.closePanel;
  const activePanel = state?.activePanel ?? null;
  useEffect(() => {
    if (closePanel === undefined || activePanel === null) return;
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      // Capture phase: the workbench's own Escape handler closes the sidebars next.
      event.stopPropagation();
      closePanel();
    };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
  }, [activePanel, closePanel]);
  if (state === null) return null;
  const panels = panelEntries(state.entries);
  const selected = panels.find((entry) => panelKey(entry) === activePanel);
  if (selected === undefined) return null;
  return (
    <section
      data-plugin-slot="workbench.panel"
      role="region"
      aria-label={selected.title}
      className="fixed top-14 right-0 bottom-0 z-30 flex w-[min(94vw,880px)] flex-col border-l bg-paper shadow-xl"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 overflow-x-auto border-b px-3 text-xs">
        {panels.map((entry) => (
          <button
            key={panelKey(entry)}
            type="button"
            aria-pressed={entry === selected}
            onClick={() => state.openPanel(panelKey(entry))}
            className={`shrink-0 rounded border px-3 py-1 ${entry === selected ? "border-accent text-accent" : ""}`}
          >
            {entry.title}
          </button>
        ))}
        <button
          type="button"
          aria-label="关闭插件面板"
          onClick={state.closePanel}
          className="ml-auto shrink-0 rounded border px-3 py-1"
        >
          关闭
        </button>
      </div>
      <PluginFrame
        key={`${panelKey(selected)}/${selected.revision}/${state.sessionId}`}
        entry={selected}
        state={state}
        layout="panel"
      />
    </section>
  );
}

function PluginFrame({
  entry,
  state,
  layout,
}: {
  entry: PluginUiEntry;
  state: SlotsState;
  layout: "panel" | "toolbar" | "content";
}): JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState<string | null>(null);
  const { client, connected, sessionId, subscribe } = state;
  useEffect(() => {
    let live = true;
    const send = (message: unknown): void =>
      frame.current?.contentWindow?.postMessage(message, "*");
    const context = (): void =>
      send({ prism: "context", context: { sessionId, connected } });
    const receive = (event: MessageEvent): void => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.data === null ||
        typeof event.data !== "object"
      )
        return;
      const message = event.data as {
        prism?: string;
        id?: number;
        method?: string;
        input?: unknown;
        sessionId?: string;
        message?: string;
      };
      if (message.prism === "error" && typeof message.message === "string") {
        setError(`${entry.title}：${message.message}`);
        return;
      }
      if (message.prism === "ready") context();
      if (
        message.prism !== "request" ||
        !Number.isSafeInteger(message.id) ||
        typeof message.method !== "string" ||
        !/^[a-z][a-z0-9._-]{0,63}$/.test(message.method)
      )
        return;
      if (message.sessionId !== sessionId) {
        send({
          prism: "result",
          id: message.id,
          error: { code: "SESSION_CHANGED", message: "会话已切换，本次修改未提交。" },
        });
        return;
      }
      if (sessionId === null || !connected) {
        send({
          prism: "result",
          id: message.id,
          error: { code: "UNAVAILABLE", message: "请先打开会话并连接内核。" },
        });
        return;
      }
      void client
        .pluginRequest(entry.plugin, message.method, sessionId, message.input)
        .then((result) => {
          if (live) send({ prism: "result", id: message.id, result });
        })
        .catch((reason: unknown) => {
          if (live)
            send({
              prism: "result",
              id: message.id,
              error: {
                code:
                  reason !== null && typeof reason === "object" && "code" in reason
                    ? String(reason.code)
                    : "PLUGIN_FAILED",
                message: reason instanceof Error ? reason.message : String(reason),
              },
            });
        });
    };
    window.addEventListener("message", receive);
    const close = subscribe((event) => {
      if (
        event.plugin === entry.plugin &&
        (event.sessionId === undefined || event.sessionId === sessionId)
      )
        send({ prism: "event", event });
    });
    context();
    return () => {
      live = false;
      window.removeEventListener("message", receive);
      close();
    };
  }, [client, connected, entry.plugin, sessionId, subscribe]);
  return (
    <>
      {error === null ? null : <p role="alert">{error}</p>}
      <iframe
        ref={frame}
        src={entry.url}
        title={entry.title}
        data-plugin={entry.plugin}
        sandbox="allow-scripts allow-same-origin allow-downloads"
        className={`border-0 ${layout === "toolbar" ? "h-10 w-40 max-w-full shrink-0" : layout === "panel" ? "min-h-0 w-full flex-1" : "h-48 w-full"}`}
        onError={() => setError(`${entry.title} 加载失败，请重载插件。`)}
      />
    </>
  );
}
