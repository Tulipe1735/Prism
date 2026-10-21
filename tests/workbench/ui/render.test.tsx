import type { SessionEntry, SessionSummary } from "../../../src/kernel/session.ts";
import type { Workbench } from "../../../src/workbench/ui/use-workbench.ts";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ApprovalCard, KernelStatus } from "../../../src/workbench/ui/app.tsx";
import { Inspector } from "../../../src/workbench/ui/inspector.tsx";
import { Settings } from "../../../src/workbench/ui/settings.tsx";
import { Sidebar } from "../../../src/workbench/ui/sidebar.tsx";
import { emptyState, reduce, type UiState } from "../../../src/workbench/ui/state.ts";
import { Timeline } from "../../../src/workbench/ui/timeline.tsx";

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "session-1",
    workspace: "/home/demo/app",
    title: "Fix the login",
    createdAt: "2026-10-18T09:00:00.000Z",
    updatedAt: "2026-10-18T09:04:11.000Z",
    entryCount: 4,
    leafId: "entry-4",
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
  const state = reduce(emptyState(), { type: "sessions", sessions: [summary()] });
  return reduce(state, { type: "open", session: summary(), entries });
}

function workbench(state: UiState): Workbench {
  return {
    state,
    dispatch: vi.fn(),
    sending: false,
    openWorkspace: vi.fn((path: string) => path),
    newSession: vi.fn(async () => true),
    openSession: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    deleteSession: vi.fn(async () => {}),
    answerApproval: vi.fn(async () => {}),
    send: vi.fn(async () => true),
    cancel: vi.fn(async () => {}),
    compact: vi.fn(async () => {}),
    updateSettings: vi.fn(async () => true),
  };
}

it("shows the kernel connection state without exposing paths as markup", () => {
  const state = reduce(emptyState(), {
    type: "event",
    event: {
      type: "kernel.status",
      status: "ready",
      version: "0.1.6",
      dataDir: '/tmp/<img src=x onerror="alert(1)">',
    },
  });
  const html = renderToStaticMarkup(<KernelStatus state={state} />);
  expect(html).toContain('data-status="ready"');
  expect(html).toContain("内核就绪");
  expect(html).not.toContain("<img");
  expect(renderToStaticMarkup(<KernelStatus state={emptyState()} />)).toContain(
    "已断开",
  );
});

it("groups sessions by workspace and provides keyboard accessible session buttons", () => {
  let state = reduce(openSession(), {
    type: "sessions",
    sessions: [summary(), summary({ id: "session-2", workspace: "/home/demo/site" })],
  });
  const html = renderToStaticMarkup(
    <Sidebar
      workbench={workbench(state)}
      collapsed={false}
      onExpand={() => {}}
      onNavigate={() => {}}
      onSettings={() => {}}
    />,
  );
  expect(html).toContain("/home/demo/app");
  expect(html).toContain("/home/demo/site");
  expect(html).toContain('data-action="open-session"');
  expect(html).toContain('aria-current="page"');
  expect(html).toContain('data-action="rename-session"');
  expect(html).toContain('data-action="delete-session"');
  expect(html).toContain('data-workspace="/home/demo/app"');
  expect(html).toContain('data-workspace="/home/demo/site"');
  expect(html.match(/data-action="new-session"/g)).toHaveLength(2);
  state = reduce(state, {
    type: "edit",
    edit: { kind: "rename", sessionId: "session-1" },
  });
  expect(
    renderToStaticMarkup(
      <Sidebar
        workbench={workbench(state)}
        collapsed={false}
        onExpand={() => {}}
        onNavigate={() => {}}
        onSettings={() => {}}
      />,
    ),
  ).toContain('name="title"');
  state = reduce(state, {
    type: "edit",
    edit: { kind: "delete", sessionId: "session-1" },
  });
  expect(
    renderToStaticMarkup(
      <Sidebar
        workbench={workbench(state)}
        collapsed={false}
        onExpand={() => {}}
        onNavigate={() => {}}
        onSettings={() => {}}
      />,
    ),
  ).toContain("确认删除");
});

it("renders untrusted message text, tool results and streaming updates as React text", () => {
  const state = reduce(openSession(), {
    type: "event",
    event: {
      type: "message.delta",
      sessionId: "session-1",
      entryId: "stream-1",
      delta: "working <img src=x onerror=alert(1)>",
    },
  });
  const html = renderToStaticMarkup(<Timeline state={state} />);
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<img src=x");
  expect(html).toContain('data-call="call-1"');
  expect(html).toContain('data-state="ok"');
  expect(html).toContain('class="add"');
  expect(html).toContain("+new");
  expect(html).toContain("working &lt;img src=x onerror=alert(1)&gt;");
});

