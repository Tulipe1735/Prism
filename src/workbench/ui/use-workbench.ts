import type { Dispatch } from "react";
import type { KernelEvent } from "../../kernel/events.ts";
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { KernelClient, type SettingsPatch } from "./client.ts";
import { emptyState, reduce, type UiAction, type UiState } from "./state.ts";

const RECENTS_KEY = "prism.workbench.workspaces";
const WORKSPACE_KEY = "prism.workbench.workspace";

function bootState(): UiState {
  let recents: string[] = [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]");
    if (Array.isArray(parsed))
      recents = parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    // A malformed recent-workspace list does not prevent opening the workbench.
  }
  return {
    ...emptyState(localStorage.getItem(WORKSPACE_KEY) ?? ""),
    recents,
    view:
      new URLSearchParams(window.location.search).get("setup") === "model"
        ? "settings"
        : "artifacts",
  };
}

/** React owns the UI; the existing reducer and client own the kernel contract. */
export function useWorkbench(): Workbench {
  const [state, dispatch] = useReducer(reduce, undefined, bootState);
  const [client] = useState(() => new KernelClient());
  const [sending, setSending] = useState(false);
  const latest = useRef(state);
  const navigation = useRef(0);
  const sendingNow = useRef(false);
  const reloadSession = useRef(() => {});

  useLayoutEffect(() => {
    latest.current = state;
  }, [state]);

  useEffect(() => {
    localStorage.setItem(WORKSPACE_KEY, state.workspace);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(state.recents.slice(0, 8)));
  }, [state.workspace, state.recents]);

  useEffect(() => {
    let disposed = false;
    let reloadRunning = false;
    let reloadQueued = false;
    const report = (error: unknown): void => {
      if (!disposed) dispatch({ type: "notice", notice: describe(error) });
    };
    const refresh = (): void => {
      void client
        .listSessions()
        .then((sessions) => {
          if (!disposed) dispatch({ type: "sessions", sessions });
        })
        .catch(report);
      void client
        .settings()
        .then((settings) => {
          if (!disposed) dispatch({ type: "settings", settings });
        })
        .catch(report);
    };
    // Bursts of events coalesce into a read of the authoritative session log.
    const reload = (): void => {
      if (disposed) return;
      if (reloadRunning) {
        reloadQueued = true;
        return;
      }
      const id = latest.current.activeId;
      if (id === null) return;
      reloadRunning = true;
      void client
        .readSession(id)
        .then((log) => {
          if (!disposed && latest.current.activeId === log.session.id) {
            dispatch({ type: "entries", entries: log.entries });
            dispatch({
              type: "runtime",
              sessionId: log.session.id,
              running: log.running,
              approvals: log.approvals,
            });
          }
        })
        .catch(report)
        .finally(() => {
          reloadRunning = false;
          if (reloadQueued) {
            reloadQueued = false;
            reload();
          }
        });
    };
    reloadSession.current = reload;
    const onEvent = (event: KernelEvent): void => {
      if (disposed) return;
      dispatch({ type: "event", event });
      if (event.type === "stream.reset") {
        refresh();
        reload();
      }
      const changedId =
        event.type === "session.updated"
          ? event.session.id
          : event.type === "session.compacted"
            ? event.sessionId
            : null;
      if (changedId !== null && changedId === latest.current.activeId) reload();
    };
    const close = client.openEvents({
      onEvent,
      onState: (stream) => {
        if (disposed) return;
        dispatch({ type: "connected", connected: stream === "open" });
        dispatch({
          type: "notice",
          notice: stream === "open" ? null : "内核连接已断开，正在重连…",
        });
        if (stream === "open") {
          refresh();
          reload();
        }
      },
    });
    return () => {
      disposed = true;
      close();
      reloadSession.current = () => {};
    };
  }, [client]);

  async function attempt<T>(action: () => Promise<T>): Promise<T | undefined> {
    try {
      return await action();
    } catch (error: unknown) {
      dispatch({ type: "notice", notice: describe(error) });
      return undefined;
    }
  }

  function openWorkspace(value: string): string | null {
    const workspace = value.trim();
    if (workspace === "") {
      dispatch({ type: "notice", notice: "先选择一个当前运行环境中的工作区目录。" });
      return null;
    }
    navigation.current += 1;
    dispatch({ type: "workspace", workspace });
    return workspace;
  }

  async function newSession(value: string): Promise<boolean> {
    const workspace = openWorkspace(value);
    if (workspace === null) return false;
    const request = navigation.current;
    const session = await attempt(() => client.createSession({ workspace }));
    if (session === undefined) return false;
    dispatch({ type: "event", event: { type: "session.updated", session } });
    if (request === navigation.current)
      dispatch({ type: "open", session, entries: [] });
    return true;
  }

  async function openSession(id: string): Promise<void> {
    if (id === state.activeId) return;
    const request = ++navigation.current;
    const log = await attempt(() => client.readSession(id));
    if (log !== undefined && request === navigation.current) {
      dispatch({ type: "open", session: log.session, entries: log.entries });
      dispatch({
        type: "runtime",
        sessionId: log.session.id,
        running: log.running,
        approvals: log.approvals,
      });
    }
  }

  async function rename(id: string, title: string): Promise<void> {
    if (title.trim() === "") return;
    const session = await attempt(() => client.renameSession(id, title.trim()));
    if (session !== undefined) {
      dispatch({ type: "event", event: { type: "session.updated", session } });
      dispatch({ type: "edit", edit: null });
    }
  }

  async function deleteSession(id: string): Promise<void> {
    await attempt(async () => {
      await client.deleteSession(id);
      if (latest.current.activeId === id) dispatch({ type: "close" });
      dispatch({ type: "edit", edit: null });
      dispatch({ type: "sessions", sessions: await client.listSessions() });
    });
  }

  async function answerApproval(
    sessionId: string,
    requestId: string,
    approved: boolean,
  ): Promise<void> {
    await attempt(async () => {
      await client.answerApproval(sessionId, requestId, approved);
      dispatch({ type: "approval.answer", requestId, approved });
    });
  }

  async function send(text: string, files: File[] = []): Promise<boolean> {
    const id = state.activeId;
    if (id === null || (text.trim() === "" && files.length === 0) || sendingNow.current)
      return false;
    sendingNow.current = true;
    setSending(true);
    try {
      const attachments = await Promise.all(
        files.map((file) => client.uploadAttachment(id, file)),
      );
      if (latest.current.activeId !== id)
        throw new Error("会话已切换，消息未发送。请在目标会话中重试。");
      const sendInput = latest.current.taskRunning
        ? client.steerSession.bind(client)
        : client.sendMessage.bind(client);
      await sendInput(
        id,
        text.trim(),
        attachments.map((file) => file.id),
      );
      return true;
    } catch (error: unknown) {
      dispatch({ type: "notice", notice: describe(error) });
      return false;
    } finally {
      sendingNow.current = false;
      setSending(false);
    }
  }

  async function cancel(): Promise<void> {
    const id = state.activeId;
    if (id === null) return;
    await attempt(async () => {
      if (!(await client.cancelSession(id)))
        dispatch({ type: "notice", notice: "该会话没有运行中的任务。" });
    });
  }

  async function compact(): Promise<void> {
    const id = state.activeId;
    if (id === null) return;
    await attempt(async () => {
      const { compacted } = await client.compactSession(id);
      dispatch({
        type: "notice",
        notice: compacted
          ? "已压缩上下文；原始条目仍在会话日志里。"
          : "上下文还在保留窗口内，没有可压缩的内容。",
      });
      if (compacted) reloadSession.current();
    });
  }

  async function updateSettings(patch: SettingsPatch): Promise<boolean> {
    const settings = await attempt(() => client.updateSettings(patch));
    if (settings === undefined) return false;
    dispatch({ type: "settings", settings });
    dispatch({ type: "notice", notice: "设置已保存。" });
    return true;
  }

  return {
    state,
    dispatch,
    sending,
    openWorkspace,
    newSession,
    openSession,
    rename,
    deleteSession,
    answerApproval,
    send,
    cancel,
    compact,
    updateSettings,
  };
}

export interface Workbench {
  state: UiState;
  dispatch: Dispatch<UiAction>;
  sending: boolean;
  openWorkspace: (value: string) => string | null;
  newSession: (value: string) => Promise<boolean>;
  openSession: (id: string) => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  answerApproval: (
    sessionId: string,
    requestId: string,
    approved: boolean,
  ) => Promise<void>;
  send: (text: string, files?: File[]) => Promise<boolean>;
  cancel: () => Promise<void>;
  compact: () => Promise<void>;
  updateSettings: (patch: SettingsPatch) => Promise<boolean>;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
