import type { JSX, RefObject } from "react";
import type { SessionSummary } from "../../kernel/session.ts";
import type { UiState } from "./state.ts";
import type { Workbench } from "./use-workbench.ts";
import {
  ArrowUpRight,
  FolderOpen,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AccountMenu } from "./account-menu.tsx";
import { Button, SectionLabel, workspaceName } from "./components.tsx";
import { selectKnownWorkspaces, selectVisibleSessions } from "./state.ts";

export function Sidebar({
  workbench,
  collapsed,
  onExpand,
  onNavigate,
  onSettings,
}: {
  workbench: Workbench;
  collapsed: boolean;
  onExpand: () => void;
  onNavigate: () => void;
  onSettings: () => void;
}): JSX.Element {
  const { state } = workbench;
  const [creating, setCreating] = useState(false);
  const workspaceInput = useRef<HTMLInputElement>(null);
  const focusWorkspace = useRef(false);
  const groups = selectVisibleSessions(state);

  useEffect(() => {
    if (!collapsed && focusWorkspace.current) {
      workspaceInput.current?.focus();
      focusWorkspace.current = false;
    }
  }, [collapsed]);

  async function create(): Promise<void> {
    if (creating) return;
    if (collapsed && state.workspace === "") {
      focusWorkspace.current = true;
      onExpand();
      return;
    }
    setCreating(true);
    try {
      if (await workbench.newSession(state.workspace)) onNavigate();
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <Button
        variant="primary"
        hidden={!collapsed}
        className="mx-auto mt-5 size-10 rounded-full px-0"
        onClick={() => void create()}
        disabled={creating || !state.connected}
        data-action="new-session-compact"
        aria-label="新建会话"
        title="新建会话"
        aria-busy={creating}
      >
        <Plus size={18} aria-hidden="true" />
      </Button>
      <div hidden={collapsed} className="flex min-h-0 flex-1 flex-col">
        <div className="border-b px-5 pt-6 pb-5">
          <SectionLabel>工作区</SectionLabel>
          <WorkspacePicker
            key={state.workspace}
            inputRef={workspaceInput}
            state={state}
            onOpen={workbench.openWorkspace}
          />
          <Button
            variant="primary"
            className="mt-3.5 w-full justify-between"
            onClick={() => void create()}
            disabled={creating || !state.connected}
            data-action="new-session"
          >
            {creating ? "正在创建…" : "新建会话"}
            <Plus size={15} aria-hidden="true" />
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-3 py-5">
          <h2 className="px-2 text-xs font-semibold tracking-[0.01em] text-muted">
            会话
          </h2>
          <div className="relative mx-2 mt-3 mb-3">
            <Search
              size={14}
              aria-hidden="true"
              className="pointer-events-none absolute top-2.5 left-2.5 text-muted/70"
            />
            <input
              id="search"
              aria-label="搜索会话"
              placeholder="搜索会话"
              value={state.search}
              onChange={(event) =>
                workbench.dispatch({ type: "search", query: event.target.value })
              }
              className="field py-2 pl-8"
              autoComplete="off"
            />
          </div>
          <nav
            id="session-list"
            aria-label="会话列表"
            className="min-h-0 flex-1 overflow-y-auto"
          >
            {groups.length === 0 ? (
              <div className="empty px-3 py-8 text-[13px] leading-6 text-muted">
                <MessageSquare
                  size={20}
                  strokeWidth={1.4}
                  aria-hidden="true"
                  className="mb-3 text-muted/70"
                />
                {state.search.trim() === ""
                  ? "还没有会话。打开工作区，开始第一个任务。"
                  : "没有匹配的会话。"}
              </div>
            ) : (
              groups.map((group) => (
                <div key={group.workspace} className="group mb-4">
                  <h3
                    title={group.workspace}
                    className="mb-1.5 flex items-center gap-2 truncate px-2 text-xs text-muted"
                  >
                    <FolderOpen size={13} aria-hidden="true" className="shrink-0" />
                    {workspaceName(group.workspace)}
                  </h3>
                  {group.sessions.map((session) => (
                    <SessionRow
                      key={session.id}
                      session={session}
                      workbench={workbench}
                      onNavigate={onNavigate}
                    />
                  ))}
                </div>
              ))
            )}
          </nav>
        </div>
      </div>
      <div className="mt-auto shrink-0 border-t p-2.5">
        <AccountMenu
          collapsed={collapsed}
          taskRunning={state.taskRunning}
          onSettings={onSettings}
          onError={(notice) => workbench.dispatch({ type: "notice", notice })}
        />
      </div>
    </>
  );
}

function WorkspacePicker({
  state,
  inputRef,
  onOpen,
}: {
  state: UiState;
  inputRef: RefObject<HTMLInputElement | null>;
  onOpen: (value: string) => string | null;
}): JSX.Element {
  const [path, setPath] = useState(state.workspace);
  return (
    <form
      className="mt-3"
      onSubmit={(event) => {
        event.preventDefault();
        onOpen(path);
      }}
    >
      <label htmlFor="workspace-input" className="mb-2 block text-[13px] font-semibold">
        {state.workspace === "" ? "选择你的工作区" : workspaceName(state.workspace)}
      </label>
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          id="workspace-input"
          aria-label="工作区路径"
          list="known-workspaces"
          value={path}
          onChange={(event) => setPath(event.target.value)}
          placeholder="/home/you/project"
          className="field font-mono text-xs"
          autoComplete="off"
        />
        <Button
          type="submit"
          data-action="use-workspace"
          title="打开工作区"
          aria-label="打开工作区"
          className="size-9 bg-paper px-0"
        >
          <ArrowUpRight size={16} aria-hidden="true" />
        </Button>
      </div>
      <datalist id="known-workspaces">
        {selectKnownWorkspaces(state).map((workspace) => (
          <option key={workspace} value={workspace} />
        ))}
      </datalist>
    </form>
  );
}

function SessionRow({
  session,
  workbench,
  onNavigate,
}: {
  session: SessionSummary;
  workbench: Workbench;
  onNavigate: () => void;
}): JSX.Element {
  const { state, dispatch } = workbench;
  const edit = state.edit?.sessionId === session.id ? state.edit : null;
  const title = session.title ?? "未命名会话";
  const active = state.activeId === session.id;
  if (edit?.kind === "rename")
    return (
      <RenameSession
        key={`rename-${session.id}`}
        title={title}
        sessionId={session.id}
        workbench={workbench}
      />
    );
  if (edit?.kind === "delete")
    return (
      <div className="session mb-1 rounded-lg border bg-paper p-3">
        <p className="title truncate text-[13px] font-medium">{title}</p>
        <p className="my-2 text-xs leading-5 text-muted">删除这个会话及其日志？</p>
        <div className="flex gap-2">
          <Button
            data-action="delete-confirm"
            data-session={session.id}
            onClick={() => void workbench.deleteSession(session.id)}
          >
            确认删除
          </Button>
          <Button
            variant="ghost"
            onClick={() => dispatch({ type: "edit", edit: null })}
          >
            取消
          </Button>
        </div>
      </div>
    );
  return (
    <div
      className={`session group/row relative mb-0.5 rounded-md ${active ? "active bg-paper shadow-[0_1px_2px_rgba(31,35,40,0.06)]" : "hover:bg-ink/[0.035]"}`}
    >
      {active ? (
        <span
          aria-hidden="true"
          className="absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-full bg-accent"
        />
      ) : null}
      <button
        type="button"
        data-action="open-session"
        data-session={session.id}
        aria-current={active ? "page" : undefined}
        onClick={() => {
          void workbench.openSession(session.id);
          onNavigate();
        }}
        className="block w-full min-w-0 py-2.5 pr-16 pl-3 text-left"
      >
        <span
          className={`title block truncate text-[13px] ${active ? "font-semibold" : "font-medium"}`}
        >
          {title}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted">
          {formatDate(session.updatedAt)}
        </span>
      </button>
      <div className="absolute top-2 right-1 flex opacity-0 transition-opacity delay-100 duration-150 group-focus-within/row:opacity-100 group-focus-within/row:delay-0 group-hover/row:opacity-100 group-hover/row:delay-0">
        <Button
          variant="ghost"
          className="size-7 min-h-7 px-0"
          aria-label={`重命名 ${title}`}
          title="重命名"
          data-action="rename-session"
          data-session={session.id}
          onClick={() =>
            dispatch({ type: "edit", edit: { kind: "rename", sessionId: session.id } })
          }
        >
          <Pencil size={12} aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          className="size-7 min-h-7 px-0"
          aria-label={`删除 ${title}`}
          title="删除"
          data-action="delete-session"
          data-session={session.id}
          onClick={() =>
            dispatch({ type: "edit", edit: { kind: "delete", sessionId: session.id } })
          }
        >
          <Trash2 size={12} aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

function RenameSession({
  title,
  sessionId,
  workbench,
}: {
  title: string;
  sessionId: string;
  workbench: Workbench;
}): JSX.Element {
  const [value, setValue] = useState(title);
  return (
    <form
      className="session space-y-2 rounded-lg border bg-paper p-3"
      data-action="rename-form"
      data-session={sessionId}
      onSubmit={(event) => {
        event.preventDefault();
        void workbench.rename(sessionId, value);
      }}
    >
      <input
        className="field"
        name="title"
        aria-label="会话名称"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        autoFocus
        autoComplete="off"
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={value.trim() === ""}>
          保存
        </Button>
        <Button
          variant="ghost"
          onClick={() => workbench.dispatch({ type: "edit", edit: null })}
        >
          取消
        </Button>
      </div>
    </form>
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
  });
}
