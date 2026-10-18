import type { SessionEntry, SessionSummary } from "../../src/kernel/session.ts";
import { expect, it } from "vitest";
import { emptyState, reduce, selectVisibleSessions } from "../../src/workbench/ui/state.ts";

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "session-1",
    workspace: "/home/demo/app",
    createdAt: "2026-10-18T09:00:00.000Z",
    updatedAt: "2026-10-18T09:00:00.000Z",
    entryCount: 1,
    leafId: "entry-1",
    ...overrides,
  };
}

function userMessage(id: string): SessionEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-10-18T09:00:00.000Z",
    role: "user",
    content: "go",
  };
}

function assistantMessage(id: string): SessionEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-10-18T09:00:05.000Z",
    role: "assistant",
    content: "done",
  };
}

it("shows the kernel state from the status event", () => {
  const state = reduce(emptyState(), {
    type: "event",
    event: { type: "kernel.status", status: "ready", version: "0.1.6", dataDir: "/tmp" },
  });

  expect(state.connected).toBe(true);
  expect(state.kernel).toEqual({ status: "ready", version: "0.1.6", dataDir: "/tmp" });
});

it("upserts session summaries from events and keeps them newest first", () => {
  let state = reduce(emptyState(), {
    type: "sessions",
    sessions: [
      summary({ id: "old", updatedAt: "2026-10-18T09:00:00.000Z" }),
      summary({ id: "new", updatedAt: "2026-10-18T10:00:00.000Z" }),
    ],
  });

  state = reduce(state, {
    type: "event",
    event: {
      type: "session.updated",
      session: summary({ id: "old", updatedAt: "2026-10-18T11:00:00.000Z", entryCount: 4 }),
    },
  });
  state = reduce(state, {
    type: "event",
    event: {
      type: "session.updated",
      session: summary({ id: "fresh", updatedAt: "2026-10-18T12:00:00.000Z" }),
    },
  });

  expect(state.sessions.map((session) => session.id)).toEqual(["fresh", "old", "new"]);
  expect(state.sessions[1]?.entryCount).toBe(4);
});

it("streams deltas into the open session and derives the task state from the log", () => {
  let state = reduce(emptyState(), {
    type: "open",
    session: summary(),
    entries: [userMessage("entry-1")],
  });
  expect(state.taskRunning).toBe(true);

  state = reduce(state, {
    type: "event",
    event: {
      type: "message.delta",
      sessionId: "session-1",
      entryId: "entry-2",
      delta: "wor",
    },
  });
  state = reduce(state, {
    type: "event",
    event: {
      type: "message.delta",
      sessionId: "session-1",
      entryId: "entry-2",
      delta: "king",
    },
  });
  state = reduce(state, {
    type: "event",
    event: {
      type: "message.delta",
      sessionId: "other-session",
      entryId: "entry-9",
      delta: "not mine",
    },
  });
  expect(state.deltas).toEqual({ "entry-2": "working" });

  // The kernel persists the message and the log becomes the source of truth.
  state = reduce(state, {
    type: "entries",
    entries: [userMessage("entry-1"), assistantMessage("entry-2")],
  });
  expect(state.taskRunning).toBe(false);
  expect(state.deltas).toEqual({});
});

it("keeps tool events of other sessions out of the state", () => {
  let state = reduce(emptyState(), {
    type: "open",
    session: summary(),
    entries: [assistantMessage("entry-1")],
  });
  expect(state.taskRunning).toBe(false);

  state = reduce(state, {
    type: "event",
    event: {
      type: "tool.started",
      sessionId: "other-session",
      callId: "call-1",
      name: "echo",
      arguments: {},
    },
  });
  expect(state.taskRunning).toBe(false);

  state = reduce(state, {
    type: "event",
    event: {
      type: "tool.started",
      sessionId: "session-1",
      callId: "call-1",
      name: "echo",
      arguments: {},
    },
  });
  expect(state.taskRunning).toBe(true);
});

it("shows a pending approval once and drops it when it is answered", () => {
  const requested = {
    type: "approval.requested" as const,
    sessionId: "session-1",
    requestId: "approval-1",
    tool: "write_file",
    reason: "outside the workspace",
    target: "/etc/hosts",
    impact: "changes a system file",
  };

  let state = reduce(emptyState(), { type: "event", event: requested });
  state = reduce(state, { type: "event", event: requested });
  expect(state.approvals).toHaveLength(1);
  expect(state.approvals[0]).toMatchObject({ requestId: "approval-1", tool: "write_file" });

  state = reduce(state, { type: "approval.answer", requestId: "approval-1", approved: true });
  expect(state.approvals).toEqual([]);
  expect(state.notice).toContain("允许");

  state = reduce(state, { type: "event", event: requested });
  state = reduce(state, {
    type: "event",
    event: {
      type: "approval.resolved",
      sessionId: "session-1",
      requestId: "approval-1",
      approved: false,
    },
  });
  expect(state.approvals).toEqual([]);
});

it("drops the open session when the workspace changes", () => {
  let state = reduce(emptyState(), {
    type: "open",
    session: summary(),
    entries: [userMessage("entry-1")],
  });
  state = reduce(state, { type: "workspace", workspace: "/home/demo/other" });
  expect(state.workspace).toBe("/home/demo/other");
  expect(state.activeId).toBeNull();
  expect(state.session).toBeNull();
  expect(state.entries).toEqual([]);
  expect(state.taskRunning).toBe(false);

  state = reduce(emptyState(), {
    type: "open",
    session: summary({ workspace: "/home/demo/app" }),
    entries: [],
  });
  state = reduce(state, { type: "workspace", workspace: "/home/demo/app" });
  expect(state.activeId).toBe("session-1");
});

it("filters the sidebar list by the search query", () => {
  const state = {
    ...reduce(emptyState(), {
      type: "sessions",
      sessions: [
        summary({ id: "a", title: "Fix login" }),
        summary({ id: "b", workspace: "/srv/site" }),
      ],
    }),
    search: "login",
  };

  expect(selectVisibleSessions(state).map((group) => group.sessions[0]?.id)).toEqual(["a"]);
});

it("switches the inspector between artifacts and settings", () => {
  expect(emptyState().view).toBe("artifacts");
  expect(reduce(emptyState(), { type: "view", view: "settings" }).view).toBe("settings");
});

it("remembers recently used workspaces without duplicates", () => {
  let state = reduce(emptyState(), { type: "workspace", workspace: "/home/demo/app" });
  state = reduce(state, { type: "workspace", workspace: "/home/demo/other" });
  state = reduce(state, { type: "workspace", workspace: "/home/demo/app" });

  expect(state.recents).toEqual(["/home/demo/app", "/home/demo/other"]);
});
