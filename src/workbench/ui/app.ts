import type { KernelEvent } from "../../kernel/events.ts";
import type { BrowserEngine, PermissionScope } from "../../kernel/types.ts";
import { KernelApiError, KernelClient, type SettingsPatch } from "./client.ts";
import { toTimeline } from "./derive.ts";
import * as view from "./render.ts";
import { emptyState, reduce, type UiAction, type UiState } from "./state.ts";

const RECENTS_KEY = "prism.workbench.workspaces";
const WORKSPACE_KEY = "prism.workbench.workspace";

const client = new KernelClient();
let state: UiState = bootState();

/** Reload of the open session is coalesced: events arrive in bursts. */
let reloadQueued = false;
let reloadRunning = false;
/** Step ids of the last full timeline render, to patch streaming text in place. */
let timelineSignature = "";

document.addEventListener("click", (event) => void onClick(event));
document.addEventListener("submit", (event) => void onSubmit(event));
const workspaceInput = input("workspace-input");
workspaceInput.addEventListener(
  "change",
  () => void openWorkspace(workspaceInput.value),
);
input("search").addEventListener("input", (event) => {
  dispatch({ type: "search", query: (event.target as HTMLInputElement).value });
});
input("message").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void send();
  }
});

draw();
void start();

function bootState(): UiState {
  const workspace = localStorage.getItem(WORKSPACE_KEY) ?? "";
  const recents = parseRecents(localStorage.getItem(RECENTS_KEY));
  return { ...emptyState(workspace), recents };
}

function parseRecents(raw: string | null): string[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

async function start(): Promise<void> {
  client.openEvents({
    onEvent: (event) => handleEvent(event),
    onState: (streamState) => {
      dispatch({ type: "connected", connected: streamState === "open" });
      if (streamState === "open") {
        dispatch({ type: "notice", notice: null });
        void refreshSettings();
        void refreshSessions();
        if (state.activeId !== null) queueReload();
      } else {
        dispatch({ type: "notice", notice: "内核连接已断开，正在重连…" });
      }
    },
  });
  await refreshSessions();
  await refreshSettings();
}

function dispatch(action: UiAction): void {
  state = reduce(state, action);
  draw();
}

function handleEvent(event: KernelEvent): void {
  dispatch({ type: "event", event });
  if (state.activeId === null) return;
  const changedId =
    event.type === "session.updated"
      ? event.session.id
      : event.type === "session.compacted"
        ? event.sessionId
        : null;
  if (changedId === state.activeId) queueReload();
}

/** The kernel never replays events, so the open session is read back from the log. */
function queueReload(): void {
  if (reloadRunning) {
    reloadQueued = true;
    return;
  }
  const sessionId = state.activeId;
  if (sessionId === null) return;
  reloadRunning = true;
  void client
    .readSession(sessionId)
    .then((log) => {
      if (state.activeId === log.session.id)
        dispatch({ type: "entries", entries: log.entries });
    })
    .catch((error: unknown) => dispatch({ type: "notice", notice: describe(error) }))
    .finally(() => {
      reloadRunning = false;
      if (reloadQueued) {
        reloadQueued = false;
        queueReload();
      }
    });
}

async function refreshSessions(): Promise<void> {
  try {
    dispatch({ type: "sessions", sessions: await client.listSessions() });
  } catch (error: unknown) {
    dispatch({ type: "notice", notice: describe(error) });
  }
}

async function refreshSettings(): Promise<void> {
  try {
    dispatch({ type: "settings", settings: await client.settings() });
  } catch (error: unknown) {
    dispatch({ type: "notice", notice: describe(error) });
  }
}

async function onClick(event: MouseEvent): Promise<void> {
  const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
    "[data-action]",
  );
  if (target === null || target === undefined) return;
  const action = target.dataset.action;
  const sessionId = target.dataset.session;
  switch (action) {
    case "view":
      dispatch({
        type: "view",
        view: target.dataset.view === "settings" ? "settings" : "artifacts",
      });
      return;
    case "use-workspace":
      await openWorkspace(workspaceInput.value);
      return;
    case "new-session":
      await newSession();
      return;
    case "open-session":
      if (sessionId !== undefined) await openSession(sessionId);
      return;
    case "rename-session":
      if (sessionId !== undefined)
        dispatch({ type: "edit", edit: { kind: "rename", sessionId } });
      return;
    case "delete-session":
      if (sessionId !== undefined)
        dispatch({ type: "edit", edit: { kind: "delete", sessionId } });
      return;
    case "edit-cancel":
      dispatch({ type: "edit", edit: null });
      return;
    case "delete-confirm":
      if (sessionId !== undefined) await deleteSession(sessionId);
      return;
    case "approve":
    case "reject":
      if (sessionId !== undefined && target.dataset.request !== undefined)
        await answerApproval(sessionId, target.dataset.request, action === "approve");
      return;
    case "cancel":
      await cancel();
      return;
    case "set-scope":
      if (target.dataset.scope !== undefined)
        await updateSettings({
          permissions: { scope: target.dataset.scope as PermissionScope },
        });
      return;
    case "set-engine":
      if (target.dataset.engine !== undefined)
        await updateSettings({
          browser: { engine: target.dataset.engine as BrowserEngine },
        });
      return;
    case "toggle-browser-approval":
      await updateSettings({
        browser: {
          actionsNeedApproval: !(state.settings?.browser.actionsNeedApproval ?? false),
        },
      });
  }
}

