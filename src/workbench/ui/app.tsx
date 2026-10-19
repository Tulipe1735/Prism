import type { JSX } from "react";
import type { PendingApproval, UiState } from "./state.ts";
import type { Workbench } from "./use-workbench.ts";
import {
  ArrowUp,
  Check,
  ChevronRight,
  Circle,
  Files,
  Menu,
  Minimize2,
  ShieldCheck,
  Square,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, SCOPE_LABELS, SectionLabel, workspaceName } from "./components.tsx";
import { Inspector } from "./inspector.tsx";
import { Sidebar } from "./sidebar.tsx";
import { Timeline } from "./timeline.tsx";
import { useWorkbench } from "./use-workbench.ts";

export function App(): JSX.Element {
  const workbench = useWorkbench();
  const { state } = workbench;
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(
    () => new URLSearchParams(window.location.search).get("setup") === "model",
  );
  const navigationButton = useRef<HTMLButtonElement>(null);
  const inspectorButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (inspectorOpen) inspectorButton.current?.focus();
      else if (navigationOpen) navigationButton.current?.focus();
      setNavigationOpen(false);
      setInspectorOpen(false);
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [navigationOpen, inspectorOpen]);

  return (
    <div className="grid h-dvh grid-rows-[64px_minmax(0,1fr)_32px] overflow-hidden">
      <a
        href="#message"
        className="fixed top-2 left-2 z-50 -translate-y-20 bg-ink px-4 py-2 text-xs text-paper focus:translate-y-0"
      >
        跳到任务输入
      </a>
      <header id="topbar" className="flex min-w-0 items-center border-b">
        <div className="flex h-full w-auto shrink-0 items-center gap-3 px-5 md:w-60 md:border-r xl:w-63">
          <img
            src="assets/prism-logo.svg"
            alt="Prism"
            width={112}
            height={40}
            className="block h-10 w-28 shrink-0"
          />
          <span className="eyebrow ml-auto hidden text-[9px] md:block">Workbench</span>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-3 px-2 md:px-6">
          <button
            ref={navigationButton}
            type="button"
            aria-label="切换会话导航"
            aria-expanded={navigationOpen}
            aria-controls="sidebar"
            onClick={() => {
              setNavigationOpen(!navigationOpen);
              setInspectorOpen(false);
            }}
            className="flex size-9 shrink-0 items-center justify-center rounded-sm hover:bg-surface md:hidden"
          >
            <Menu size={17} aria-hidden="true" />
          </button>
          <div className="hidden min-w-0 items-center gap-2 text-[11px] sm:flex">
            <span className="text-muted">工作台</span>
            <ChevronRight size={12} className="text-muted" aria-hidden="true" />
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
            aria-label="打开产物与设置"
            aria-controls="inspector"
            aria-expanded={inspectorOpen}
            onClick={() => {
              setInspectorOpen(!inspectorOpen);
              setNavigationOpen(false);
            }}
            className="flex size-9 shrink-0 items-center justify-center rounded-sm hover:bg-surface xl:hidden"
          >
            <Files size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="eyebrow hidden w-80 shrink-0 px-5 xl:block">
          A space for focused work
        </div>
      </header>

      <main className="relative grid min-h-0 grid-cols-[minmax(0,1fr)] md:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[252px_minmax(0,1fr)_320px]">
        {navigationOpen || inspectorOpen ? (
          <button
            type="button"
            aria-label="关闭侧栏"
            className={`fixed top-16 right-0 bottom-8 left-0 z-20 bg-ink/10 ${inspectorOpen ? "xl:hidden" : "md:hidden"}`}
            onClick={() => {
              setNavigationOpen(false);
              setInspectorOpen(false);
            }}
          />
        ) : null}
        <aside
          id="sidebar"
          aria-label="工作区与会话"
          className={`${navigationOpen ? "fixed top-16 bottom-8 left-0 z-30 flex w-[min(88vw,280px)] shadow-xl md:shadow-none" : "hidden"} min-h-0 flex-col border-r bg-paper md:static md:flex md:w-auto`}
        >
          <Sidebar
            workbench={workbench}
            onNavigate={() => setNavigationOpen(false)}
            onSettings={() => {
              workbench.dispatch({ type: "view", view: "settings" });
              setInspectorOpen(true);
              setNavigationOpen(false);
            }}
          />
        </aside>
        <section
          id="chat"
          aria-label="任务对话"
          className="flex min-h-0 min-w-0 flex-col"
        >
          <div
            id="chat-header"
            className="flex h-16 shrink-0 items-center justify-between gap-3 border-b px-5 md:px-8 lg:px-12"
          >
            <div className="min-w-0">
              {state.session === null ? (
                <SectionLabel number="02">Conversation / 任务对话</SectionLabel>
              ) : (
                <>
                  <strong className="block truncate text-xs font-semibold">
                    {state.session.title ?? "未命名会话"}
                  </strong>
                  <span
                    className="mt-1 block truncate font-mono text-[9px] text-muted"
                    title={state.session.workspace}
                  >
                    {state.session.workspace}
                  </span>
                </>
              )}
            </div>
            {state.session === null ? (
              <span className="eyebrow hidden text-[9px] sm:block">
                Make room for progress
              </span>
            ) : (
              <Button
                variant="ghost"
                className="px-2 text-[10px]"
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
          className={`${inspectorOpen ? "fixed top-16 right-0 bottom-8 z-30 flex w-[min(92vw,360px)] shadow-xl xl:shadow-none" : "hidden"} min-h-0 min-w-0 flex-col border-l bg-paper xl:static xl:flex xl:w-auto`}
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

      <footer className="flex items-center justify-between gap-3 border-t px-5 font-mono text-[9px] text-muted">
        <span className="tracking-[0.12em]">PRISM / PERSONAL CODING AGENT</span>
        <span className="hidden sm:inline">
          {state.workspace === "" ? "等待选择工作区" : state.workspace}
        </span>
        <span>{state.kernel === null ? "CONNECTING" : `v${state.kernel.version}`}</span>
      </footer>
      {state.notice === null ? (
        <div id="notice" />
      ) : (
        <div
          id="notice"
          role="status"
          className="fixed right-4 bottom-12 left-4 z-40 mx-auto flex max-w-xl items-start gap-3 rounded-sm border bg-paper p-4 text-xs leading-6 shadow-lg sm:left-auto"
        >
          <Circle
            size={12}
            aria-hidden="true"
            className="mt-1.5 shrink-0 text-accent"
          />
          <span className="notice flex-1 break-words">{state.notice}</span>
          <Button
            variant="ghost"
            className="size-6 min-h-6 px-0"
            aria-label="关闭提示"
            onClick={() => workbench.dispatch({ type: "notice", notice: null })}
          >
            <X size={13} aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  );
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
      className="flex shrink-0 items-center gap-2 text-[10px] text-muted"
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
        className="mx-auto max-w-3xl rounded-sm border border-line bg-white/60 transition-colors focus-within:border-ink"
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
          className="block max-h-48 min-h-24 w-full border-0 bg-transparent px-4 pt-4 pb-2 text-[13px] leading-6 outline-none placeholder:text-muted/70 focus-visible:outline-none disabled:cursor-not-allowed md:px-5"
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
        <div className="flex min-h-12 items-center justify-between gap-2 px-3 pb-3 md:px-4">
          <div className="flex min-w-0 items-center gap-2 text-[10px] text-muted">
            <ShieldCheck size={13} className="shrink-0" aria-hidden="true" />
            <span>
              {state.settings === null
                ? "读取设置中"
                : SCOPE_LABELS[state.settings.permissions.scope]}
            </span>
            <span className="hidden truncate border-l pl-2 font-mono text-[9px] sm:inline">
              {state.settings?.model.model}
            </span>
          </div>
          {busy ? (
            <Button
              id="cancel"
              data-action="cancel"
              disabled={!state.taskRunning || !state.connected}
              onClick={() => void workbench.cancel()}
            >
              <Square size={10} fill="currentColor" aria-hidden="true" />
              取消任务
            </Button>
          ) : (
            <Button
              id="send"
              type="submit"
              variant="primary"
              disabled={!enabled || draft.trim() === ""}
              className="size-8 min-h-8 px-0"
              aria-label="发送任务"
              title="发送任务"
            >
              <ArrowUp size={16} aria-hidden="true" />
            </Button>
          )}
        </div>
      </form>
      <div className="mx-auto mt-3 flex max-w-3xl items-center justify-between gap-3 text-[9px] text-muted">
        <span id="task-state" role="status" className="flex items-center gap-1.5">
          <span
            className={`size-1 rounded-full ${busy ? "animate-pulse bg-accent" : "bg-muted/50"}`}
          />
          {state.session === null
            ? "准备好，开始下一件事。"
            : busy
              ? "任务运行中…"
              : "空闲 · 随时开始"}
        </span>
        <span className="hidden sm:inline">
          <kbd className="font-mono">Enter</kbd> 发送<span className="mx-1.5">/</span>
          <kbd className="font-mono">Shift + Enter</kbd> 换行
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
      className="approval mx-auto mb-4 max-w-3xl border border-accent/40 bg-accent-soft p-4"
      data-request={approval.requestId}
      aria-label="需要审批"
    >
      <h3 className="flex items-center gap-2 text-xs font-semibold">
        <ShieldCheck size={15} className="text-accent" aria-hidden="true" />
        需要审批
        <span className="ml-auto font-mono text-[10px] text-muted">
          {approval.tool}
        </span>
      </h3>
      <dl className="my-4 grid grid-cols-[32px_minmax(0,1fr)] gap-x-4 gap-y-2 text-[11px] leading-6">
        <dt className="text-muted">理由</dt>
        <dd className="break-words">{approval.reason}</dd>
        <dt className="text-muted">目标</dt>
        <dd className="font-mono break-all">{approval.target}</dd>
        <dt className="text-muted">影响</dt>
        <dd className="break-words">{approval.impact}</dd>
        <dt className="text-muted">会话</dt>
        <dd className="font-mono">{approval.sessionId.slice(0, 8)}</dd>
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
          <Check size={12} aria-hidden="true" />
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
