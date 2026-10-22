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

interface SlotsState {
  entries: PluginUiEntry[];
  sessionId: string | null;
  connected: boolean;
  client: KernelClient;
  subscribe: (listener: (event: PluginEvent) => void) => () => void;
}
const Slots = createContext<SlotsState | null>(null);

const layouts = {
  "workbench.header": "toolbar",
  "workbench.sidebar": "content",
  "workbench.panel": "panel",
  "workbench.status": "toolbar",
  "session.header": "toolbar",
  "session.toolbar": "toolbar",
  "session.footer": "content",
  "composer.toolbar": "toolbar",
  "inspector.panel": "content",
  "settings.panel": "content",
} as const satisfies Record<UiSlot, "panel" | "toolbar" | "content">;

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
  const listeners = useRef(new Set<(event: PluginEvent) => void>());
  const subscribe = useCallback((listener: (event: PluginEvent) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);
  const value = useMemo(
    () => ({ entries, sessionId, connected, client, subscribe }),
    [entries, sessionId, connected, client, subscribe],
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

export function PluginSlot({ slot }: { slot: UiSlot }): JSX.Element | null {
  const state = useContext(Slots);
  const [active, setActive] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  if (state === null) return null;
  const entries = state.entries.filter((entry) => entry.slot === slot);
  if (entries.length === 0) return null;
  const layout = layouts[slot];
  const panels = layout === "panel";
  const selected = entries.find((entry) => `${entry.plugin}/${entry.id}` === active);
  return (
    <section
      data-plugin-slot={slot}
      className={
        panels
          ? `shrink-0 border-t ${selected === undefined ? "" : expanded ? "fixed inset-4 z-40 flex flex-col bg-paper shadow-xl" : "flex h-[52%] min-h-72 flex-col"}`
          : layout === "toolbar"
            ? "flex min-w-0 shrink items-center gap-2 overflow-x-auto"
            : "max-h-64 min-w-0 shrink-0 overflow-y-auto"
      }
    >
      {panels ? (
        <div className="flex items-center gap-2 px-3 py-2 text-xs">
          {entries.map((entry) => (
            <button
              key={`${entry.plugin}/${entry.id}`}
              type="button"
              disabled={!state.connected || state.sessionId === null}
              aria-pressed={selected === entry}
              onClick={() => setActive(`${entry.plugin}/${entry.id}`)}
              className="rounded border px-3 py-1"
            >
              {entry.title}
            </button>
          ))}
          {selected === undefined ? null : (
            <>
              <button
                type="button"
                className="ml-auto"
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? "还原" : "放大"}
              </button>
              <button
                type="button"
                aria-label="关闭插件面板"
                onClick={() => {
                  setActive(null);
                  setExpanded(false);
                }}
              >
                关闭
              </button>
            </>
          )}
        </div>
      ) : null}
      {(panels ? (selected === undefined ? [] : [selected]) : entries).map((entry) => (
        <PluginFrame
          key={`${entry.plugin}/${entry.id}/${entry.revision}/${state.sessionId}`}
          entry={entry}
          state={state}
          layout={layout}
        />
      ))}
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
