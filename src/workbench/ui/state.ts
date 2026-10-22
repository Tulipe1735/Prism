import type { KernelEvent, KernelStatus } from "../../kernel/events.ts";
import type { KernelSettings } from "../../kernel/kernel.ts";
import type { SessionEntry, SessionSummary } from "../../kernel/session.ts";
import { compareSessions } from "../../kernel/session.ts";
import {
  groupSessions,
  isTaskRunning,
  searchSessions,
  type SessionGroup,
} from "./derive.ts";

export type UiView = "artifacts" | "settings";

/** An approval the user still has to answer. */
export interface PendingApproval {
  sessionId: string;
  requestId: string;
  tool: string;
  reason: string;
  target: string;
  impact: string;
}

export interface OpenEdit {
  kind: "rename" | "delete";
  sessionId: string;
}

export interface UiState {
  /** True while the event stream is open. */
  connected: boolean;
  kernel: { status: KernelStatus; version: string; dataDir: string } | null;
  /** Workspace the sidebar shows and new sessions are created in. */
  workspace: string;
  /** Workspaces the user opened before, newest first. */
  recents: string[];
  sessions: SessionSummary[];
  activeId: string | null;
  session: SessionSummary | null;
  entries: SessionEntry[];
  /** Assistant text still streaming, by entry id. */
  deltas: Record<string, string>;
  approvals: PendingApproval[];
  taskRunning: boolean;
  search: string;
  view: UiView;
  settings: KernelSettings | null;
  notice: string | null;
  edit: OpenEdit | null;
}

export type UiAction =
  | { type: "connected"; connected: boolean }
  | { type: "event"; event: KernelEvent }
  | { type: "settings"; settings: KernelSettings }
  | { type: "workspace"; workspace: string }
  | { type: "sessions"; sessions: SessionSummary[] }
  | { type: "open"; session: SessionSummary; entries: SessionEntry[] }
  | { type: "entries"; entries: SessionEntry[] }
  | { type: "close" }
  | { type: "search"; query: string }
  | { type: "view"; view: UiView }
  | { type: "notice"; notice: string | null }
  | { type: "edit"; edit: OpenEdit | null }
  | { type: "approval.answer"; requestId: string; approved: boolean };

export function emptyState(workspace = ""): UiState {
  return {
    connected: false,
    kernel: null,
    workspace,
    recents: [],
    sessions: [],
    activeId: null,
    session: null,
    entries: [],
    deltas: {},
    approvals: [],
    taskRunning: false,
    search: "",
    view: "artifacts",
    settings: null,
    notice: null,
    edit: null,
  };
}

/** Folds one action into the state; every view is a function of this state. */
export function reduce(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case "connected":
      return { ...state, connected: action.connected };
    case "event":
      return reduceEvent(state, action.event);
    case "settings":
      return { ...state, settings: action.settings };
    case "workspace": {
      const sameWorkspace = state.session?.workspace === action.workspace;
      return {
        ...state,
        workspace: action.workspace,
        recents: [
          action.workspace,
          ...state.recents.filter((path) => path !== action.workspace),
        ],
        ...(sameWorkspace
          ? {}
          : {
              activeId: null,
              session: null,
              entries: [],
              deltas: {},
              taskRunning: false,
              edit: null,
            }),
      };
    }
    case "sessions":
      return { ...state, sessions: sortSessions(action.sessions) };
    case "open":
      return {
        ...state,
        activeId: action.session.id,
        session: action.session,
        workspace: action.session.workspace,
        entries: action.entries,
        deltas: {},
        taskRunning: isTaskRunning(action.entries),
        edit: null,
      };
    case "entries":
      return {
        ...state,
        entries: action.entries,
        deltas: withoutLogged(state.deltas, action.entries),
        taskRunning: isTaskRunning(action.entries),
      };
    case "close":
      return {
        ...state,
        activeId: null,
        session: null,
        entries: [],
        taskRunning: false,
      };
    case "search":
      return { ...state, search: action.query };
    case "view":
      return { ...state, view: action.view };
    case "notice":
      return { ...state, notice: action.notice };
    case "edit":
      return { ...state, edit: action.edit };
    case "approval.answer":
      return {
        ...state,
        approvals: state.approvals.filter(
          (approval) => approval.requestId !== action.requestId,
        ),
        notice: action.approved ? "已允许一次（只对本次动作生效）" : "已拒绝本次动作",
      };
  }
}

