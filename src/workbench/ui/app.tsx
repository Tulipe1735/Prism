import type { JSX } from "react";
import type { PendingApproval, UiState } from "./state.ts";
import type { Workbench } from "./use-workbench.ts";
import {
  ArrowUp,
  Check,
  ChevronRight,
  Circle,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  ShieldCheck,
  Square,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Button,
  PrismMark,
  SCOPE_LABELS,
  SectionLabel,
  workspaceName,
} from "./components.tsx";
import { Inspector } from "./inspector.tsx";
import { Sidebar } from "./sidebar.tsx";
import { Timeline } from "./timeline.tsx";
import { useWorkbench } from "./use-workbench.ts";

export function App(): JSX.Element {
  const workbench = useWorkbench();
  const { state } = workbench;
  const inlineNavigation = useMediaQuery("(min-width: 768px)");
  const inlineInspector = useMediaQuery("(min-width: 1280px)");
  const [navigationOpen, setNavigationOpen] = useState(inlineNavigation);
  const [inspectorOpen, setInspectorOpen] = useState(
    () =>
      inlineInspector ||
      new URLSearchParams(window.location.search).get("setup") === "model",
  );
  const navigationButton = useRef<HTMLButtonElement>(null);
  const inspectorButton = useRef<HTMLButtonElement>(null);
  const navigationVisible = navigationOpen && (inlineNavigation || !inspectorOpen);
  const navigationWidth =
    inlineNavigation && navigationVisible ? (inlineInspector ? 268 : 248) : 64;
  const inspectorWidth = inlineInspector && inspectorOpen ? 320 : 0;
  const overlayOpen =
    (!inlineNavigation && navigationVisible) || (!inlineInspector && inspectorOpen);
  const sidebarContent = useDelayedFlag(navigationVisible, 120);
  const inspectorClass = inlineInspector
    ? `col-start-3 row-start-1 ${inspectorOpen ? "border-l" : "border-l-0"}`
    : "fixed top-14 right-0 bottom-0 z-30 w-[min(92vw,360px)] border-l shadow-xl";

  function expandNavigation(): void {
    setNavigationOpen(true);
    if (!inlineInspector) setInspectorOpen(false);
  }

  function finishNavigation(): void {
    if (!inlineNavigation) setNavigationOpen(false);
  }

  useEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (inspectorOpen && !inlineInspector) {
        setInspectorOpen(false);
        inspectorButton.current?.focus();
      } else if (navigationVisible && !inlineNavigation) {
        setNavigationOpen(false);
        navigationButton.current?.focus();
      }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [navigationVisible, inspectorOpen, inlineNavigation, inlineInspector]);

  return (
    <div className="grid h-dvh grid-rows-[56px_minmax(0,1fr)] overflow-hidden">
      <a
        href="#message"
        className="fixed top-2 left-2 z-50 -translate-y-20 rounded-md bg-ink px-4 py-2 text-[13px] text-paper focus:translate-y-0"
      >
        跳到任务输入
      </a>
      <header id="topbar" className="flex min-w-0 items-center border-b">
        <div
          id="sidebar-brand"
          data-collapsed={!navigationVisible}
          style={{ width: navigationWidth }}
          className={`sidebar-brand relative flex h-full shrink-0 items-center border-r bg-surface transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${navigationWidth === 64 ? "justify-center" : "gap-2.5 px-5"}`}
          aria-label="Prism"
        >
          <PrismMark
            className={`sidebar-logo ${navigationVisible && navigationWidth === 64 ? "invisible" : ""}`}
          />
          {navigationWidth > 64 ? (
            <span
              id="wordmark"
              className="text-[17px] font-semibold tracking-[-0.03em]"
            >
              Prism
            </span>
          ) : null}
          <button
            ref={navigationButton}
            type="button"
            aria-label="切换会话导航"
            aria-expanded={navigationVisible}
            aria-controls="sidebar"
            title={navigationVisible ? "折叠左侧栏" : "展开左侧栏"}
            onClick={() => {
              if (navigationVisible) setNavigationOpen(false);
              else expandNavigation();
            }}
            className="sidebar-toggle absolute right-4 flex size-8 shrink-0 items-center justify-center rounded-md text-muted transition-[opacity,background-color,color] duration-150 hover:bg-ink/5 hover:text-ink"
          >
            {navigationVisible ? (
              <PanelLeftClose size={16} aria-hidden="true" />
            ) : (
              <PanelLeftOpen size={16} aria-hidden="true" />
            )}
          </button>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2.5 px-3 md:px-5">
          <div className="hidden min-w-0 items-center gap-1.5 text-[13px] sm:flex">
            <span className="text-muted">工作台</span>
            <ChevronRight size={13} className="text-muted/60" aria-hidden="true" />
            <span className="truncate font-medium">
              {state.workspace === "" ? "开始" : workspaceName(state.workspace)}
            </span>
          </div>
          <div id="kernel-status" className="ml-auto">
            <KernelStatus state={state} />
          </div>
          <button
            ref={inspectorButton}
            type="button"
            aria-label="切换产物与设置"
            aria-controls="inspector"
            aria-expanded={inspectorOpen}
            title={inspectorOpen ? "折叠右侧栏" : "展开右侧栏"}
            onClick={() => {
              setInspectorOpen((open) => !open);
              if (!inlineNavigation) setNavigationOpen(false);
            }}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-ink"
          >
            {inspectorOpen ? (
              <PanelRightClose size={16} aria-hidden="true" />
            ) : (
              <PanelRightOpen size={16} aria-hidden="true" />
            )}
          </button>
        </div>
      </header>

      <main
        className="relative grid min-h-0 transition-[grid-template-columns] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{
          gridTemplateColumns: `${navigationWidth}px minmax(0,1fr) ${inspectorWidth}px`,
        }}
      >
        {overlayOpen ? (
          <button
            type="button"
            aria-label="关闭侧栏"
            className="fixed top-14 right-0 bottom-0 left-0 z-20 bg-ink/15"
            onClick={() => {
              if (!inlineNavigation) setNavigationOpen(false);
              if (!inlineInspector) setInspectorOpen(false);
            }}
          />
        ) : null}
        <aside
          id="sidebar"
          aria-label="工作区与会话"
          className={`${navigationVisible && !inlineNavigation ? "fixed top-14 bottom-0 left-0 z-30 w-[min(88vw,288px)] shadow-xl" : "col-start-1 row-start-1"} flex min-h-0 min-w-0 flex-col overflow-hidden border-r bg-surface`}
        >
          <Sidebar
            workbench={workbench}
            collapsed={!sidebarContent}
            onExpand={expandNavigation}
            onNavigate={finishNavigation}
            onSettings={() => {
              workbench.dispatch({ type: "view", view: "settings" });
              setInspectorOpen(true);
              finishNavigation();
            }}
          />
        </aside>
        <section
          id="chat"
          aria-label="任务对话"
          className="col-start-2 row-start-1 flex min-h-0 min-w-0 flex-col"
        >
          <div
            id="chat-header"
            className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-5 md:px-8 lg:px-12"
          >
            <div className="min-w-0">
              {state.session === null ? (
                <SectionLabel>任务对话</SectionLabel>
              ) : (
                <>
                  <strong className="block truncate text-sm font-semibold">
                    {state.session.title ?? "未命名会话"}
                  </strong>
                  <span
                    className="mt-0.5 block truncate text-xs text-muted"
                    title={state.session.workspace}
                  >
                    {state.session.workspace}
                  </span>
                </>
              )}
            </div>
            {state.session === null ? null : (
              <Button
                variant="ghost"
                className="px-2 text-xs"
                data-action="compact"
                disabled={state.taskRunning || !state.connected}
                title="把较早的上下文换成摘要，保留原始日志"
                onClick={() => void workbench.compact()}
              >
                <Minimize2 size={12} aria-hidden="true" />
                <span className="hidden sm:inline">压缩上下文</span>
              </Button>
            )}
          </div>
          <Timeline state={state} />
          <div
            id="approvals"
            aria-label="待审批动作"
            className="max-h-[40%] shrink-0 overflow-y-auto px-5 md:px-8 lg:px-12"
          >
            {state.approvals.map((approval) => (
              <ApprovalCard
                key={approval.requestId}
                approval={approval}
                workbench={workbench}
              />
            ))}
          </div>
          <Composer key={state.activeId ?? "no-session"} workbench={workbench} />
        </section>
        <aside
          id="inspector"
          aria-label="产物与设置"
          aria-hidden={!inspectorOpen}
          inert={!inspectorOpen}
          hidden={!inspectorOpen && !inlineInspector}
          className={`${inspectorClass} flex min-h-0 min-w-0 flex-col overflow-hidden bg-paper`}
        >
          <Inspector
            workbench={workbench}
            onClose={() => {
              setInspectorOpen(false);
              inspectorButton.current?.focus();
            }}
          />
        </aside>
      </main>

      {state.notice === null ? (
        <div id="notice" />
      ) : (
        <div
          id="notice"
          role="status"
          className="fixed right-4 bottom-6 left-4 z-40 mx-auto flex max-w-xl items-start gap-3 rounded-lg border bg-paper p-4 text-sm leading-6 shadow-lg shadow-ink/5 sm:left-auto"
        >
          <Circle
            size={9}
            fill="currentColor"
            aria-hidden="true"
            className="mt-2 shrink-0 text-accent"
          />
          <span className="notice flex-1 break-words">{state.notice}</span>
          <Button
            variant="ghost"
            className="size-6 min-h-6 px-0"
            aria-label="关闭提示"
            onClick={() => workbench.dispatch({ type: "notice", notice: null })}
          >
            <X size={14} aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  );
}