/** Reads the fields of one settings form and applies them as a patch. */
async function submitSettings(form: HTMLFormElement): Promise<void> {
  const value = (name: string): string =>
    form.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value.trim() ?? "";
  if (form.dataset.section === "model")
    await updateSettings({
      model: {
        baseUrl: value("baseUrl"),
        model: value("model"),
        // An empty key field leaves the stored key as it is.
        ...(value("apiKey") === "" ? {} : { apiKey: value("apiKey") }),
      },
    });
  else if (form.dataset.section === "search")
    await updateSettings({
      search: {
        provider: value("provider"),
        ...(value("baseUrl") === "" ? {} : { baseUrl: value("baseUrl") }),
      },
    });
}

/** Applies a settings patch and keeps the settings the kernel answers with. */
async function updateSettings(patch: SettingsPatch): Promise<void> {
  try {
    dispatch({ type: "settings", settings: await client.updateSettings(patch) });
  } catch (error: unknown) {
    dispatch({ type: "notice", notice: describe(error) });
  }
}

async function onSubmit(event: SubmitEvent): Promise<void> {
  const form = event.target as HTMLElement | null;
  if (form?.id === "composer") {
    event.preventDefault();
    await send();
    return;
  }
  if (form?.dataset.action === "rename-form" && form.dataset.session !== undefined) {
    event.preventDefault();
    const title =
      form.querySelector<HTMLInputElement>('input[name="title"]')?.value ?? "";
    await rename(form.dataset.session, title);
    return;
  }
  if (form?.dataset.action === "settings-form" && form instanceof HTMLFormElement) {
    event.preventDefault();
    await submitSettings(form);
  }
}

async function openWorkspace(workspace: string): Promise<void> {
  const path = workspace.trim();
  if (path === "") {
    dispatch({ type: "notice", notice: "先填一个工作区路径（WSL 里的目录）。" });
    return;
  }
  dispatch({ type: "workspace", workspace: path });
  workspaceInput.value = path;
  localStorage.setItem(WORKSPACE_KEY, path);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(state.recents.slice(0, 8)));
  await refreshSessions();
}

async function newSession(): Promise<void> {
  if (state.workspace === "") return openWorkspace(workspaceInput.value);
  try {
    const session = await client.createSession({ workspace: state.workspace });
    dispatch({ type: "open", session, entries: [] });
    compose();
  } catch (error: unknown) {
    dispatch({ type: "notice", notice: describe(error) });
  }
}

async function openSession(sessionId: string): Promise<void> {
  if (state.activeId === sessionId) return;
  try {
    const log = await client.readSession(sessionId);
    dispatch({ type: "open", session: log.session, entries: log.entries });
    workspaceInput.value = log.session.workspace;
  } catch (error: unknown) {
    dispatch({ type: "notice", notice: describe(error) });
  }
}

async function rename(sessionId: string, title: string): Promise<void> {
  dispatch({ type: "edit", edit: null });
  if (title.trim() === "") return;
  try {
    const session = await client.renameSession(sessionId, title.trim());
    dispatch({ type: "event", event: { type: "session.updated", session } });
  } catch (error: unknown) {
    dispatch({ type: "notice", notice: describe(error) });
  }
}

