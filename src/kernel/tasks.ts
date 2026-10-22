import type { TaskContext } from "./loop.ts";
import type { Attachment } from "./session.ts";
import type { ExecutionTarget } from "./types.ts";
import { randomUUID } from "node:crypto";
import { notifySession } from "./context.ts";
import { KernelError } from "./errors.ts";
import { runTask } from "./loop.ts";
import { nameSession } from "./session-title.ts";

interface Run {
  controller: AbortController;
  settled: Promise<void>;
  accepting: boolean;
  steering: {
    entryId: string;
    text: string;
    context?: string;
    attachments: Attachment[];
  }[];
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
  async send(
    sessionId: string,
    text: string,
    attachmentIds: string[] = [],
    inputContext?: string,
  ): Promise<string> {
    if (this.closed) throw new Error("The task service is stopping");
    const previous = this.runs.get(sessionId);
    if (previous !== undefined && !previous.controller.signal.aborted)
      throw new KernelError(
        "TASK_RUNNING",
        `Session ${sessionId} already has a running task`,
      );

    const controller = new AbortController();
    const run: Run = {
      controller,
      settled: Promise.resolve(),
      accepting: true,
      steering: [],
    };
    const started = Promise.resolve().then(async () => {
      await previous?.settled;
      const session = await this.ctx.sessions.summary(sessionId);
      const attachments = await this.ctx.attachments.read(sessionId, attachmentIds);
      if (text.trim() === "" && attachments.length === 0)
        throw new KernelError("INVALID_REQUEST", "消息和附件不能同时为空。");
      const entry = await this.ctx.sessions.append(sessionId, {
        type: "message",
        role: "user",
        content: text,
        ...(inputContext === undefined ? {} : { context: inputContext }),
        ...(attachments.length === 0 ? {} : { attachments }),
      });
      await notifySession(this.ctx, sessionId);
      this.ctx.emit("prism/event", { type: "task.state", sessionId, running: true });
      return {
        session,
        entry,
        titleText: text.trim() || attachments.map((file) => file.name).join("、"),
      };
    });
    const settled = started
      .then(
        async ({ session, titleText }) => {
          await nameSession(this.ctx, session, titleText, controller.signal);
          return runTask({
            ctx: this.ctx,
            sessionId,
            workspace: session.workspace,
            scope: this.ctx.permissions.scope,
            target: this.target,
            signal: controller.signal,
            takeSteering: async (finishing = false) => {
              const inputs = run.steering.splice(0);
              // Close the acceptance window synchronously with the final drain.
              if (finishing && inputs.length === 0) run.accepting = false;
              for (const input of inputs) {
                await this.ctx.sessions.append(sessionId, {
                  type: "message",
                  role: "user",
                  content: input.text,
                  ...(input.context === undefined ? {} : { context: input.context }),
                  id: input.entryId,
                  ...(input.attachments.length === 0
                    ? {}
                    : { attachments: input.attachments }),
                });
                this.ctx.emit("prism/event", {
                  type: "task.input",
                  sessionId,
                  entryId: input.entryId,
                  state: "applied",
                });
              }
              if (inputs.length > 0) await notifySession(this.ctx, sessionId);
              return inputs.length > 0;
            },
          }).catch((error: unknown) => {
            console.error(`Task in session ${sessionId} failed:`, error);
          });
        },
        () => {},
      )
      .finally(() => {
        run.accepting = false;
        for (const input of run.steering.splice(0))
          this.ctx.emit("prism/event", {
            type: "task.input",
            sessionId,
            entryId: input.entryId,
            state: "cancelled",
          });
        if (this.runs.get(sessionId) === run) this.runs.delete(sessionId);
        this.settlements.delete(settled);
        this.ctx.emit("prism/event", {
          type: "task.state",
          sessionId,
          running: false,
        });
      });
    run.settled = settled;
    this.runs.set(sessionId, run);
    this.settlements.add(settled);
    return (await started).entry.id;
  }

  pending(sessionId: string): { entryId: string; text: string }[] {
    return (this.runs.get(sessionId)?.steering ?? []).map(({ entryId, text }) => ({
      entryId,
      text,
    }));
  }

  /** Inputs enter the shared loop only between complete model/tool rounds. */
  async steer(
    sessionId: string,
    text: string,
    attachmentIds: string[] = [],
    inputContext?: string,
  ): Promise<string> {
    const run = this.runs.get(sessionId);
    await this.ctx.sessions.summary(sessionId);
    const attachments = await this.ctx.attachments.read(sessionId, attachmentIds);
    if (text.trim() === "" && attachments.length === 0)
      throw new KernelError("INVALID_REQUEST", "消息和附件不能同时为空。");
    if (
      this.closed ||
      run === undefined ||
      this.runs.get(sessionId) !== run ||
      !run.accepting ||
      run.controller.signal.aborted
    )
      throw new KernelError(
        "TASK_NOT_RUNNING",
        "当前没有可接收补充指令的任务，请发送新消息。",
      );
    const entryId = randomUUID();
    run.steering.push({
      entryId,
      text,
      attachments,
      ...(inputContext === undefined ? {} : { context: inputContext }),
    });
    this.ctx.emit("prism/event", {
      type: "task.input",
      sessionId,
      entryId,
      state: "queued",
    });
    return entryId;
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
