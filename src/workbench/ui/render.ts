import type { KernelSettings } from "../../kernel/kernel.ts";
import { BROWSER_ENGINES, PERMISSION_SCOPES } from "../../kernel/types.ts";
import {
  type Artifact,
  type DiffLine,
  parseUnifiedDiff,
  toArtifacts,
  type ToolState,
  type ToolStep,
  toTimeline,
} from "./derive.ts";
import { selectKnownWorkspaces, selectVisibleSessions, type UiState } from "./state.ts";

const STATUS_LABELS: Record<string, string> = {
  starting: "启动中",
  ready: "就绪",
  stopping: "关闭中",
  error: "错误",
};

const TOOL_STATE_LABELS: Record<ToolState, string> = {
  running: "执行中",
  ok: "完成",
  failed: "失败",
};

const ROLE_LABELS: Record<string, string> = {
  user: "你",
  assistant: "助手",
  system: "系统",
};

/** Escapes every value that reaches the DOM; session and model text is untrusted. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderKernelStatus(state: UiState): string {
  if (!state.connected)
    return `<span class="status" data-status="offline">已断开</span><span class="muted">内核未连接，正在重连</span>`;
  const kernel = state.kernel;
  if (kernel === null) return `<span class="status">连接中</span>`;
  return [
    `<span class="status" data-status="${kernel.status}">${
      STATUS_LABELS[kernel.status] ?? kernel.status
    } ${escapeHtml(kernel.version)}</span>`,
    `<span class="muted" title="数据目录">${escapeHtml(kernel.dataDir)}</span>`,
  ].join("");
}

export function renderWorkspaceOptions(state: UiState): string {
  return selectKnownWorkspaces(state)
    .map((workspace) => `<option value="${escapeHtml(workspace)}"></option>`)
    .join("");
}

export function renderSessionList(state: UiState): string {
  const groups = selectVisibleSessions(state);
  if (groups.length === 0)
    return `<p class="empty">${
      state.search === "" ? "还没有会话，先打开一个工作区。" : "没有匹配的会话。"
    }</p>`;
  return groups
    .map(
      (group) => `<div class="group">
  <h3 title="${escapeHtml(group.workspace)}">${escapeHtml(group.workspace)}</h3>
${group.sessions.map((session) => renderSessionRow(state, session.id)).join("\n")}
</div>`,
    )
    .join("\n");
}

function renderSessionRow(state: UiState, sessionId: string): string {
  const session = state.sessions.find((entry) => entry.id === sessionId);
  if (session === undefined) return "";
  const title = escapeHtml(session.title ?? "（未命名会话）");
  const edit = state.edit?.sessionId === sessionId ? state.edit : null;
  if (edit?.kind === "rename")
    return `<form class="session" data-action="rename-form" data-session="${sessionId}">
  <input name="title" value="${title}" autocomplete="off">
  <div class="actions">
    <button type="submit">保存</button>
    <button type="button" data-action="edit-cancel">取消</button>
  </div>
</form>`;
  if (edit?.kind === "delete")
    return `<div class="session">
  <span class="title">${title}</span>
  <div class="sub">删除这个会话及其日志？</div>
  <div class="actions">
    <button type="button" data-action="delete-confirm" data-session="${sessionId}">确认删除</button>
    <button type="button" data-action="edit-cancel">取消</button>
  </div>
</div>`;
  return `<div class="session${session.id === state.activeId ? " active" : ""}" data-action="open-session" data-session="${session.id}">
  <span class="title">${title}</span>
  <div class="sub">${session.entryCount} 条 · ${escapeHtml(shortId(session.id))}</div>
  <div class="actions">
    <button type="button" data-action="rename-session" data-session="${session.id}">重命名</button>
    <button type="button" data-action="delete-session" data-session="${session.id}">删除</button>
  </div>
</div>`;
}

export function renderChatHeader(state: UiState): string {
  const session = state.session;
  if (session === null)
    return `<span class="muted">选择一个会话，或在工作区里新建会话。</span>`;
  return `<strong>${escapeHtml(session.title ?? "（未命名会话）")}</strong> · ${escapeHtml(
    session.workspace,
  )} · ${session.entryCount} 条
  <button type="button" data-action="compact"${
    state.taskRunning ? " disabled" : ""
  } title="把较早的上下文换成一条摘要；原始条目保留">压缩上下文</button>`;
}

export function renderTaskState(state: UiState): string {
  if (state.session === null) return "";
  if (state.taskRunning) return "任务运行中…";
  return "空闲";
}

export function renderTimeline(state: UiState): string {
  const steps = toTimeline(state.entries, {
    deltas: new Map(Object.entries(state.deltas)),
  });
  if (steps.length === 0)
    return `<p class="empty">${
      state.session === null ? "" : "还没有消息，写下第一个任务。"
    }</p>`;
  return steps.map((step) => renderStep(step)).join("\n");
}

function renderStep(step: ReturnType<typeof toTimeline>[number]): string {
  if (step.kind === "message") {
    const role = step.streaming ? "assistant" : step.role;
    const label = escapeHtml(ROLE_LABELS[role] ?? role);
    const caret = step.streaming ? '<span class="muted">▍</span>' : "";
    return `<div class="entry ${role}" data-entry="${step.id}">
  <div class="meta">${label}</div>${escapeHtml(step.content)}${caret}</div>`;
  }
  if (step.kind === "compaction")
    return `<div class="entry system" data-entry="${step.id}"><div class="meta">上下文压缩</div>${escapeHtml(
      step.summary,
    )}</div>`;
  return renderTool(step);
}

export { renderStep as renderTimelineStep };

function renderTool(step: ToolStep): string {
  const diff = step.result === undefined ? null : parseUnifiedDiff(step.result);
  const output =
    step.result === undefined
      ? ""
      : diff === null
        ? `<pre>${escapeHtml(step.result)}</pre>`
        : renderDiff(diff, step.result);
  return `<details class="tool" data-call="${step.callId}"${step.state === "ok" ? "" : " open"}>
  <summary>
    <span class="name">${escapeHtml(step.name)}</span>
    ${step.target === undefined ? "" : `<span class="muted">${escapeHtml(step.target)}</span>`}
    <span class="state" data-state="${step.state}">${TOOL_STATE_LABELS[step.state]}</span>
  </summary>
  <pre>${escapeHtml(step.arguments)}</pre>
${output}
</details>`;
}

export function renderApprovals(state: UiState): string {
  return state.approvals
    .map(
      (approval) => `<div class="approval" data-request="${approval.requestId}">
  <h3>需要审批：<span class="name">${escapeHtml(approval.tool)}</span></h3>
  <dl>
    <dt>理由</dt><dd>${escapeHtml(approval.reason)}</dd>
    <dt>目标</dt><dd>${escapeHtml(approval.target)}</dd>
    <dt>影响</dt><dd>${escapeHtml(approval.impact)}</dd>
    <dt>会话</dt><dd>${escapeHtml(shortId(approval.sessionId))}</dd>
  </dl>
  <div class="row">
    <button type="button" class="primary" data-action="approve" data-session="${
      approval.sessionId
    }" data-request="${approval.requestId}">允许一次</button>
    <button type="button" data-action="reject" data-session="${
      approval.sessionId
    }" data-request="${approval.requestId}">拒绝</button>
  </div>
</div>`,
    )
    .join("\n");
}

export function renderArtifacts(state: UiState): string {
  const artifacts = toArtifacts(state.entries);
  if (artifacts.length === 0)
    return `<h2>产物</h2><p class="empty">还没有文件改动。</p>`;
  return `<h2>产物</h2>
${artifacts
  .map(
    (artifact) => `<details class="artifact" data-path="${escapeHtml(artifact.path)}">
  <summary>${escapeHtml(artifact.path)}<span class="counts"><span class="plus">+${
    artifact.added
  }</span> <span class="minus">−${artifact.removed}</span></span></summary>
  ${renderArtifactBody(artifact)}
</details>`,
  )
  .join("\n")}`;
}

/** A diff when the result carried one, the written content otherwise. */
function renderArtifactBody(artifact: Artifact): string {
  if (artifact.diff !== null) return renderDiff(artifact.diff, artifact.result);
  if (artifact.written !== null)
    return `<p class="empty">工具没有返回 diff；下面是这次写入的内容。</p><pre>${escapeHtml(
      artifact.written,
    )}</pre>`;
  return `<pre>${escapeHtml(
    artifact.result === "" ? "（工具没有返回 diff）" : artifact.result,
  )}</pre>`;
}