/** Keeps a flag true for `delay` ms after it turns false, so content can fade. */
function useDelayedFlag(value: boolean, delay: number): boolean {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (value) {
      setShown(true);
      return;
    }
    const timer = window.setTimeout(() => setShown(false), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return shown;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = (): void => setMatches(media.matches);
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

const STATUS_LABELS = {
  starting: "启动中",
  ready: "内核就绪",
  stopping: "关闭中",
  error: "内核错误",
} as const;

export function KernelStatus({ state }: { state: UiState }): JSX.Element {
  const status = state.connected ? state.kernel?.status : "offline";
  return (
    <span
      data-status={status}
      title={state.kernel?.dataDir}
      className="flex shrink-0 items-center gap-2 text-xs text-muted"
    >
      <span
        className={`size-1.5 rounded-full ${status === "ready" ? "bg-success" : status === "offline" || status === "error" ? "bg-accent" : "animate-pulse bg-muted"}`}
      />
      {status === "offline"
        ? "已断开 · 重连中"
        : status === undefined
          ? "连接中"
          : STATUS_LABELS[status]}
    </span>
  );
}

function Composer({ workbench }: { workbench: Workbench }): JSX.Element {
  const { state } = workbench;
  const [draft, setDraft] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const busy = state.taskRunning || workbench.sending;
  const enabled = state.session !== null && state.connected;
  useEffect(() => {
    if (enabled) textarea.current?.focus();
  }, [enabled]);
  async function send(): Promise<void> {
    if (busy) return;
    const message = draft;
    if (await workbench.send(message))
      setDraft((current) => (current === message ? "" : current));
  }
  return (
    <div className="shrink-0 px-5 pt-3 pb-4 md:px-8 md:pb-6 lg:px-12">
      <form
        id="composer"
        className="mx-auto max-w-3xl rounded-lg border border-line bg-paper transition-[border-color,box-shadow] duration-200 focus-within:border-accent/40 focus-within:shadow-[0_1px_3px_rgba(37,99,235,0.06)] focus-within:ring-2 focus-within:ring-accent/10"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label htmlFor="message" className="sr-only">
          描述任务
        </label>
        <textarea
          ref={textarea}
          id="message"
          rows={3}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={state.session === null}
          placeholder={
            state.session === null
              ? "新建或选择一个会话，开始你的任务…"
              : "你想完成什么？"
          }
          className="block max-h-48 min-h-[88px] w-full border-0 bg-transparent px-4 pt-4 pb-2 text-sm leading-6 outline-none placeholder:text-muted/60 focus-visible:outline-none disabled:cursor-not-allowed md:px-5"
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              event.nativeEvent.keyCode !== 229
            ) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className="flex min-h-11 items-center justify-between gap-2 px-3 pb-3 md:px-4">
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
            <ShieldCheck size={14} className="shrink-0" aria-hidden="true" />
            <span>
              {state.settings === null
                ? "读取设置中"
                : SCOPE_LABELS[state.settings.permissions.scope]}
            </span>
            <span className="hidden truncate border-l pl-2 text-xs sm:inline">
              {state.settings?.model.model}
            </span>
          </div>
          {busy ? (
            <Button
              id="cancel"
              data-action="cancel"
              variant="primary"
              disabled={!state.taskRunning || !state.connected}
              className="size-9 min-h-9 rounded-full border-accent bg-accent px-0 text-white hover:border-[#1d4ed8] hover:bg-[#1d4ed8]"
              aria-label="停止任务"
              title="停止任务"
              onClick={() => void workbench.cancel()}
            >
              <Square
                size={12}
                fill="currentColor"
                strokeWidth={0}
                aria-hidden="true"
              />
            </Button>
          ) : (
            <Button
              id="send"
              type="submit"
              variant="primary"
              disabled={!enabled || draft.trim() === ""}
              className="size-9 min-h-9 rounded-full border-accent bg-accent px-0 text-white hover:border-[#1d4ed8] hover:bg-[#1d4ed8]"
              aria-label="发送任务"
              title="发送任务"
            >
              <ArrowUp size={16} aria-hidden="true" />
            </Button>
          )}
        </div>
      </form>
      <div className="mx-auto mt-2.5 flex max-w-3xl items-center justify-between gap-3 text-xs text-muted">
        <span
          id="task-state"
          role="status"
          title={state.workspace}
          className="flex min-w-0 items-center gap-1.5"
        >
          <span
            className={`size-1 shrink-0 rounded-full ${busy ? "animate-pulse bg-accent" : "bg-muted/40"}`}
          />
          <span className="truncate">
            {state.workspace === "" ? "尚未选择工作区" : workspaceName(state.workspace)}
            {busy ? " · 任务运行中…" : ""}
          </span>
        </span>
        <span className="hidden sm:inline">
          <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px]">
            Enter
          </kbd>{" "}
          发送<span className="mx-1.5 text-muted/50">/</span>
          <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px]">
            Shift + Enter
          </kbd>{" "}
          换行
        </span>
      </div>
    </div>
  );
}

