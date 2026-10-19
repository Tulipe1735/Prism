import type { CompactionConfig, ModelConfig } from "./config.ts";
import type { ChatMessage } from "./model.ts";
import type { SessionStore } from "./session-store.ts";
import type { ContextMessage } from "./session.ts";
import { streamChat, toModelMessages } from "./model.ts";
import { rebuildContext } from "./session.ts";

/** Why a compaction ran. */
export type CompactionReason = "auto" | "manual";

export interface CompactionOutcome {
  compacted: boolean;
  /** Id of the `compaction` entry, when one was written. */
  entryId?: string;
  /** Why the context was left untouched, when `compacted` is false. */
  reason?: string;
}

export interface CompactSessionOptions {
  store: SessionStore;
  model: ModelConfig;
  compaction: CompactionConfig;
  sessionId: string;
  signal?: AbortSignal;
  /** Overridden in tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/** Assistant or tool messages carry tool bookkeeping on top of their text. */
const MESSAGE_OVERHEAD_TOKENS = 8;

/** Rough token count: about four characters per token for prose, code and JSON. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Rough token count of a request's messages, tool calls included. */
export function estimateContextTokens(messages: ChatMessage[]): number {
  let tokens = 0;
  for (const message of messages) {
    tokens += estimateTokens(message.content) + MESSAGE_OVERHEAD_TOKENS;
    for (const call of message.toolCalls ?? [])
      tokens +=
        estimateTokens(call.name) +
        estimateTokens(call.arguments) +
        MESSAGE_OVERHEAD_TOKENS;
  }
  return tokens;
}

/**
 * Replaces the older part of a session's context with a model-written summary.
 * The newest `keepTokens` worth of context stays verbatim; the entries
 * themselves stay in the session log untouched.
 */
export async function compactSession(
  options: CompactSessionOptions,
): Promise<CompactionOutcome> {
  const log = await options.store.read(options.sessionId);
  const messages = rebuildContext(log.entries);
  const keepFrom = firstKeptIndex(messages, options.compaction.keepTokens);
  if (keepFrom === 0)
    return {
      compacted: false,
      reason: "The whole context still fits in the kept window.",
    };

  const summary = (
    await generateSummary({
      model: options.model,
      messages: messages.slice(0, keepFrom),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    })
  ).trim();
  if (summary === "")
    return { compacted: false, reason: "The model returned an empty summary." };

  const entry = await options.store.append(options.sessionId, {
    type: "compaction",
    summary,
    firstKeptEntryId: messages[keepFrom]?.entryId ?? null,
  });
  return { compacted: true, entryId: entry.id };
}

/**
 * Index of the oldest context message kept verbatim: the newest messages whose
 * estimated size stays within `keepTokens`. The kept window never starts on a
 * tool result whose tool call was compacted away, so the context stays valid.
 */
function firstKeptIndex(messages: ContextMessage[], keepTokens: number): number {
  let tokens = 0;
  let index = messages.length;
  while (index > 0) {
    const size = estimateContextTokens(toModelMessages([messages[index - 1]!]));
    if (tokens > 0 && tokens + size > keepTokens) break;
    tokens += size;
    index -= 1;
  }
  while (index > 0 && messages[index]?.role === "tool") index -= 1;
  return index;
}

const SUMMARY_INSTRUCTION = [
  "You are compacting a coding session so another model can continue the task without the conversation above.",
  "Summarize it in the language the conversation used, under these sections, in order:",
  "目标 (goal), 决策 (decisions), 进行中 (in progress), 下一步 (next steps), 相关文件 (relevant files).",
  "Keep file paths, commands and identifiers exact; say what is unknown instead of guessing.",
].join("\n");

/** One model call without tools: the summary of the context being replaced. */
async function generateSummary(input: {
  model: ModelConfig;
  messages: ContextMessage[];
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  let summary = "";
  for await (const event of streamChat({
    model: input.model,
    messages: [
      { role: "system", content: SUMMARY_INSTRUCTION },
      ...toModelMessages(input.messages),
    ],
    signal: input.signal ?? new AbortController().signal,
    ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
  })) {
    if (event.type === "text") summary += event.text;
  }
  return summary;
}
