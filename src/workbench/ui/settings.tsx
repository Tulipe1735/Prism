import type { JSX } from "react";
import type { KernelSettings } from "../../kernel/kernel.ts";
import type { SettingsPatch } from "./client.ts";
import type { Workbench } from "./use-workbench.ts";
import { Check, Save } from "lucide-react";
import { useState } from "react";
import { BROWSER_ENGINES, PERMISSION_SCOPES } from "../../kernel/types.ts";
import { Button, SCOPE_LABELS, SectionLabel } from "./components.tsx";
import { CreatorSettings } from "./creator.tsx";

export function Settings({ workbench }: { workbench: Workbench }): JSX.Element {
  const settings = workbench.state.settings;
  const [pending, setPending] = useState(false);
  if (settings === null)
    return <p className="p-5 text-sm text-muted">尚未读取内核设置。</p>;
  async function update(patch: SettingsPatch): Promise<boolean> {
    setPending(true);
    try {
      return await workbench.updateSettings(patch);
    } finally {
      setPending(false);
    }
  }
  return (
    <fieldset
      disabled={pending || !workbench.state.connected}
      className="min-w-0 space-y-7 p-5 disabled:opacity-60"
    >
      <section>
        <SectionLabel>模型</SectionLabel>
        <SettingsForm
          key={`${settings.model.baseUrl}:${settings.model.model}`}
          section="model"
          settings={settings}
          update={update}
        />
      </section>
      <section className="border-t pt-6">
        <SectionLabel>权限</SectionLabel>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {PERMISSION_SCOPES.map((scope) => (
            <Button
              key={scope}
              variant={settings.permissions.scope === scope ? "primary" : "outline"}
              className="px-2.5 text-xs"
              data-action="set-scope"
              data-scope={scope}
              aria-pressed={settings.permissions.scope === scope}
              onClick={() => void update({ permissions: { scope } })}
            >
              {SCOPE_LABELS[scope]}
            </Button>
          ))}
        </div>
        <p className="mt-3 text-xs leading-6 text-muted">
          立即生效，后续工具调用按新的范围执行。越过范围的动作需要一次审批。
        </p>
      </section>
      <section className="border-t pt-6">
        <SectionLabel>浏览器</SectionLabel>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {BROWSER_ENGINES.map((engine) => (
            <Button
              key={engine}
              variant={settings.browser.engine === engine ? "primary" : "outline"}
              className="px-2.5 font-mono text-xs"
              data-action="set-engine"
              data-engine={engine}
              aria-pressed={settings.browser.engine === engine}
              onClick={() => void update({ browser: { engine } })}
            >
              {engine}
            </Button>
          ))}
        </div>
        <p className="mt-3 text-xs leading-6 text-muted">
          下一次浏览器会话使用新引擎。Chromium 支持接管已登录的 Chrome / Edge。
        </p>
        <button
          type="button"
          data-action="toggle-browser-approval"
          aria-pressed={settings.browser.actionsNeedApproval}
          onClick={() =>
            void update({
              browser: { actionsNeedApproval: !settings.browser.actionsNeedApproval },
            })
          }
          className="mt-4 flex w-full items-center justify-between gap-3 border-y py-3 text-left text-sm transition-colors hover:text-accent"
        >
          浏览器动作需要审批
          <span
            aria-hidden="true"
            className={`flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${settings.browser.actionsNeedApproval ? "border-accent bg-accent text-white" : "bg-paper"}`}
          >
            {settings.browser.actionsNeedApproval ? <Check size={11} /> : null}
          </span>
        </button>
      </section>
      <section className="border-t pt-6">
        <SectionLabel>搜索</SectionLabel>
        <SettingsForm
          key={`${settings.search.provider}:${settings.search.baseUrl}`}
          section="search"
          settings={settings}
          update={update}
        />
      </section>
      <section className="border-t pt-6">
        <SectionLabel>数据目录</SectionLabel>
        <p className="mt-3 font-mono text-xs leading-6 break-all text-muted">
          {settings.dataDir}
        </p>
        <p className="mt-2 text-xs leading-6 text-muted">
          设置保存至 <span className="font-mono">{settings.dataDir}/config.json</span>
          。密钥只写入，不会返回界面。
        </p>
      </section>
      <CreatorSettings
        enabled={settings.creator.enabled}
        update={update}
        connected={workbench.state.connected}
      />
    </fieldset>
  );
}

function SettingsForm({
  section,
  settings,
  update,
}: {
  section: "model" | "search";
  settings: KernelSettings;
  update: (patch: SettingsPatch) => Promise<boolean>;
}): JSX.Element {
  const model = section === "model";
  async function submit(form: HTMLFormElement): Promise<void> {
    const fields = new FormData(form);
    const value = (name: string): string => String(fields.get(name) ?? "").trim();
    const patch: SettingsPatch = model
      ? {
          model: {
            baseUrl: value("baseUrl"),
            model: value("model"),
            ...(value("apiKey") === "" ? {} : { apiKey: value("apiKey") }),
          },
        }
      : {
          search: {
            provider: value("provider"),
            ...(value("baseUrl") === "" ? {} : { baseUrl: value("baseUrl") }),
          },
        };
    if (await update(patch)) {
      const key = form.querySelector<HTMLInputElement>('[name="apiKey"]');
      if (key !== null) key.value = "";
    }
  }
  return (
    <form
      data-action="settings-form"
      data-section={section}
      className="mt-3.5 space-y-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(event.currentTarget);
      }}
    >
      {model ? (
        <>
          <label className="block text-sm">
            模型名称
            <input
              name="model"
              defaultValue={settings.model.model}
              className="field mt-1.5 font-mono"
              autoComplete="off"
              required
            />
          </label>
          <label className="block text-sm">
            API 端点
            <input
              name="baseUrl"
              defaultValue={settings.model.baseUrl}
              className="field mt-1.5 font-mono"
              autoComplete="off"
              type="url"
              required
            />
          </label>
          <label className="block text-sm">
            API 密钥
            <input
              name="apiKey"
              type="password"
              placeholder={settings.model.hasApiKey ? "已设置（留空不改）" : "未设置"}
              className="field mt-1.5"
              autoComplete="new-password"
            />
          </label>
        </>
      ) : (
        <>
          <label className="block text-sm">
            搜索来源
            <input
              name="provider"
              defaultValue={settings.search.provider}
              className="field mt-1.5 font-mono"
              autoComplete="off"
              required
            />
          </label>
          <label className="block text-sm">
            搜索端点
            <input
              name="baseUrl"
              type="url"
              defaultValue={settings.search.baseUrl ?? ""}
              placeholder="留空沿用当前端点"
              className="field mt-1.5 font-mono"
              autoComplete="off"
            />
          </label>
        </>
      )}
      <Button type="submit" className="w-full">
        <Save size={13} aria-hidden="true" />
        {model ? "保存模型" : "保存搜索"}
      </Button>
    </form>
  );
}
