import type { JSX } from "react";
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
  Settings2,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Button, SectionLabel, workspaceName } from "./components.tsx";
import { selectKnownWorkspaces, selectVisibleSessions } from "./state.ts";

export function Sidebar({
  workbench,
  onNavigate,
  onSettings,
}: {
  workbench: Workbench;
  onNavigate: () => void;
  onSettings: () => void;
}): JSX.Element {
  const { state } = workbench;
  const [creating, setCreating] = useState(false);
  const groups = selectVisibleSessions(state);

  async function create(): Promise<void> {
    if (creating) return;
    setCreating(true);
    try {
      if (await workbench.newSession(state.workspace)) onNavigate();
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <div className="border-b px-5 py-6">
        <SectionLabel number="01">Workspace / 工作区</SectionLabel>
        <WorkspacePicker
          key={state.workspace}
          state={state}
          onOpen={workbench.openWorkspace}
        />
        <Button
          variant="primary"
          className="mt-4 w-full justify-between"
          onClick={() => void create()}
          disabled={creating || !state.connected}
          data-action="new-session"
        >
          {creating ? "正在创建…" : "新建会话"}
          <Plus size={15} aria-hidden="true" />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-3 py-5">
        <div className="flex items-center justify-between px-2">
          <h2 className="eyebrow">Sessions / 会话</h2>
          <span className="font-mono text-[10px] text-muted">
            {String(state.sessions.length).padStart(2, "0")}
          </span>
        </div>
        <div className="relative mx-2 mt-4 mb-3">
          <Search
            size={14}
            aria-hidden="true"
            className="pointer-events-none absolute top-2.5 left-2.5 text-muted"
          />
          <input
            id="search"
            aria-label="搜索会话"
            placeholder="搜索会话"
            value={state.search}
            onChange={(event) =>
              workbench.dispatch({ type: "search", query: event.target.value })
            }
            className="field border-transparent bg-surface/60 py-2 pl-8"
            autoComplete="off"
          />
        </div>
        <nav
          id="session-list"
          aria-label="会话列表"
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {groups.length === 0 ? (
            <div className="empty px-3 py-8 text-xs leading-6 text-muted">
              <MessageSquare
                size={19}
                strokeWidth={1.3}
                aria-hidden="true"
                className="mb-3"
              />
              {state.search.trim() === ""
                ? "还没有会话。打开工作区，开始第一个任务。"
                : "没有匹配的会话。"}
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.workspace} className="group mb-5">
                <h3
                  title={group.workspace}
                  className="mb-2 flex items-center gap-2 truncate px-2 text-[11px] text-muted"
                >
                  <FolderOpen size={13} aria-hidden="true" />
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
      <div className="border-t p-3">
        <Button variant="ghost" className="w-full justify-start" onClick={onSettings}>
          <Settings2 size={15} aria-hidden="true" />
          工作台设置
        </Button>
        <p className="px-3 pt-3 pb-1 font-mono text-[9px] tracking-wider text-muted">
          YOUR WORK. YOUR SPACE.
        </p>
      </div>
    </>
  );
}

function WorkspacePicker({
  state,
  onOpen,
}: {
  state: UiState;
  onOpen: (value: string) => string | null;
}): JSX.Element {
  const [path, setPath] = useState(state.workspace);
  return (
    <form
      className="mt-5"
      onSubmit={(event) => {
        event.preventDefault();
        onOpen(path);
      }}
    >
      <label htmlFor="workspace-input" className="mb-2 block text-sm font-semibold">
        {state.workspace === "" ? "选择你的工作区" : workspaceName(state.workspace)}
      </label>
      <div className="flex items-center gap-2">
        <input
          id="workspace-input"
          aria-label="工作区路径"
          list="known-workspaces"
          value={path}
          onChange={(event) => setPath(event.target.value)}
          placeholder="/home/you/project"
          className="field font-mono text-[11px]"
          autoComplete="off"
        />
        <Button
          type="submit"
          data-action="use-workspace"
          title="打开工作区"
          aria-label="打开工作区"
          className="size-9 px-0"
        >
          <ArrowUpRight size={16} aria-hidden="true" />
        </Button>
      </div>
      <datalist id="known-workspaces">
        {selectKnownWorkspaces(state).map((workspace) => (
          <option key={workspace} value={workspace} />
        ))}
      </datalist>
      <p className="mt-2 text-[10px] text-muted">输入 WSL 中的项目目录</p>
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
      <div className="session mb-1 rounded-sm border border-accent/30 bg-accent-soft p-3">
        <p className="title truncate text-xs font-medium">{title}</p>
        <p className="my-2 text-[11px] leading-5 text-muted">删除这个会话及其日志？</p>
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
      className={`session group/row relative mb-1 border-l-2 ${active ? "active border-accent bg-surface" : "border-transparent hover:bg-surface/60"}`}
    >
      <button
        type="button"
        data-action="open-session"
        data-session={session.id}
        aria-current={active ? "page" : undefined}
        onClick={() => {
          void workbench.openSession(session.id);
          onNavigate();
        }}
        className="block w-full min-w-0 py-3 pr-17 pl-3 text-left"
      >
        <span
          className={`title block truncate text-xs ${active ? "font-semibold" : "font-medium"}`}
        >
          {title}
        </span>
        <span className="mt-1.5 block font-mono text-[9px] text-muted">
          {session.entryCount} 条记录 · {formatDate(session.updatedAt)}
        </span>
      </button>
      <div className="absolute top-2 right-1 flex opacity-50 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100">
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
      className="session space-y-2 border p-3"
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
    month: "2-digit",
    day: "2-digit",
  });
}
