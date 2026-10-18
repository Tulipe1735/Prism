import type { SessionEntry, SessionSummary } from "../../src/kernel/session.ts";
import { expect, it } from "vitest";
import {
  escapeHtml,
  renderApprovals,
  renderArtifacts,
  renderChatHeader,
  renderKernelStatus,
  renderNotice,
  renderSessionList,
  renderSettings,
  renderTimeline,
  renderWorkspaceOptions,
} from "../../src/workbench/ui/render.ts";
import { emptyState, reduce, type UiState } from "../../src/workbench/ui/state.ts";

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "6f1c9a3e-0000",
    workspace: "/home/demo/app",
    title: "Fix the login",
    createdAt: "2026-10-18T09:00:00.000Z",
    updatedAt: "2026-10-18T09:04:11.000Z",
    entryCount: 7,
    leafId: "entry-7",
    ...overrides,
  };
}

function openSession(): UiState {
  const entries: SessionEntry[] = [
    {
      type: "message",
      id: "entry-1",
      parentId: null,
      timestamp: "2026-10-18T09:00:00.000Z",
      role: "user",
      content: "add <script>alert(1)</script> handling",
    },
    {
      type: "tool_call",
      id: "entry-2",
      parentId: "entry-1",
      timestamp: "2026-10-18T09:00:01.000Z",
      callId: "call-1",
      name: "edit_file",
      arguments: '{"path":"src/app.ts"}',
    },
    {
      type: "tool_result",
      id: "entry-3",
      parentId: "entry-2",
      timestamp: "2026-10-18T09:00:02.000Z",
      callId: "call-1",
      content: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n",
      isError: false,
    },
    {
      type: "message",
      id: "entry-4",
      parentId: "entry-3",
      timestamp: "2026-10-18T09:00:03.000Z",
      role: "assistant",
      content: "done",
    },
  ];
  const state = reduce(emptyState("/home/demo/app"), {
    type: "sessions",
    sessions: [summary()],
  });
  return reduce(state, { type: "open", session: summary(), entries });
}

it("escapes text that comes from the kernel or the user", () => {
  expect(escapeHtml('<img src=x onerror="x">')).toBe(
    "&lt;img src=x onerror=&quot;x&quot;&gt;",
  );
});

it("shows the kernel state and the workspaces the user opened", () => {
  let state = reduce(emptyState(), {
    type: "event",
    event: {
      type: "kernel.status",
      status: "ready",
      version: "0.1.6",
      dataDir: "/tmp/data",
    },
  });
  state = reduce(state, { type: "workspace", workspace: "/home/demo/app" });

  expect(renderKernelStatus(state)).toContain("就绪");
  expect(renderKernelStatus(state)).toContain("0.1.6");
  expect(renderKernelStatus(state)).toContain("/tmp/data");
  expect(
    renderKernelStatus(reduce(state, { type: "connected", connected: false })),
  ).toContain("已断开");
  expect(renderWorkspaceOptions(state)).toContain('<option value="/home/demo/app">');
});

it("renders the session list grouped by workspace with row actions", () => {
  let state = reduce(emptyState(), {
    type: "sessions",
    sessions: [
      summary({ id: "a", title: "Fix the login", workspace: "/home/demo/app" }),
      summary({ id: "b", workspace: "/home/demo/site" }),
    ],
  });
  state = reduce(state, { type: "open", session: summary({ id: "a" }), entries: [] });

  const html = renderSessionList(state);
  expect(html).toContain("/home/demo/app");
  expect(html).toContain("/home/demo/site");
  expect(html).toContain("Fix the login");
  expect(html).toContain('data-action="open-session" data-session="a"');
  expect(html).toContain('class="session active"');
  expect(html).toContain('data-action="rename-session" data-session="a"');
  expect(html).toContain('data-action="delete-session" data-session="b"');

  const renaming = reduce(state, {
    type: "edit",
    edit: { kind: "rename", sessionId: "a" },
  });
  expect(renderSessionList(renaming)).toContain('name="title"');
  const deleting = reduce(state, {
    type: "edit",
    edit: { kind: "delete", sessionId: "b" },
  });
  expect(renderSessionList(deleting)).toContain(
    'data-action="delete-confirm" data-session="b"',
  );
  expect(renderSessionList(deleting)).toContain("确认删除");
});