async function deleteSession(sessionId: string): Promise<void> {
  dispatch({ type: "edit", edit: null });
  try {
    await client.deleteSession(sessionId);
    if (state.activeId === sessionId) dispatch({ type: "close" });
    await refreshSessions();
  } catch (error: unknown) {
    dispatch({ type: "notice", notice: describe(error) });
  }
}

async function answerApproval(
  sessionId: string,
  requestId: string,
  approved: boolean,
): Promise<void> {
  try {
    await client.answerApproval(sessionId, requestId, approved);
    dispatch({ type: "approval.answer", requestId, approved });
  } catch (error: unknown) {
    dispatch({ type: "approval.answer", requestId, approved });
    dispatch({ type: "notice", notice: describe(error) });
  }
}

async function send(): Promise<void> {
  const sessionId = state.activeId;
  if (sessionId === null) return;
  const textarea = input("message");
  const text = textarea.value.trim();
  if (text === "") return;
  textarea.value = "";
  try {
    await client.sendMessage(sessionId, text);
  } catch (error: unknown) {
    textarea.value = text;
    dispatch({ type: "notice", notice: describe(error) });
  }
}

async function cancel(): Promise<void> {
  const sessionId = state.activeId;
  if (sessionId === null) return;
  try {
    if (!(await client.cancelSession(sessionId)))
      dispatch({ type: "notice", notice: "该会话没有运行中的任务。" });
  } catch (error: unknown) {
    dispatch({ type: "notice", notice: describe(error) });
  }
}

function describe(error: unknown): string {
  if (error instanceof KernelApiError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`The workbench shell is missing #${id}`);
  return found;
}

function input(id: string): HTMLInputElement & HTMLTextAreaElement {
  return element(id) as HTMLInputElement & HTMLTextAreaElement;
}

function button(id: string): HTMLButtonElement {
  return element(id) as HTMLButtonElement;
}

function compose(): void {
  input("message").focus();
}

function draw(): void {
  element("kernel-status").innerHTML = view.renderKernelStatus(state);
  element("known-workspaces").innerHTML = view.renderWorkspaceOptions(state);
  element("session-list").innerHTML = view.renderSessionList(state);
  element("chat-header").innerHTML = view.renderChatHeader(state);
  element("task-state").textContent = view.renderTaskState(state);
  element("approvals").innerHTML = view.renderApprovals(state);
  element("artifacts").innerHTML = view.renderArtifacts(state);
  element("settings").innerHTML = view.renderSettings(state);
  element("notice").innerHTML = view.renderNotice(state);
  element("artifacts").hidden = state.view !== "artifacts";
  element("settings").hidden = state.view !== "settings";
  for (const button of document.querySelectorAll<HTMLElement>("#views [data-view]"))
    button.classList.toggle("active", button.dataset.view === state.view);
  input("send").disabled = state.session === null;
  button("cancel").disabled = !state.taskRunning;
  drawTimeline();
}

/**
 * Streaming text arrives many times per second. The timeline is only rebuilt
 * when its steps change, so a running answer grows in place and open tool
 * cards keep their state.
 */
function drawTimeline(): void {
  const timeline = element("timeline");
  const steps = toTimeline(state.entries, {
    deltas: new Map(Object.entries(state.deltas)),
  });
  const signature = steps
    .map((step) => `${step.kind}:${step.id}:${step.kind === "tool" ? step.state : ""}`)
    .join("|");
  const streaming = steps.find((step) => step.kind === "message" && step.streaming);
  if (signature === timelineSignature && streaming !== undefined) {
    const node = timeline.querySelector<HTMLElement>(`[data-entry="${streaming.id}"]`);
    if (node !== null) {
      const pinned = isPinned(timeline);
      node.outerHTML = view.renderTimelineStep(streaming);
      scrollTimeline(timeline, pinned);
      return;
    }
  }
  timelineSignature = signature;
  const pinned = isPinned(timeline);
  const previous = timeline.scrollTop;
  timeline.innerHTML = view.renderTimeline(state);
  timeline.scrollTop = pinned ? timeline.scrollHeight : previous;
}

function isPinned(timeline: HTMLElement): boolean {
  return timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 40;
}

function scrollTimeline(timeline: HTMLElement, wasPinned: boolean): void {
  if (wasPinned) timeline.scrollTop = timeline.scrollHeight;
}