function reduceEvent(state: UiState, event: KernelEvent): UiState {
  switch (event.type) {
    case "plugins.updated":
    case "plugin.event":
      return state;
    case "kernel.status":
      return {
        ...state,
        connected: true,
        kernel: {
          status: event.status,
          version: event.version,
          dataDir: event.dataDir,
        },
      };
    case "session.updated":
      return {
        ...state,
        sessions: sortSessions(upsert(state.sessions, event.session)),
        session: state.activeId === event.session.id ? event.session : state.session,
      };
    case "message.delta":
      if (event.sessionId !== state.activeId) return state;
      return {
        ...state,
        taskRunning: true,
        deltas: {
          ...state.deltas,
          [event.entryId]: `${state.deltas[event.entryId] ?? ""}${event.delta}`,
        },
      };
    case "tool.started":
    case "tool.completed":
    case "tool.failed":
      if (event.sessionId !== state.activeId) return state;
      return { ...state, taskRunning: true };
    case "approval.requested": {
      const approval: PendingApproval = {
        sessionId: event.sessionId,
        requestId: event.requestId,
        tool: event.tool,
        reason: event.reason,
        target: event.target,
        impact: event.impact,
      };
      return {
        ...state,
        taskRunning: state.activeId === event.sessionId ? true : state.taskRunning,
        approvals: [
          ...state.approvals.filter((entry) => entry.requestId !== approval.requestId),
          approval,
        ],
      };
    }
    case "approval.resolved":
      return {
        ...state,
        approvals: state.approvals.filter(
          (approval) => approval.requestId !== event.requestId,
        ),
      };
    case "session.compacted":
      // The compaction entry itself arrives with the next log reload; the
      // notice says why the context shrank.
      return {
        ...state,
        notice:
          event.reason === "manual"
            ? "上下文已压缩（手动）。"
            : "上下文接近上限，已自动压缩。",
      };
  }
}

/** The sidebar list: grouped by workspace, filtered by the search box. */
export function selectVisibleSessions(state: UiState): SessionGroup[] {
  const groups = groupSessions(searchSessions(state.sessions, state.search));
  const grouped = new Set(groups.map((group) => group.workspace));
  const query = state.search.trim().toLocaleLowerCase();
  for (const workspace of selectKnownWorkspaces(state)) {
    if (!grouped.has(workspace) && workspace.toLocaleLowerCase().includes(query))
      groups.push({ workspace, sessions: [] });
  }
  return groups;
}

/** Workspaces the user can pick without typing: sessions plus recent picks. */
export function selectKnownWorkspaces(state: UiState): string[] {
  return [
    ...new Set([
      ...state.recents,
      ...state.sessions.map((session) => session.workspace),
      ...(state.workspace === "" ? [] : [state.workspace]),
    ]),
  ];
}

function upsert(sessions: SessionSummary[], session: SessionSummary): SessionSummary[] {
  return [...sessions.filter((existing) => existing.id !== session.id), session];
}

function sortSessions(sessions: SessionSummary[]): SessionSummary[] {
  return [...sessions].sort(compareSessions);
}

function withoutLogged(
  deltas: Record<string, string>,
  entries: SessionEntry[],
): Record<string, string> {
  const logged = new Set(entries.map((entry) => entry.id));
  return Object.fromEntries(
    Object.entries(deltas).filter(([entryId]) => !logged.has(entryId)),
  );
}