export function ApprovalCard({
  approval,
  workbench,
}: {
  approval: PendingApproval;
  workbench: Workbench;
}): JSX.Element {
  const [pending, setPending] = useState(false);
  async function answer(approved: boolean): Promise<void> {
    if (pending) return;
    setPending(true);
    try {
      await workbench.answerApproval(approval.sessionId, approval.requestId, approved);
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      className="approval mx-auto mb-4 max-w-3xl rounded-lg border border-line border-l-2 border-l-accent bg-paper p-4 shadow-[0_1px_2px_rgba(31,35,40,0.04)]"
      data-request={approval.requestId}
      aria-label="需要审批"
    >
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck size={16} className="text-accent" aria-hidden="true" />
        需要审批
        <span className="ml-auto font-mono text-xs font-normal text-muted">
          {approval.tool}
        </span>
      </h3>
      <dl className="my-4 grid grid-cols-[36px_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px] leading-6">
        <dt className="text-muted">理由</dt>
        <dd className="break-words">{approval.reason}</dd>
        <dt className="text-muted">目标</dt>
        <dd className="font-mono text-xs leading-6 break-all">{approval.target}</dd>
        <dt className="text-muted">影响</dt>
        <dd className="break-words">{approval.impact}</dd>
        <dt className="text-muted">会话</dt>
        <dd className="font-mono text-xs leading-6">
          {approval.sessionId.slice(0, 8)}
        </dd>
      </dl>
      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={pending || !workbench.state.connected}
          data-action="approve"
          data-session={approval.sessionId}
          data-request={approval.requestId}
          onClick={() => void answer(true)}
        >
          <Check size={13} aria-hidden="true" />
          允许一次
        </Button>
        <Button
          disabled={pending || !workbench.state.connected}
          data-action="reject"
          data-session={approval.sessionId}
          data-request={approval.requestId}
          onClick={() => void answer(false)}
        >
          拒绝
        </Button>
      </div>
    </section>
  );
}
