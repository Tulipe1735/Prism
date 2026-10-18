import type { SessionSummary } from "./session.ts";
import type { JsonValue } from "./types.ts";

export const KERNEL_STATUSES = ["starting", "ready", "stopping", "error"] as const;

export type KernelStatus = (typeof KERNEL_STATUSES)[number];

/**
 * Events the kernel pushes over SSE. The workbench renders from these events and
 * never polls.
 */
export type KernelEvent =
  | { type: "message.delta"; sessionId: string; entryId: string; delta: string }
  | {
      type: "tool.started";
      sessionId: string;
      callId: string;
      name: string;
      arguments: JsonValue;
    }
  | { type: "tool.completed"; sessionId: string; callId: string; result: string }
  | { type: "tool.failed"; sessionId: string; callId: string; error: string }
  | {
      type: "approval.requested";
      sessionId: string;
      requestId: string;
      tool: string;
      reason: string;
      target: string;
      impact: string;
    }
  | {
      type: "approval.resolved";
      sessionId: string;
      requestId: string;
      approved: boolean;
    }
  | { type: "session.updated"; session: SessionSummary }
  | { type: "kernel.status"; status: KernelStatus; version: string; dataDir: string };
