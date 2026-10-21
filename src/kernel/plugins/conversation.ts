import type { Context } from "cordis";
import type { CompactionOutcome } from "../compaction.ts";
import type { Compaction } from "../context.ts";
import type { KernelOptions } from "../kernel.ts";
import { scanSkills } from "../../skills/loader.ts";
import { compactSession } from "../compaction.ts";
import { notifySession } from "../context.ts";
import { InstructionFiles } from "../instructions.ts";
import { createSkillTool } from "../tools.ts";

export const instructions = {
  name: "instructions",
  apply(ctx: Context, options: KernelOptions) {
    ctx.provide("instructions", new InstructionFiles(options.instructionRoots));
  },
};

export const skills = {
  name: "skills",
  inject: ["tools"],
  apply(ctx: Context, options: KernelOptions) {
    const roots = options.skillRoots ?? {};
    ctx.provide("skills", {
      scan: (workspace) => scanSkills({ workspace, ...roots }),
    });
    ctx.effect(() => ctx.tools.register(createSkillTool(roots)));
  },
};

export const compaction = {
  name: "compaction",
  inject: ["config", "sessions", "model"],
  apply(ctx: Context) {
    const pending = new Map<AbortController, Promise<CompactionOutcome>>();
    let closed = false;
    const compact: Compaction["compact"] = async (sessionId, options) => {
      const outcome = await compactSession({
        store: ctx.sessions,
        stream: (request) => ctx.model.stream(request),
        compaction: ctx.config.compaction,
        sessionId,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      if (outcome.compacted && outcome.entryId !== undefined) {
        await notifySession(ctx, sessionId);
        ctx.emit("prism/event", {
          type: "session.compacted",
          sessionId,
          entryId: outcome.entryId,
          reason: options.reason,
        });
      }
      return outcome;
    };
    const service: Compaction = {
      compact(sessionId, options) {
        if (closed) return Promise.reject(new Error("Compaction is stopping"));
        const controller = new AbortController();
        const operation = compact(sessionId, {
          ...options,
          signal:
            options.signal === undefined
              ? controller.signal
              : AbortSignal.any([controller.signal, options.signal]),
        }).finally(() => {
          pending.delete(controller);
        });
        pending.set(controller, operation);
        return operation;
      },
    };
    ctx.effect(function* () {
      yield ctx.provide("compaction", service);
      yield async () => {
        closed = true;
        for (const controller of pending.keys()) controller.abort();
        await Promise.allSettled([...pending.values()]);
      };
    });
  },
};
