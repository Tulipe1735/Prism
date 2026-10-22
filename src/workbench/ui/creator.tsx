import type { JSX } from "react";
import type { SettingsPatch } from "./client.ts";
import { Check } from "lucide-react";
import { useState } from "react";
import { KernelClient } from "./client.ts";
import { Button, SectionLabel } from "./components.tsx";

/**
 * Only the Creator switch and the development directory live here; installed
 * plugins and their panels are managed in the inspector's plugin tab.
 */
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
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [directory, setDirectory] = useState("");

  async function prepare(): Promise<void> {
    setBusy(true);
    try {
      await client.developPlugin(directory);
      setNotice("Bundle 已准备。在「插件」页启用后生效。");
      setError(null);
    } catch (reason) {
      setError(describe(reason));
      setNotice(null);
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
        className="mt-3 flex w-full items-center justify-between gap-3 border-y py-3 text-left text-sm transition-colors hover:text-accent"
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
      <p className="mt-2 text-xs leading-6 text-muted">
        已安装插件、启用状态与插件面板在右侧栏的「插件」页管理。
      </p>
      <fieldset
        disabled={busy || !connected}
        className="mt-4 min-w-0 disabled:opacity-60"
      >
        {enabled ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void prepare();
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
              准备完成后在「插件」页点击启用，源文件变更会自动重载。npm
              依赖需先加入宿主批准清单。
            </p>
          </form>
        ) : null}
        {notice === null ? null : (
          <p role="status" className="mt-3 text-xs leading-6 text-muted">
            {notice}
          </p>
        )}
        {error === null ? null : (
          <p role="alert" className="mt-3 text-xs leading-6 text-accent">
            {error}
          </p>
        )}
      </fieldset>
    </section>
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
