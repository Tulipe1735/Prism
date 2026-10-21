import type { TaskContext } from "./loop.ts";
import type { ExecutionTarget } from "./types.ts";
import { notifySession } from "./context.ts";
import { KernelError } from "./errors.ts";
import { runTask } from "./loop.ts";

interface Run {
  controller: AbortController;
  settled: Promise<void>;
}

/** Owns task cancellation and waits for final log writes before releasing dependencies. */
export class Tasks {
  private readonly runs = new Map<string, Run>();
  private readonly settlements = new Set<Promise<void>>();
  private closed = false;
  private readonly ctx: TaskContext;
  private readonly target: ExecutionTarget;

  constructor(ctx: TaskContext, target: ExecutionTarget) {
    this.ctx = ctx;
    this.target = target;
  }

  get count(): number {
    return [...this.runs.values()].filter((run) => !run.controller.signal.aborted)
      .length;
  }

  isRunning(sessionId: string): boolean {
    const run = this.runs.get(sessionId);
    return run !== undefined && !run.controller.signal.aborted;
  }

  /** Reserve synchronously, before reading or appending, so concurrent sends cannot overlap. */
  async send(sessionId: string, text: string): Promise<string> {
    if (this.closed) throw new Error("The task service is stopping");
    const previous = this.runs.get(sessionId);
    if (previous !== undefined && !previous.controller.signal.aborted)
      throw new KernelError(
        "TASK_RUNNING",
        `Session ${sessionId} already has a running task`,
      );

    const controller = new AbortController();
    const run: Run = { controller, settled: Promise.resolve() };
    const started = Promise.resolve().then(async () => {
      await previous?.settled;
      const session = await this.ctx.sessions.summary(sessionId);
      const entry = await this.ctx.sessions.append(sessionId, {
        type: "message",
        role: "user",
        content: text,
      });
      await notifySession(this.ctx, sessionId);
      return { session, entry };
    });
    const settled = started
      .then(
        ({ session }) =>
          runTask({
            ctx: this.ctx,
            sessionId,
            workspace: session.workspace,
            scope: this.ctx.permissions.scope,
            target: this.target,
            signal: controller.signal,
          }).catch((error: unknown) => {
            console.error(`Task in session ${sessionId} failed:`, error);
          }),
        () => {},
      )
      .finally(() => {
        if (this.runs.get(sessionId) === run) this.runs.delete(sessionId);
        this.settlements.delete(settled);
      });
    run.settled = settled;
    this.runs.set(sessionId, run);
    this.settlements.add(settled);
    return (await started).entry.id;
  }

  cancel(sessionId: string): boolean {
    const run = this.runs.get(sessionId);
    if (run === undefined || run.controller.signal.aborted) return false;
    this.ctx.approvals.refuse(sessionId);
    run.controller.abort();
    return true;
  }

  async idle(sessionId: string): Promise<void> {
    const run = this.runs.get(sessionId);
    if (run === undefined) return;
    if (!run.controller.signal.aborted)
      throw new KernelError("TASK_RUNNING", `Session ${sessionId} has a running task`);
    await run.settled;
  }

  async settle(sessionId: string): Promise<void> {
    await this.runs.get(sessionId)?.settled;
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const sessionId of this.runs.keys()) this.cancel(sessionId);
    await Promise.allSettled([...this.settlements]);
  }
}