it("renders the chat timeline with tool cards, diffs and streaming text", () => {
  let state = openSession();
  state = reduce(state, {
    type: "event",
    event: {
      type: "message.delta",
      sessionId: "6f1c9a3e-0000",
      entryId: "entry-5",
      delta: "working",
    },
  });

  const html = renderTimeline(state);
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  expect(html).toContain('class="entry user"');
  expect(html).toContain('data-call="call-1"');
  expect(html).toContain("edit_file");
  expect(html).toContain('data-state="ok"');
  expect(html).toContain('class="add"');
  expect(html).toContain("+new");
  expect(html).toContain("working");
  expect(renderChatHeader(state)).toContain("Fix the login");
  expect(renderChatHeader(state)).toContain("/home/demo/app");
});

it("offers manual compaction on the open session, disabled while a task runs", () => {
  const idle = openSession();
  expect(renderChatHeader(idle)).toContain('data-action="compact"');
  expect(renderChatHeader(idle)).not.toContain("disabled");

  const running = reduce(idle, {
    type: "event",
    event: {
      type: "message.delta",
      sessionId: "6f1c9a3e-0000",
      entryId: "entry-5",
      delta: "working",
    },
  });
  expect(renderChatHeader(running)).toContain('data-action="compact" disabled');
});

it("renders an approval card with the four facts and two buttons", () => {
  const state = reduce(emptyState(), {
    type: "event",
    event: {
      type: "approval.requested",
      sessionId: "session-1",
      requestId: "approval-1",
      tool: "write_file",
      reason: "The target is outside the workspace",
      target: "/etc/hosts",
      impact: "Would append one line to a system file",
    },
  });

  const html = renderApprovals(state);
  expect(html).toContain("write_file");
  expect(html).toContain("The target is outside the workspace");
  expect(html).toContain("/etc/hosts");
  expect(html).toContain("Would append one line to a system file");
  expect(html).toContain('data-action="approve"');
  expect(html).toContain('data-action="reject"');
  expect(html).toContain("允许一次");
  expect(html).toContain("拒绝");
  expect(html.match(/<button/g)).toHaveLength(2);
  expect(html).toContain('data-session="session-1"');
  expect(html).toContain('data-request="approval-1"');
  expect(renderApprovals(emptyState())).toBe("");
});

it("renders touched files as artifacts with their diff", () => {
  const html = renderArtifacts(openSession());
  expect(html).toContain("src/app.ts");
  expect(html).toContain("+1");
  expect(html).toContain("−1");
  expect(html).toContain('class="add"');
  expect(renderArtifacts(emptyState())).toContain("还没有文件改动");
});

it("renders the effective settings with the fields the kernel lets the workbench change", () => {
  const state = reduce(emptyState(), {
    type: "settings",
    settings: {
      dataDir: "/home/demo/.prism",
      model: {
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        hasApiKey: true,
      },
      browser: { engine: "chromium", actionsNeedApproval: false },
      search: { provider: "deepseek", baseUrl: "https://api.deepseek.com" },
      permissions: { scope: "workspace-write" },
    },
  });

  const html = renderSettings(state);
  // The model, the engine and the search source are editable (US-45, US-28, US-37).
  expect(html).toContain('data-action="settings-form" data-section="model"');
  expect(html).toContain('name="baseUrl" value="https://api.deepseek.com/v1"');
  expect(html).toContain('name="model" value="deepseek-chat"');
  expect(html).toContain('name="apiKey" type="password"');
  expect(html).toContain("已设置（留空不改）");
  expect(html).toContain('data-action="settings-form" data-section="search"');
  expect(html).toContain('name="provider" value="deepseek"');
  for (const engine of ["chromium", "firefox", "webkit"]) {
    expect(html).toContain(`data-action="set-engine" data-engine="${engine}"`);
  }
  expect(html).toMatch(/data-engine="chromium"[^>]*aria-pressed="true"/);
  expect(html).toContain("/home/demo/.prism/config.json");

  // The three scopes are switchable and the current one is marked (US-14).
  for (const scope of ["read-only", "workspace-write", "full-access"]) {
    expect(html).toContain(`data-action="set-scope" data-scope="${scope}"`);
  }
  expect(html).toMatch(/data-scope="workspace-write"[^>]*aria-pressed="true"/);
  expect(html).toMatch(/data-scope="read-only"[^>]*aria-pressed="false"/);
  // Browser actions may ask for approval (US-30).
  expect(html).toContain('data-action="toggle-browser-approval"');
  expect(html).toContain("浏览器动作需要审批");
  expect(renderSettings(emptyState())).toContain("尚未读取");
});

it("renders a notice only while there is one", () => {
  const state = reduce(emptyState(), {
    type: "notice",
    notice: "内核已断开，正在重连",
  });
  expect(renderNotice(state)).toContain("内核已断开");
  expect(renderNotice(emptyState())).toBe("");
});
