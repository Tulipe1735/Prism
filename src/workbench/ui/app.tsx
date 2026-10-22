import type { JSX } from "react";
import type { PendingApproval } from "./state.ts";
import type { Workbench } from "./use-workbench.ts";
import {
  Check,
  ChevronRight,
  Circle,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, PrismMark, SectionLabel, workspaceName } from "./components.tsx";
import { Composer } from "./composer.tsx";
import { Inspector } from "./inspector.tsx";
import { PluginPanelDrawer, PluginProvider, PluginSlot } from "./plugin-slots.tsx";
import { Sidebar } from "./sidebar.tsx";
import { WorkspaceTerminal } from "./terminal.tsx";
import { Timeline } from "./timeline.tsx";
import { useWorkbench } from "./use-workbench.ts";

export function App(): JSX.Element {
  const workbench = useWorkbench();
  return (
    <PluginProvider
      connected={workbench.state.connected}
      sessionId={workbench.state.activeId}
    >
      <WorkbenchView workbench={workbench} />
    </PluginProvider>
  );
}

function WorkbenchView({ workbench }: { workbench: Workbench }): JSX.Element {
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
    <div
      data-kernel-status={state.connected ? state.kernel?.status : "offline"}
      className="grid h-dvh grid-rows-[56px_minmax(0,1fr)_auto] overflow-hidden"
    >
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
          <PluginSlot slot="workbench.header" />
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
            className="ml-auto flex size-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-ink"
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
            <div className="min-w-0 flex-1">
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
            <PluginSlot slot="session.header" />
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
          <PluginSlot slot="session.toolbar" />
          <Timeline state={state} />
          <PluginSlot slot="session.footer" />
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
          <WorkspaceTerminal workspace={state.workspace} />
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
      <PluginSlot slot="workbench.status" />
      <PluginPanelDrawer />

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
