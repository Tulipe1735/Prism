import type { JSX } from "react";
import type { PluginSummary } from "../../kernel/creator.ts";
import type { Workbench } from "./use-workbench.ts";
import { PenLine, Play, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { KernelClient } from "./client.ts";
import { Button, SectionLabel } from "./components.tsx";

export function Plugins({
  workbench,
  onLaunchCanvas,
}: {
  workbench: Workbench;
  onLaunchCanvas: () => void;
}): JSX.Element {
  const { connected, activeId, settings } = workbench.state;
  const enabled = settings?.creator.enabled ?? false;
  const [client] = useState(() => new KernelClient());
  const [plugins, setPlugins] = useState<PluginSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!connected) return;
    let disposed = false;
    void client
      .plugins()
      .then((value) => {
        if (!disposed) {
          setPlugins(value);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!disposed) setError(describe(reason));
      });
    return () => {
      disposed = true;
    };
  }, [client, connected, enabled]);

  async function refresh(): Promise<void> {
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

  return (
    <section className="px-5 py-5" data-section="plugins">
      <SectionLabel>插件</SectionLabel>
      <p className="mt-1.5 text-[13px] leading-6 text-muted">
        启动需要的工具，或管理已安装的插件。
      </p>
      <article data-plugin="excalidraw" className="mt-4 rounded-lg border p-4">
        <div className="flex items-center gap-2.5">
          <PenLine size={18} className="shrink-0 text-accent" aria-hidden="true" />
          <h3 className="text-sm font-semibold">Excalidraw</h3>
          <span className="ml-auto rounded border px-1.5 py-0.5 text-[11px] text-muted">
            内置
          </span>
        </div>
        <p className="mt-2 text-xs leading-6 text-muted">
          与 Agent 共同绘图，自动保存当前会话的画布，支持导入和导出。
        </p>
        {activeId === null ? (
          <p className="mt-2 text-xs leading-6 text-muted">
            先创建或打开一个会话，再启动画布。
          </p>
        ) : null}
        <Button
          variant="primary"
          className="mt-3 w-full"
          data-action="launch-plugin"
          aria-label="启动 Excalidraw"
          disabled={!connected || activeId === null}
          onClick={onLaunchCanvas}
        >
          <Play size={13} aria-hidden="true" />
          启动
        </Button>
      </article>
      <fieldset
        disabled={busy || !connected}
        className="mt-4 min-w-0 space-y-3 disabled:opacity-60"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted">
            自定义插件{plugins === null ? "" : ` · ${plugins.length}`}
          </span>
          <Button variant="ghost" className="text-xs" onClick={() => void refresh()}>
            <RefreshCw size={12} aria-hidden="true" /> 刷新
          </Button>
        </div>
        {error === null ? null : (
          <p role="alert" className="text-xs leading-6 text-accent">
            {error}
          </p>
        )}
        {plugins === null && error === null ? (
          <p role="status" className="text-xs leading-6 text-muted">
            正在读取插件…
          </p>
        ) : null}
        {plugins?.length === 0 ? (
          <p className="text-xs leading-6 text-muted">
            还没有自定义插件。可在设置中开启 Creator Mode，再通过对话创建需要的插件。
          </p>
        ) : null}
        {plugins?.map((plugin) => (
          <article
            key={plugin.name}
            data-plugin={plugin.name}
            className="rounded-lg border p-3"
          >
            <div className="flex items-center justify-between gap-3 text-[13px]">
              <span className="font-mono break-all">{plugin.name}</span>
              <span className="shrink-0 text-xs text-muted">
                {plugin.state === "active"
                  ? "已启用"
                  : plugin.state === "disabled"
                    ? "已停用"
                    : "加载失败"}
              </span>
            </div>
            <p className="mt-2 text-xs leading-6 text-muted">{plugin.description}</p>
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
            <div className="mt-3 flex flex-wrap gap-2">
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
    </section>
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
