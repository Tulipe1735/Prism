import type { SkillSummary } from "../skills/loader.ts";

import type { Kernel } from "./kernel.ts";
import type { ChatMessage } from "./model.ts";
import type { ToolResult } from "./tool.ts";
import type { ExecutionTarget, JsonValue, PermissionScope } from "./types.ts";
import { randomUUID } from "node:crypto";
import { scanSkills } from "../skills/loader.ts";
import { streamChat, toModelMessages } from "./model.ts";
import { rebuildContext } from "./session.ts";

/** Tool output longer than this is cut before it reaches the model and the log. */
export const TOOL_RESULT_LIMIT = 8_000;
/** Model rounds one task may take before the kernel stops it. */
export const MAX_MODEL_ROUNDS = 25;

export const TRUNCATION_NOTICE = `\n[result truncated after ${TOOL_RESULT_LIMIT} characters]`;
export const CANCELLED_RESULT = "Task cancelled before this tool ran.";

export interface TaskRun {
  kernel: Kernel;
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
  const { kernel, sessionId, signal } = run;
  try {
    const log = await kernel.store.read(sessionId);
    const workspace = log.header.workspace;
    const skills = (await scanSkills({ workspace, ...kernel.skillRoots })).skills;
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: buildSystemPrompt({ workspace, scope: run.scope, skills }),
      },
      ...toModelMessages(rebuildContext(log.entries)),
    ];

    for (let round = 0; round < MAX_MODEL_ROUNDS; round += 1) {
      if (signal.aborted) {
        await finish(run, "The user cancelled the task.");
        return;
      }
      const entryId = randomUUID();
      let text = "";
      const calls: { id: string; name: string; arguments: string }[] = [];
      try {
        for await (const event of streamChat({
          model: kernel.config.model,
          messages,
          tools: kernel.tools.list(),
          signal,
        })) {
          if (event.type === "text") {
            text += event.text;
            kernel.emit({
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
          await kernel.store.append(sessionId, {
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
        await kernel.store.append(sessionId, {
          type: "message",
          role: "assistant",
          content: text,
          id: entryId,
        });
      for (const call of calls)
        await kernel.store.append(sessionId, {
          type: "tool_call",
          callId: call.id,
          name: call.name,
          arguments: call.arguments,
        });
      messages.push({
        role: "assistant",
        content: text,
        ...(calls.length === 0 ? {} : { toolCalls: calls }),
      });

      if (calls.length === 0) {
        await kernel.notifySession(sessionId);
        return;
      }

      for (const call of calls) {
        let result: ToolResult;
        const started = !signal.aborted;
        if (!started) {
          result = { content: CANCELLED_RESULT, isError: true };
        } else {
          kernel.emit({
            type: "tool.started",
            sessionId,
            callId: call.id,
            name: call.name,
            arguments: parseArguments(call.arguments),
          });
          result = await executeTool(run, call);
        }
        const content = truncate(result.content);
        await kernel.store.append(sessionId, {
          type: "tool_result",
          callId: call.id,
          content,
          isError: result.isError === true,
        });
        if (started) {
          if (result.isError === true)
            kernel.emit({
              type: "tool.failed",
              sessionId,
              callId: call.id,
              error: content,
            });
          else
            kernel.emit({
              type: "tool.completed",
              sessionId,
              callId: call.id,
              result: content,
            });
        }
        messages.push({ role: "tool", content, toolCallId: call.id });
      }
      await kernel.notifySession(sessionId);

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

async function executeTool(
  run: TaskRun,
  call: { id: string; name: string; arguments: string },
): Promise<ToolResult> {
  const { kernel, sessionId } = run;
  const tool = kernel.tools.get(call.name);
  if (tool === undefined)
    return { content: `Unknown tool "${call.name}".`, isError: true };
  try {
    return await tool.execute(parseArguments(call.arguments), {
      sessionId,
      workspace: run.workspace,
      scope: run.scope,
      target: run.target,
      signal: run.signal,
      requestApproval: (request) =>
        kernel.requestApproval(sessionId, { tool: tool.name, ...request }),
    });
  } catch (error) {
    return {
      content: `Tool "${call.name}" failed: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
}

/** Appends a system entry and tells the workbench the session changed. */
async function finish(run: TaskRun, message: string): Promise<void> {
  await run.kernel.store.append(run.sessionId, {
    type: "message",
    role: "system",
    content: message,
  });
  await run.kernel.notifySession(run.sessionId);
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

/** Workspace, permission scope and available skills, stated once per task. */
export function buildSystemPrompt(input: {
  workspace: string;
  scope: PermissionScope;
  skills: SkillSummary[];
}): string {
  const lines = [
    "You are Prism, a coding agent working in the user's own repository.",
    `Workspace: ${input.workspace}. Keep every file operation inside it.`,
    `Permission scope: ${input.scope}. Actions outside the scope need one-time user approval; if approval is refused, change your approach or report honestly instead of asking again.`,
    "Use the tools to inspect and change the workspace; answer in the user's language and keep tool output out of your prose unless asked.",
  ];
  if (input.skills.length > 0) {
    lines.push(
      'Skills available for this workspace; call the "skill" tool with a name to read its instructions before following them:',
      ...input.skills.map((skill) => `- ${skill.name}: ${skill.description}`),
    );
  }
  return lines.join("\n");
}