function renderDiff(diff: DiffLine[] | null, fallback: string): string {
  if (diff === null)
    return `<pre>${escapeHtml(fallback === "" ? "（工具没有返回 diff）" : fallback)}</pre>`;
  return `<div class="diff">${diff
    .map((line) => `<div class="${line.kind}">${escapeHtml(line.text)}</div>`)
    .join("")}</div>`;
}

export function renderSettings(state: UiState): string {
  const settings = state.settings;
  if (settings === null) return `<h2>设置</h2><p class="empty">尚未读取内核设置。</p>`;
  return `<h2>设置</h2>
${renderModelSettings(settings)}
${renderEngineSettings(settings)}
${renderSearchSettings(settings)}
<dl class="kv">
  <dt>数据目录</dt><dd>${escapeHtml(settings.dataDir)}</dd>
</dl>
<h2>权限范围</h2>
<div class="row">
${PERMISSION_SCOPES.map((scope) => renderScopeButton(scope, settings.permissions.scope)).join("\n")}
</div>
<p class="empty">立即生效；正在运行的任务下一次工具调用就按新档位判定。</p>
<h2>浏览器动作</h2>
<div class="row">
  <button type="button" data-action="toggle-browser-approval" aria-pressed="${
    settings.browser.actionsNeedApproval
  }">${
    settings.browser.actionsNeedApproval
      ? "每个动作先审批（点击关闭）"
      : "自动执行（点击改为先审批）"
  }</button>
</div>
<p class="empty">浏览器动作需要审批（US-30）；开启后内核为每个浏览器动作弹一次审批卡片。</p>
<p class="empty">改动写入 ${escapeHtml(
    settings.dataDir,
  )}/config.json，并在下一次请求、搜索或浏览器会话生效。</p>`;
}

