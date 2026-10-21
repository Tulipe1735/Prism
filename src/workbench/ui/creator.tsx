import type { JSX } from "react";
import type { SettingsPatch } from "./client.ts";
import { Check } from "lucide-react";
import { SectionLabel } from "./components.tsx";

export function CreatorSettings({
  enabled,
  connected,
  update,
}: {
  enabled: boolean;
  connected: boolean;
  update: (patch: SettingsPatch) => Promise<boolean>;
}): JSX.Element {
  return (
    <section className="border-t pt-6" data-section="creator">
      <SectionLabel>Creator Mode</SectionLabel>
      <button
        type="button"
        data-action="toggle-creator"
        disabled={!connected}
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
        开启后，在对话中描述需要的能力。Agent 可以创建插件并立即使用，重启后仍保留。
        插件以内核权限运行，请只启用可信代码。关闭此模式后，已启用的插件继续工作。
      </p>
      <p className="mt-2 text-xs leading-6 text-muted">
        在右侧「插件」中查看、启动和管理插件。
      </p>
    </section>
  );
}