it("renders assistant Markdown with nested lists, tables and code blocks", () => {
  const state = openSession();
  state.entries.push({
    type: "message",
    id: "markdown",
    parentId: "entry-4",
    timestamp: "2026-10-18T09:00:04.000Z",
    role: "assistant",
    content: [
      "## 结果",
      "",
      "**完成**，查看 `src/app.ts` 和 [文档](https://example.com)。",
      "",
      "1. 修改代码",
      "   - 检查结果",
      "",
      "> 已验证",
      "",
      "| 检查 | 结果 |",
      "| --- | --- |",
      "| 测试 | 通过 |",
      "",
      "- [x] 完成",
      "",
      "```ts",
      "const value = '<script>';",
      "```",
    ].join("\n"),
  });
  const html = renderToStaticMarkup(<Timeline state={state} />);
  for (const markup of [
    "<h2>结果</h2>",
    "<strong>完成</strong>",
    "<code>src/app.ts</code>",
    '<a href="https://example.com">文档</a>',
    "<ol>",
    "<ul>",
    "<blockquote>",
    "<table>",
    '<input type="checkbox" disabled="" checked=""/>',
    '<pre><code class="language-ts">',
    "&lt;script&gt;",
  ])
    expect(html).toContain(markup);
});

it("keeps unsafe HTML and link protocols inert inside assistant Markdown", () => {
  const state = openSession();
  state.entries.push({
    type: "message",
    id: "unsafe-markdown",
    parentId: "entry-4",
    timestamp: "2026-10-18T09:00:04.000Z",
    role: "assistant",
    content:
      "<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[click](javascript:alert%281%29)",
  });
  const html = renderToStaticMarkup(<Timeline state={state} />);
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<img src=x");
  expect(html).not.toContain('href="javascript:');
  expect(html).toContain("&lt;script&gt;");
});

it("renders the approval facts and exactly the two one-time answers", () => {
  const state = reduce(emptyState(), {
    type: "event",
    event: {
      type: "approval.requested",
      sessionId: "session-1",
      requestId: "request-1",
      tool: "write_file",
      reason: "目标在工作区之外",
      target: "/etc/hosts",
      impact: "追加一行",
    },
  });
  const html = renderToStaticMarkup(
    <ApprovalCard approval={state.approvals[0]!} workbench={workbench(state)} />,
  );
  for (const text of [
    "write_file",
    "目标在工作区之外",
    "/etc/hosts",
    "追加一行",
    "允许一次",
    "拒绝",
  ])
    expect(html).toContain(text);
  expect(html.match(/<button/g)).toHaveLength(2);
  expect(html).toContain('data-session="session-1"');
  expect(html).toContain('data-request="request-1"');
});

it("renders touched files and their bounded diff in the inspector", () => {
  const html = renderToStaticMarkup(
    <Inspector workbench={workbench(openSession())} onClose={() => {}} />,
  );
  expect(html).toContain("src/app.ts");
  expect(html).toContain("+1");
  expect(html).toContain("−1");
  expect(html).toContain('class="add"');
  expect(
    renderToStaticMarkup(
      <Inspector workbench={workbench(emptyState())} onClose={() => {}} />,
    ),
  ).toContain("还没有文件改动");
});

it("renders editable kernel settings, effective scope and browser approval state", () => {
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
      creator: { enabled: false },
    },
  });
  const html = renderToStaticMarkup(<Settings workbench={workbench(state)} />);
  for (const text of [
    'data-section="model"',
    'value="deepseek-chat"',
    'value="https://api.deepseek.com/v1"',
    'type="password"',
    "已设置（留空不改）",
    'data-section="search"',
    "/home/demo/.prism/config.json",
  ])
    expect(html).toContain(text);
  for (const engine of ["chromium", "firefox", "webkit"])
    expect(html).toContain(`data-engine="${engine}"`);
  for (const scope of ["read-only", "workspace-write", "full-access"])
    expect(html).toContain(`data-scope="${scope}"`);
  expect(html).toMatch(/data-scope="workspace-write"[^>]*aria-pressed="true"/);
  expect(html).toMatch(/data-engine="chromium"[^>]*aria-pressed="true"/);
  expect(html).toContain('data-action="toggle-browser-approval"');
  expect(
    renderToStaticMarkup(<Settings workbench={workbench(emptyState())} />),
  ).toContain("尚未读取");
});
