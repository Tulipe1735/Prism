import type { JSX } from "react";
import type { Artifact } from "./derive.ts";
import type { Workbench } from "./use-workbench.ts";
import { ChevronRight, FileCode2, Files, X } from "lucide-react";
import { useMemo } from "react";
import { Button, SCOPE_LABELS, SectionLabel, workspaceName } from "./components.tsx";
import { toArtifacts } from "./derive.ts";
import { PluginSlot } from "./plugin-slots.tsx";
import { Plugins } from "./plugins.tsx";
import { Settings } from "./settings.tsx";
import { Diff } from "./timeline.tsx";

export function Inspector({
  workbench,
  onClose,
}: {
  workbench: Workbench;
  onClose: () => void;
}): JSX.Element {
  const { state, dispatch } = workbench;
  const artifacts = useMemo(() => toArtifacts(state.entries), [state.entries]);
  return (
    <>
      <div className="flex h-14 shrink-0 items-center justify-between border-b px-5">
        <nav
          id="views"
          aria-label="详情视图"
          className="flex h-full items-stretch gap-5"
        >
          {(
            [
              ["artifacts", "产物"],
              ["settings", "设置"],
              ["plugins", "插件"],
            ] as const
          ).map(([view, label]) => (
            <button
              type="button"
              key={view}
              data-action="view"
              data-view={view}
              aria-pressed={state.view === view}
              onClick={() => dispatch({ type: "view", view })}
              className={`relative flex items-center gap-1.5 text-sm transition-colors ${state.view === view ? "font-semibold text-ink after:absolute after:right-0 after:bottom-0 after:left-0 after:h-0.5 after:rounded-full after:bg-ink" : "text-muted hover:text-ink"}`}
            >
              {label}
              {view === "artifacts" ? (
                <span className="text-xs tabular-nums text-muted/80">
                  {artifacts.length}
                </span>
              ) : null}
            </button>
          ))}
        </nav>
        <Button
          variant="ghost"
          className="size-7 min-h-7 px-0"
          onClick={onClose}
          aria-label="关闭详情"
        >
          <X size={15} aria-hidden="true" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div id="artifacts" hidden={state.view !== "artifacts"}>
          <div className="px-5 pt-5 pb-3">
            <SectionLabel>任务产物</SectionLabel>
            <p className="mt-1.5 text-sm leading-6 text-muted">
              本次会话产生的文件改动与执行结果。
            </p>
          </div>
          {artifacts.length === 0 ? (
            <div className="empty mx-5 rounded-md bg-surface px-4 py-7">
              <Files
                size={22}
                strokeWidth={1.3}
                className="mb-3 text-muted/70"
                aria-hidden="true"
              />
              <p className="text-sm font-medium">还没有文件改动</p>
              <p className="mt-1.5 text-sm leading-6 text-muted">
                任务开始后，改动的文件会出现在这里。
              </p>
            </div>
          ) : (
            <div className="mx-5 space-y-2">
              {artifacts.map((artifact) => (
                <ArtifactCard key={artifact.path} artifact={artifact} />
              ))}
            </div>
          )}
          {state.view === "artifacts" ? <PluginSlot slot="inspector.panel" /> : null}
          <div className="mx-5 mt-8 border-t pt-5 pb-6">
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">工作区</dt>
                <dd className="truncate font-medium" title={state.workspace}>
                  {state.workspace === "" ? "尚未选择" : workspaceName(state.workspace)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">模型</dt>
                <dd className="truncate font-mono text-xs">
                  {state.settings?.model.model ?? "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">权限范围</dt>
                <dd>
                  {state.settings === null
                    ? "—"
                    : SCOPE_LABELS[state.settings.permissions.scope]}
                </dd>
              </div>
            </dl>
          </div>
        </div>
        <div id="settings" hidden={state.view !== "settings"}>
          <Settings workbench={workbench} />
          {state.view === "settings" ? <PluginSlot slot="settings.panel" /> : null}
        </div>
        <div id="plugins" hidden={state.view !== "plugins"}>
          {state.view === "plugins" ? <Plugins /> : null}
        </div>
      </div>
      {state.approvals.length > 0 ? (
        <div className="border-t px-5 py-2.5 text-xs text-muted">
          {state.approvals.length} 个动作等待审批
        </div>
      ) : null}
    </>
  );
}

function ArtifactCard({ artifact }: { artifact: Artifact }): JSX.Element {
  return (
    <details
      className="artifact min-w-0 overflow-hidden rounded-lg border bg-paper"
      data-path={artifact.path}
    >
      <summary className="flex items-center gap-2 p-3 text-sm transition-colors hover:bg-surface/70">
        <ChevronRight
          size={12}
          className="disclosure shrink-0 text-muted"
          aria-hidden="true"
        />
        <FileCode2 size={14} className="shrink-0 text-muted" aria-hidden="true" />
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs"
          title={artifact.path}
        >
          {artifact.path}
        </span>
        <span className="counts shrink-0 font-mono text-xs tabular-nums">
          <span className="text-success">+{artifact.added}</span>{" "}
          <span className="text-accent">−{artifact.removed}</span>
        </span>
      </summary>
      <div className="border-t">
        <p
          className={`px-3.5 pt-2.5 text-xs ${artifact.state === "failed" ? "text-accent" : "text-muted"}`}
        >
          {artifact.state === "failed"
            ? "修改失败"
            : artifact.state === "running"
              ? "执行中"
              : "修改完成"}
        </p>
        {artifact.diff !== null ? (
          <Diff lines={artifact.diff} />
        ) : (
          <>
            {artifact.written !== null ? (
              <p className="px-3.5 pt-2 text-xs leading-5 text-muted">
                工具没有返回 diff；下面是这次写入的内容。
              </p>
            ) : null}
            <pre className="code-output">
              {artifact.written ?? (artifact.result || "工具没有返回 diff")}
            </pre>
          </>
        )}
      </div>
    </details>
  );
}
