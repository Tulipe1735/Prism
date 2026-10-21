import type { KernelEvent } from "./events.ts";
import type { ApprovalRequest } from "./permissions.ts";
import { randomUUID } from "node:crypto";

/** One-shot decisions owned by the approvals plugin. */
export class Approvals {
  private readonly pending = new Map<
    string,
    { sessionId: string; resolve: (approved: boolean) => void }
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
      this.pending.set(requestId, { sessionId, resolve });
      this.publish({ type: "approval.requested", sessionId, requestId, ...request });
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
      this.pending.delete(requestId);
      pending.resolve(false);
    }
  }
}
