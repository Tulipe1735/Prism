import type { JSX } from "react";
import type { PluginSummary } from "../../kernel/creator.ts";
import { Puzzle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, SectionLabel } from "./components.tsx";
import { panelKey, usePluginSlots } from "./plugin-slots.tsx";

const STATE_LABELS: Record<PluginSummary["state"], string> = {
  active: "已启用",
  installed: "已停用",
  disabled: "已停用",
  failed: "加载失败",
};

/** Inspect installed plugins, change their state and open their panels. */
export function Plugins(): JSX.Element {
  const slots = usePluginSlots();
  const client = slots?.client;
  const connected = slots?.connected ?? false;
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (client === undefined || !connected) return;
    let disposed = false;
    const load = (): void => {
      void client
        .plugins()
        .then((value) => {
          if (disposed) return;
          setPlugins(value);
          setError(null);
        })
        .catch((reason: unknown) => {
          if (!disposed) setError(describe(reason));
        });
    };
    load();
    const close = client.openEvents({
      onEvent: (event) => {
        if (event.type === "plugins.updated") load();
      },
    });
    return () => {
      disposed = true;
      close();
    };
  }, [client, connected]);

  async function refresh(): Promise<void> {
    if (client === undefined) return;
    setBusy(true);
    try {
      setPlugins(await client.plugins());
      setError(null);
    } catch (reason) {
      setError(describe(reason));
    } finally {
      setBusy(false);
    }
  }

  async function manage(
    action: "enable" | "disable" | "reload" | "remove",
    name: string,
  ): Promise<void> {
    if (client === undefined) return;
    setBusy(true);
    try {
      setPlugins(await client.managePlugin(action, name));
      setError(null);
    } catch (reason) {
      setError(describe(reason));
    } finally {
      setBusy(false);
    }
  }

  if (slots === null)
    return <p className="p-5 text-sm text-muted">插件服务尚未连接。</p>;
  const sessionReady = connected && slots.sessionId !== null;
  return (
    <fieldset
      data-section="plugins"
      disabled={!connected}
      className="min-w-0 space-y-3 p-5 disabled:opacity-60"
    >
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>已安装插件 · {plugins.length}</SectionLabel>
        <Button
          variant="ghost"
          className="text-xs"
          data-action="plugins-refresh"
          disabled={busy}
          onClick={() => void refresh()}
        >
          <RefreshCw size={12} aria-hidden="true" /> 刷新
        </Button>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-xs leading-6 text-accent">
          {error}
        </p>
      )}
      {plugins.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-7 text-xs leading-6 text-muted">
          尚未安装插件。在「设置 → Creator Mode」中准备插件目录，或让 Agent 创建一个。
        </p>
      ) : null}
      {plugins.map((plugin) => (
        <article
          key={plugin.name}
          data-plugin={plugin.name}
          className="rounded-lg border p-3"
        >
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-mono break-all">{plugin.name}</span>
            <span className="shrink-0 text-xs text-muted">
              {STATE_LABELS[plugin.state]}
            </span>
          </div>
          <p className="mt-2 text-xs leading-6 text-muted">{plugin.description}</p>
          {plugin.staged ? (
            <p className="mt-2 text-xs text-muted">
              新版本已准备，点击启用更新后生效。
            </p>
          ) : null}
          {plugin.development === undefined ? null : (
            <p className="mt-2 break-all text-xs text-muted">
              开发热重载 · {plugin.development}
            </p>
          )}
          {plugin.error === undefined ? null : (
            <p className="mt-2 text-xs leading-6 break-all text-accent">
              {plugin.error}
            </p>
          )}
          {plugin.tools.length === 0 ? null : (
            <p className="mt-2 font-mono text-xs leading-6 break-all text-muted">
              {plugin.tools.join(" · ")}
            </p>
          )}
          {plugin.state !== "active" || plugin.ui.length === 0 ? null : (
            <div className="mt-3 flex flex-wrap gap-2">
              {plugin.ui.map((id) => {
                const key = panelKey({ plugin: plugin.name, id });
                const entry = slots.entries.find(
                  (item) => item.plugin === plugin.name && item.id === id,
                );
                return (
                  <Button
                    key={id}
                    variant={slots.activePanel === key ? "primary" : "outline"}
                    className="text-xs"
                    data-action="plugin-open"
                    data-plugin-panel={key}
                    aria-pressed={slots.activePanel === key}
                    disabled={!sessionReady || entry === undefined}
                    title={
                      sessionReady
                        ? `在右侧打开 ${entry?.title ?? id}`
                        : "先创建或打开一个会话，面板按会话保存。"
                    }
                    onClick={() => {
                      if (entry !== undefined) slots.openPanel(key);
                    }}
                  >
                    <Puzzle size={12} aria-hidden="true" />
                    打开 {entry?.title ?? id}
                  </Button>
                );
              })}
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {plugin.staged ? (
              <Button
                variant="outline"
                className="text-xs"
                data-action="plugin-stage-enable"
                onClick={() => void manage("enable", plugin.name)}
              >
                启用更新
              </Button>
            ) : null}
            <Button
              variant="outline"
              className="text-xs"
              data-action="plugin-toggle"
              onClick={() =>
                void manage(
                  plugin.state === "active" ? "disable" : "enable",
                  plugin.name,
                )
              }
            >
              {plugin.state === "active" ? "停用" : "启用"}
            </Button>
            <Button
              variant="outline"
              className="text-xs"
              data-action="plugin-reload"
              onClick={() => void manage("reload", plugin.name)}
            >
              重载
            </Button>
            <Button
              variant="ghost"
              className="text-xs"
              data-action="plugin-remove"
              onClick={() => void manage("remove", plugin.name)}
            >
              移除
            </Button>
          </div>
        </article>
      ))}
    </fieldset>
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
