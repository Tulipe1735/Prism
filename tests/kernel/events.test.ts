import type { KernelEvent } from "../../src/kernel/events.ts";

import { describe, expect, it } from "vitest";

/** Fails to compile when a new event kind is not handled here. */
function category(event: KernelEvent): string {
  switch (event.type) {
    case "stream.reset":
      return "stream";
    case "task.state":
    case "task.input":
      return "task";
    case "message.delta":
      return "message";
    case "tool.started":
    case "tool.completed":
    case "tool.failed":
      return "tool";
    case "approval.requested":
    case "approval.resolved":
      return "approval";
    case "session.updated":
      return "session";
    case "session.compacted":
      return "compaction";
    case "kernel.status":
      return "kernel";
    case "plugins.updated":
    case "plugin.event":
      return "plugin";
    default: {
      const unhandled: never = event;
      throw new Error(`Unhandled kernel event ${JSON.stringify(unhandled)}`);
    }
  }
}

describe("kernel events", () => {
  it("covers message deltas, tool calls, approvals, session updates and kernel status", () => {
    const events: KernelEvent[] = [
      { type: "message.delta", sessionId: "s1", entryId: "e1", delta: "Hel" },
      {
        type: "tool.started",
        sessionId: "s1",
        callId: "c1",
        name: "read_file",
        arguments: { path: "src/kernel/config.ts" },
      },
      { type: "tool.completed", sessionId: "s1", callId: "c1", result: "42 lines" },
      { type: "tool.failed", sessionId: "s1", callId: "c2", error: "ENOENT" },
      {
        type: "approval.requested",
        sessionId: "s1",
        requestId: "a1",
        tool: "run_command",
        reason: "The command writes outside the workspace",
        target: "/etc/hosts",
        impact: "Edits a system file owned by root",
      },
      { type: "approval.resolved", sessionId: "s1", requestId: "a1", approved: false },
      {
        type: "session.updated",
        session: {
          id: "s1",
          workspace: "/work/demo",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:01.000Z",
          entryCount: 2,
          leafId: "e2",
        },
      },
      {
        type: "session.compacted",
        sessionId: "s1",
        entryId: "c1",
        reason: "auto",
      },
      {
        type: "kernel.status",
        status: "ready",
        version: "0.1.6",
        dataDir: "/home/demo/.prism",
      },
    ];

    expect(events.map(category)).toEqual([
      "message",
      "tool",
      "tool",
      "tool",
      "approval",
      "approval",
      "session",
      "compaction",
      "kernel",
    ]);
    expect(events.every((event) => typeof event.type === "string")).toBe(true);
  });
});
