import type { Context } from "cordis";

import type { SkillSummary } from "../skills/loader.ts";
import type { InstructionFile } from "./instructions.ts";
import type { ChatMessage } from "./model.ts";
import type { PermissionAction } from "./permissions.ts";
import type { Tool, ToolContext, ToolResult } from "./tool.ts";
import type { ExecutionTarget, JsonValue, PermissionScope } from "./types.ts";
import { randomUUID } from "node:crypto";
import { estimateContextTokens } from "./compaction.ts";
import { notifySession } from "./context.ts";
import { loadCreatorGuide } from "./creator.ts";
import { instructionNote, instructionPrompt } from "./instructions.ts";
import { toModelMessages } from "./model.ts";
import { describeScope } from "./permissions.ts";
import { rebuildContext } from "./session.ts";

/** Tool output longer than this is cut before it reaches the model and the log. */
export const TOOL_RESULT_LIMIT = 8_000;
/** Model rounds one task may take before the kernel stops it. */
export const MAX_MODEL_ROUNDS = 100;

export const TRUNCATION_NOTICE = `\n[result truncated after ${TOOL_RESULT_LIMIT} characters]`;
export const CANCELLED_RESULT = "Task cancelled before this tool ran.";

export type TaskContext = Pick<
  Context,
  | "config"
  | "sessions"
  | "tools"
  | "permissions"
  | "approvals"
  | "instructions"
  | "skills"
  | "model"
  | "compaction"
  | "attachments"
  | "emit"
>;

export interface TaskRun {
  ctx: TaskContext;
  sessionId: string;
  workspace: string;
  scope: PermissionScope;
  target: ExecutionTarget;
  signal: AbortSignal;
}

/**
 * One user turn: asks the model, runs the tools it asks for, feeds the results
 * back, and repeats until the model answers without calling a tool. Every step
 * lands in the session log and is pushed as an event as it happens.
 */
