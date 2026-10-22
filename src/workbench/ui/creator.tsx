import type { JSX } from "react";
import type { PluginSummary } from "../../kernel/creator.ts";
import type { SettingsPatch } from "./client.ts";
import { Check, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { KernelClient } from "./client.ts";
import { Button, SectionLabel } from "./components.tsx";

export function CreatorSettings({
  enabled,
  connected,
  update,
}: {
  enabled: boolean;
  connected: boolean;
  update: (patch: SettingsPatch) => Promise<boolean>;
}): JSX.Element {
  const [client] = useState(() => new KernelClient());
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [directory, setDirectory] = useState("");

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
    const close = client.openEvents({
      onEvent: (event) => {
        if (event.type === "plugins.updated")
          void client
            .plugins()
            .then((value) => {
              if (!disposed) setPlugins(value);
            })
            .catch((reason: unknown) => {
              if (!disposed) setError(describe(reason));
            });
      },
    });
    return () => {
      disposed = true;
      close();
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
    <section className="border-t pt-6" data-section="creator">
      <SectionLabel>Creator Mode</SectionLabel>
      <button
        type="button"
        data-action="toggle-creator"
        aria-pressed={enabled}
        onClick={() => void update({ creator: { enabled: !enabled } })}
        className="mt-3 flex w-full items-center justify-between gap-3 border-y py-3 text-left text-[13px] transition-colors hover:text-accent"
      >
        允许 Agent 创建和更新插件
        <span
          aria-hidden="true"
          className={`flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${enabled ? "border-accent bg-accent text-white" : "bg-paper"}`}
        >
          {enabled ? <Check size={11} /> : null}
        </span>
      </button>
      <p className="mt-3 text-xs leading-6 text-muted">
        开启后，在对话中描述需要的能力。Agent
        可以准备多文件插件，确认启用后即可使用，重启后仍保留。
        插件以内核权限运行，请只启用可信代码。关闭此模式后，已启用的插件继续工作。
      </p>
      <fieldset
        disabled={busy || !connected}
        className="mt-4 min-w-0 space-y-3 disabled:opacity-60"
      >
        {enabled ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setBusy(true);
              void client
                .developPlugin(directory)
                .then((value) => {
                  setPlugins(value);
                  setError(null);
                })
                .catch((reason: unknown) => setError(describe(reason)))
                .finally(() => setBusy(false));
            }}
            className="space-y-2"
          >
            <label className="block text-xs">
              开发插件目录
              <input
                aria-label="开发插件目录"
                value={directory}
                onChange={(event) => setDirectory(event.target.value)}
                placeholder="包含 prism.plugin.json 的绝对路径"
                className="mt-2 w-full rounded border bg-paper px-2 py-2 text-xs"
              />
            </label>
            <Button
              type="submit"
              variant="outline"
              className="text-xs"
              disabled={directory.trim() === ""}
            >
              准备 Bundle
            </Button>
            <p className="text-xs leading-5 text-muted">
              准备完成后点击启用，源文件变更会自动重载。npm 依赖需先加入宿主批准清单。
            </p>
          </form>
        ) : null}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted">已安装插件 · {plugins.length}</span>
          <Button variant="ghost" className="text-xs" onClick={() => void refresh()}>
            <RefreshCw size={12} aria-hidden="true" /> 刷新
          </Button>
        </div>
        {error === null ? null : (
          <p role="alert" className="text-xs leading-6 text-accent">
            {error}
          </p>
        )}
        {plugins.length === 0 ? (
          <p className="text-xs leading-6 text-muted">
            尚未安装插件。试试：“给我做一个统计文本字数的插件，并验证它。”
          </p>
        ) : null}
        {plugins.map((plugin) => (
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
                  : plugin.state === "disabled" || plugin.state === "installed"
                    ? "已停用"
                    : "加载失败"}
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
            <div className="mt-3 flex flex-wrap gap-2">
              {plugin.staged ? (
                <Button
                  variant="outline"
                  className="text-xs"
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
    </section>
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
