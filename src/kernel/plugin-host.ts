import type { AgentSnapshot } from "../../packages/plugin-sdk/src/index.ts";
import type { Kernel } from "./kernel.ts";
import { z } from "zod";
import { MAX_ATTACHMENTS } from "../shared/attachments.ts";
import { KernelError } from "./errors.ts";

const inputSchema = z
  .object({
    text: z.string().max(500_000),
    context: z.string().max(32_000).optional(),
    attachments: z.array(z.string().uuid()).max(MAX_ATTACHMENTS).default([]),
  })
  .strict();
const commandSchema = z.object({ command: z.enum(["cancel", "compact"]) }).strict();

/** The transport supplies plugin/session identity; input cannot override either. */
export async function assertPluginUi(
  kernel: Kernel,
  plugin: string,
  sessionId: string,
): Promise<void> {
  if (!kernel.ctx.creator.ui().some((entry) => entry.plugin === plugin))
    throw new KernelError("PLUGIN_NOT_FOUND", `Plugin UI "${plugin}" is not active.`);
  await kernel.ctx.sessions.summary(sessionId);
}

export async function pluginHostRequest(
  kernel: Kernel,
  plugin: string,
  method: string,
  sessionId: string,
  input: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  await assertPluginUi(kernel, plugin, sessionId);
  signal.throwIfAborted();
  if (method === "agent.read") {
    const { entries, running, approvals } = await kernel.readSession(sessionId);
    return {
      sessionId,
      running,
      entries,
      pending: kernel.ctx.tasks.pending(sessionId),
      approvals,
    } satisfies AgentSnapshot;
  }
  if (method === "agent.send" || method === "agent.steer") {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) throw new KernelError("INVALID_REQUEST", parsed.error.message);
    const { text, attachments, context } = parsed.data;
    const entryId = await (method === "agent.send"
      ? kernel.sendMessage(sessionId, text, attachments, context)
      : kernel.steerSession(sessionId, text, attachments, context));
    return { entryId };
  }
  if (method === "agent.command") {
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success) throw new KernelError("INVALID_REQUEST", parsed.error.message);
    return parsed.data.command === "cancel"
      ? { cancelled: kernel.cancelSession(sessionId) }
      : kernel.compactManually(sessionId, signal);
  }
  throw new KernelError("INVALID_REQUEST", `Unsupported host method: ${method}`);
}