/** Model endpoint, name and key; the key is never read back from the kernel. */
function renderModelSettings(settings: KernelSettings): string {
  return `<h2>模型</h2>
<form data-action="settings-form" data-section="model">
  <label>端点 <input name="baseUrl" value="${escapeHtml(
    settings.model.baseUrl,
  )}" autocomplete="off"></label>
  <label>模型 <input name="model" value="${escapeHtml(
    settings.model.model,
  )}" autocomplete="off"></label>
  <label>密钥 <input name="apiKey" type="password" placeholder="${
    settings.model.hasApiKey ? "已设置（留空不改）" : "未设置"
  }" autocomplete="off"></label>
  <button type="submit">保存模型</button>
</form>`;
}

/** Browser engines the kernel can run; the next session uses the chosen one. */
function renderEngineSettings(settings: KernelSettings): string {
  return `<h2>浏览器引擎</h2>
<div class="row">
${BROWSER_ENGINES.map((engine) => renderEngineButton(engine, settings.browser.engine)).join("\n")}
</div>
<p class="empty">Chromium 可接管已登录的 Chrome/Edge（config.json 的 browser.endpoint）。</p>`;
}

/** Search source; an unknown provider name needs an explicit endpoint. */
function renderSearchSettings(settings: KernelSettings): string {
  return `<h2>搜索来源</h2>
<form data-action="settings-form" data-section="search">
  <label>来源 <input name="provider" value="${escapeHtml(
    settings.search.provider,
  )}" autocomplete="off"></label>
  <label>端点 <input name="baseUrl" value="${escapeHtml(
    settings.search.baseUrl ?? "",
  )}" placeholder="默认用来源自己的端点" autocomplete="off"></label>
  <button type="submit">保存搜索</button>
</form>`;
}

function renderEngineButton(engine: string, current: string): string {
  const active = engine === current;
  return `<button type="button" data-action="set-engine" data-engine="${engine}" aria-pressed="${active}"${
    active ? ' class="primary"' : ""
  }>${escapeHtml(engine)}</button>`;
}

function renderScopeButton(scope: string, current: string): string {
  const active = scope === current;
  return `<button type="button" data-action="set-scope" data-scope="${scope}" aria-pressed="${active}"${
    active ? ' class="primary"' : ""
  }>${escapeHtml(scope)}</button>`;
}

export function renderNotice(state: UiState): string {
  return state.notice === null
    ? ""
    : `<span class="notice">${escapeHtml(state.notice)}</span>`;
}

/** Short handle for session and request ids in compact places. */
function shortId(id: string): string {
  return id.length <= 8 ? id : id.slice(0, 8);
}
