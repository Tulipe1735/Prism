import type { KernelEvent } from "./events.ts";
import type { ApprovalRequest } from "./permissions.ts";
import { randomUUID } from "node:crypto";

export type PendingApprovalEvent = Extract<KernelEvent, { type: "approval.requested" }>;

/** One-shot decisions owned by the approvals plugin. */
export class Approvals {
  private readonly pending = new Map<
    string,
    {
      sessionId: string;
      event: PendingApprovalEvent;
      resolve: (approved: boolean) => void;
    }
  >();

  private readonly publish: (event: KernelEvent) => void;

  constructor(publish: (event: KernelEvent) => void) {
    this.publish = publish;
  }

  request(
    sessionId: string,
    request: ApprovalRequest & { tool: string },
  ): Promise<boolean> {
    const requestId = randomUUID();
    return new Promise<boolean>((resolve) => {
      const event: PendingApprovalEvent = {
        type: "approval.requested",
        sessionId,
        requestId,
        ...request,
      };
      this.pending.set(requestId, { sessionId, event, resolve });
      this.publish(event);
    });
  }

  resolve(sessionId: string, requestId: string, approved: boolean): boolean {
    const pending = this.pending.get(requestId);
    if (pending === undefined || pending.sessionId !== sessionId) return false;
    this.pending.delete(requestId);
    this.publish({ type: "approval.resolved", sessionId, requestId, approved });
    pending.resolve(approved);
    return true;
  }

  refuse(sessionId?: string): void {
    for (const [requestId, pending] of this.pending) {
      if (sessionId !== undefined && pending.sessionId !== sessionId) continue;
      this.resolve(pending.sessionId, requestId, false);
    }
  }

  list(sessionId: string): PendingApprovalEvent[] {
    return [...this.pending.values()]
      .filter((pending) => pending.sessionId === sessionId)
      .map((pending) => ({ ...pending.event }));
  }
}
