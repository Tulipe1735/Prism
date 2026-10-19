import type { JSX } from "react";
import type { Artifact } from "./derive.ts";
import type { Workbench } from "./use-workbench.ts";
import { ChevronRight, FileCode2, Files, X } from "lucide-react";
import { useMemo } from "react";
import { Button, SCOPE_LABELS, SectionLabel, workspaceName } from "./components.tsx";
import { toArtifacts } from "./derive.ts";
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
      <div className="flex h-16 shrink-0 items-center justify-between border-b px-5">
        <nav
          id="views"
          aria-label="详情视图"
          className="flex h-full items-stretch gap-5"
        >
          {(
            [
              ["artifacts", "产物"],
              ["settings", "设置"],
            ] as const
          ).map(([view, label]) => (
            <button
              type="button"
              key={view}
              data-action="view"
              data-view={view}
              aria-pressed={state.view === view}
              onClick={() => dispatch({ type: "view", view })}
              className={`relative text-xs ${state.view === view ? "font-semibold text-ink after:absolute after:right-0 after:bottom-0 after:left-0 after:h-0.5 after:bg-accent" : "text-muted hover:text-ink"}`}
            >
              {label}
              {view === "artifacts" ? (
                <span className="ml-2 font-mono text-[10px] text-muted">
                  {String(artifacts.length).padStart(2, "0")}
                </span>
              ) : null}
            </button>
          ))}
        </nav>
        <Button
          variant="ghost"
          className="size-7 min-h-7 px-0 xl:hidden"
          onClick={onClose}
          aria-label="关闭详情"
        >
          <X size={15} aria-hidden="true" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div id="artifacts" hidden={state.view !== "artifacts"}>
          <div className="p-5">
            <SectionLabel number="03">Output / 任务产物</SectionLabel>
            <h2 className="mt-5 text-lg font-semibold tracking-tight">
              每一步，都有迹可循。
            </h2>
            <p className="mt-2 text-[11px] leading-6 text-muted">
              本次会话产生的文件改动与执行结果。
            </p>
          </div>
          {artifacts.length === 0 ? (
            <div className="empty mx-5 border border-dashed px-5 py-9">
              <Files
                size={24}
                strokeWidth={1.2}
                className="mb-4 text-muted"
                aria-hidden="true"
              />
              <p className="text-xs font-medium">还没有文件改动</p>
              <p className="mt-2 text-[11px] leading-6 text-muted">
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
          <div className="mx-5 mt-9 border-t pt-5 pb-6">
            <h3 className="eyebrow">Session context / 会话环境</h3>
            <dl className="mt-4 space-y-4 text-[11px]">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">工作区</dt>
                <dd className="truncate font-medium" title={state.workspace}>
                  {state.workspace === "" ? "尚未选择" : workspaceName(state.workspace)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">模型</dt>
                <dd className="truncate font-mono">
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
        </div>
      </div>
      <div className="border-t px-5 py-3 text-[10px] text-muted">
        {state.approvals.length > 0
          ? `${state.approvals.length} 个动作等待审批`
          : "工作清晰，专注当下。"}
      </div>
    </>
  );
}

function ArtifactCard({ artifact }: { artifact: Artifact }): JSX.Element {
  return (
    <details
      className="artifact min-w-0 overflow-hidden rounded-sm border"
      data-path={artifact.path}
    >
      <summary className="flex items-center gap-2 p-3 text-[11px]">
        <ChevronRight
          size={11}
          className="disclosure shrink-0 text-muted"
          aria-hidden="true"
        />
        <FileCode2 size={13} className="shrink-0 text-muted" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-mono" title={artifact.path}>
          {artifact.path}
        </span>
        <span className="counts shrink-0 font-mono text-[10px]">
          <span className="text-success">+{artifact.added}</span>{" "}
          <span className="text-accent">−{artifact.removed}</span>
        </span>
      </summary>
      <div className="border-t">
        <p
          className={`px-3 pt-2 text-[10px] ${artifact.state === "failed" ? "text-accent" : "text-muted"}`}
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
              <p className="px-3 pt-2 text-[10px] leading-5 text-muted">
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
