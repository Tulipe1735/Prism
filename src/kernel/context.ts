import type { Context } from "cordis";
import type { SkillScan } from "../skills/loader.ts";
import type { Approvals } from "./approvals.ts";
import type { Attachments } from "./attachments.ts";
import type { CompactionOutcome, CompactionReason } from "./compaction.ts";
import type { PrismConfig } from "./config.ts";
import type { Creator } from "./creator.ts";
import type { KernelEvent } from "./events.ts";
import type { InstructionFiles } from "./instructions.ts";
import type { ChatEvent, StreamChatOptions } from "./model.ts";
import type { PermissionPolicy } from "./permissions.ts";
import type { SessionStore } from "./session-store.ts";
import type { Tasks } from "./tasks.ts";
import type { WorkspaceTerminals } from "./terminal.ts";
import type { ToolRegistry } from "./tools.ts";

export interface Model {
  stream: (options: Omit<StreamChatOptions, "model">) => AsyncGenerator<ChatEvent>;
}

export interface Skills {
  scan: (workspace: string) => Promise<SkillScan>;
}

export interface Compaction {
  compact: (
    sessionId: string,
    options: { reason: CompactionReason; signal?: AbortSignal },
  ) => Promise<CompactionOutcome>;
}

declare module "cordis" {
  interface Context {
    config: PrismConfig;
    sessions: SessionStore;
    tools: ToolRegistry;
    permissions: PermissionPolicy;
    approvals: Approvals;
    instructions: InstructionFiles;
    skills: Skills;
    model: Model;
    compaction: Compaction;
    creator: Creator;
    tasks: Tasks;
    attachments: Attachments;
    terminals: WorkspaceTerminals;
  }

  interface Events {
    /** @mode emit */
    "prism/event": (event: KernelEvent) => void;
  }
}

/** Publish only after the corresponding log write has completed. */
export async function notifySession(
  ctx: Pick<Context, "sessions" | "emit">,
  sessionId: string,
): Promise<void> {
  const session = await ctx.sessions.summary(sessionId);
  ctx.emit("prism/event", { type: "session.updated", session });
}