export async function runTask(run: TaskRun): Promise<void> {
  const { ctx, sessionId, signal } = run;
  try {
    const log = await ctx.sessions.read(sessionId);
    const workspace = log.header.workspace;
    const skills = (await ctx.skills.scan(workspace)).skills;
    /** Once a summary fails the run keeps its full history instead of retrying. */
    let compactionFailed = false;

    /** The request the loop sends next, 从会话日志中重建 */
    const requestMessages = async (): Promise<ChatMessage[]> => {
      const files = await ctx.instructions.activeFor(workspace);
      return [
        {
          role: "system",
          content: await buildSystemPrompt({
            workspace,
            scope: run.scope,
            skills,
            instructions: files,
            creator: ctx.config.creator.enabled,
          }),
        },
        ...toModelMessages(
          rebuildContext((await ctx.sessions.read(sessionId)).entries),
        ),
        ...files
          .filter((file) => file.scope === "nested")
          .map((file) => ({ role: "system" as const, content: instructionNote(file) })),
      ];
    };

    for (let round = 0; round < MAX_MODEL_ROUNDS; round += 1) {
      if (signal.aborted) {
        await finish(run, "The user cancelled the task.");
        return;
      }
      let messages = await requestMessages();
      if (
        !compactionFailed &&
        estimateContextTokens(messages) > ctx.config.compaction.triggerTokens
      ) {
        try {
          const outcome = await ctx.compaction.compact(sessionId, {
            reason: "auto",
            signal,
          });
          if (outcome.compacted) messages = await requestMessages();
        } catch (error) {
          if (signal.aborted) throw error;
          compactionFailed = true;
          await ctx.sessions.append(sessionId, {
            type: "message",
            role: "system",
            content: `Automatic compaction failed: ${error instanceof Error ? error.message : String(error)}. The task continues with the full history.`,
          });
          await notifySession(ctx, sessionId);
          messages = await requestMessages();
        }
      }
      const entryId = randomUUID();
      let text = "";
      const calls: { id: string; name: string; arguments: string }[] = [];
      try {
        for await (const event of ctx.model.stream({
          messages,
          tools: ctx.tools.list(),
          signal,
        })) {
          if (event.type === "text") {
            text += event.text;
            ctx.emit("prism/event", {
              type: "message.delta",
              sessionId,
              entryId,
              delta: event.text,
            });
          } else {
            calls.push({ id: event.id, name: event.name, arguments: event.arguments });
          }
        }
      } catch (error) {
        if (!signal.aborted) throw error;
        if (text !== "")
          await ctx.sessions.append(sessionId, {
            type: "message",
            role: "assistant",
            content: text,
            id: entryId,
          });
        await finish(run, "The user cancelled the task.");
        return;
      }

      if (text === "" && calls.length === 0) {
        await finish(run, "The model returned no content.");
        return;
      }
      if (text !== "")
        await ctx.sessions.append(sessionId, {
          type: "message",
          role: "assistant",
          content: text,
          id: entryId,
        });
      // The effects are decided before the log records the call, so the
      // workbench can tell a file change from a read without guessing names.
      const prepared = calls.map((call) => prepareCall(run, call));
      for (const item of prepared)
        await ctx.sessions.append(sessionId, {
          type: "tool_call",
          callId: item.call.id,
          name: item.call.name,
          arguments: item.call.arguments,
          ...(item.effects.length === 0 ? {} : { effects: item.effects }),
        });

      if (calls.length === 0) {
        await notifySession(ctx, sessionId);
        return;
      }

      for (const item of prepared) {
        let result: ToolResult;
        const started = !signal.aborted;
        if (!started) {
          result = { content: CANCELLED_RESULT, isError: true };
        } else {
          ctx.emit("prism/event", {
            type: "tool.started",
            sessionId,
            callId: item.call.id,
            name: item.call.name,
            arguments: item.args,
          });
          result = await executeTool(run, item);
        }
        const content = truncate(result.content);
        await ctx.sessions.append(sessionId, {
          type: "tool_result",
          callId: item.call.id,
          content,
          isError: result.isError === true,
        });
        if (started) {
          if (result.isError === true)
            ctx.emit("prism/event", {
              type: "tool.failed",
              sessionId,
              callId: item.call.id,
              error: content,
            });
          else
            ctx.emit("prism/event", {
              type: "tool.completed",
              sessionId,
              callId: item.call.id,
              result: content,
            });
        }
      }
      await notifySession(ctx, sessionId);

      if (signal.aborted) {
        await finish(run, "The user cancelled the task.");
        return;
      }
    }
    await finish(
      run,
      `The task stopped after ${MAX_MODEL_ROUNDS} model rounds. Send a new message to continue.`,
    );
  } catch (error) {
    if (signal.aborted) {
      await finish(run, "The user cancelled the task.");
      return;
    }
    await finish(
      run,
      `Task failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** One tool call with everything the loop needs to log and run it. */
interface PreparedCall {
  call: { id: string; name: string; arguments: string };
  /** Absent when the model asked for a tool the kernel does not have. */
  tool?: Tool;
  args: JsonValue;
  context?: ToolContext;
  /** What the call declares it will touch; empty when the tool declares nothing. */
  effects: PermissionAction[];
  /** Set when deciding the effects failed; the call is refused instead of run. */
  effectError?: string;
}

/**
 * Resolves one call the model made: the tool, its parsed arguments, the context
 * of the call, and the effects the kernel judges before it runs. The effects are
 * decided here so the log records them, and the permission check reuses them.
 */
function prepareCall(
  run: TaskRun,
  call: { id: string; name: string; arguments: string },
): PreparedCall {
  const tool = run.ctx.tools.get(call.name);
  const args = parseArguments(call.arguments);
  if (tool === undefined) return { call, args, effects: [] };
  const context = toolContext(run, tool.name);
  try {
    return { call, tool, args, context, effects: tool.effects?.(args, context) ?? [] };
  } catch (error) {
    return {
      call,
      tool,
      args,
      context,
      effects: [],
      effectError: error instanceof Error ? error.message : String(error),
    };
  }
}

/** The live context of one tool call, shared by its effect check and its run. */
function toolContext(run: TaskRun, toolName: string): ToolContext {
  const { ctx, sessionId } = run;
  return {
    sessionId,
    workspace: run.workspace,
    scope: ctx.permissions.scope,
    permissions: ctx.permissions,
    target: run.target,
    signal: run.signal,
    requestApproval: (request) =>
      ctx.approvals.request(sessionId, { tool: toolName, ...request }),
    noteExplored: (path) => ctx.instructions.noteExplored(run.workspace, path),
  };
}

async function executeTool(run: TaskRun, prepared: PreparedCall): Promise<ToolResult> {
  const { ctx } = run;
  const { call, tool, args, context, effects, effectError } = prepared;
  if (tool === undefined || context === undefined)
    return { content: `Unknown tool "${call.name}".`, isError: true };
  if (effectError !== undefined)
    return { content: `Tool "${call.name}" failed: ${effectError}`, isError: true };
  try {
    // The permission scope is enforced here, before the tool runs: a call
    // whose action is out of scope needs approval first.
    const verdict = await ctx.permissions.authorizeAll(effects, {
      workspace: run.workspace,
      requestApproval: context.requestApproval,
    });
    if (!verdict.allowed) return { content: verdict.refusal, isError: true };
    return await ctx.tools.execute(tool, args, context);
  } catch (error) {
    return {
      content: `Tool "${call.name}" failed: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
}

/** Appends a system entry and tells the workbench the session changed. */
async function finish(run: TaskRun, message: string): Promise<void> {
  await run.ctx.sessions.append(run.sessionId, {
    type: "message",
    role: "system",
    content: message,
  });
  await notifySession(run.ctx, run.sessionId);
}

/** Parses tool call arguments; unreadable JSON stays visible as the raw text. */
function parseArguments(raw: string): JsonValue {
  try {
    return JSON.parse(raw) as JsonValue;
  } catch {
    return raw;
  }
}

function truncate(content: string): string {
  return content.length <= TOOL_RESULT_LIMIT
    ? content
    : content.slice(0, TOOL_RESULT_LIMIT) + TRUNCATION_NOTICE;
}

/** Workspace, permission scope, instructions and skills, stated once per task. */
export async function buildSystemPrompt(input: {
  workspace: string;
  scope: PermissionScope;
  skills: SkillSummary[];
  instructions?: InstructionFile[];
  creator?: boolean;
}): Promise<string> {
  const lines = [
    "You are Prism, a personal agent that operates software and works with files in the user's chosen workspace.",
    `Workspace: ${input.workspace}. Keep every file operation inside it.`,
    `Permission scope: ${input.scope} — ${describeScope(input.scope)}. If an action is refused, change your approach or report honestly instead of asking again.`,
    "Use the tools to inspect and change the workspace; answer in the user's language and keep tool output out of your prose unless asked.",
  ];
  const instructions = instructionPrompt(input.instructions ?? []);
  if (instructions !== undefined) lines.push(instructions);
  if (input.creator) lines.push(await loadCreatorGuide());
  if (input.skills.length > 0) {
    lines.push(
      'Skills available for this workspace; call the "skill" tool with a name to read its instructions before following them:',
      ...input.skills.map((skill) => `- ${skill.name}: ${skill.description}`),
    );
  }
  return lines.join("\n");
}
