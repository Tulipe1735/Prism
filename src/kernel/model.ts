import type { ModelConfig } from "./config.ts";
import type { ContextMessage, MessageRole } from "./session.ts";
import type { ToolParameters } from "./tool.ts";
import { readSseData } from "../shared/sse.ts";

/** One model-ready message, in the shape the loop builds from the session log. */
export interface ChatMessage {
  role: MessageRole;
  content: string;
  /** Assistant tool calls; `arguments` is the JSON text as received. */
  toolCalls?: { id: string; name: string; arguments: string }[];
  /** Set on tool messages: the call this result answers. */
  toolCallId?: string;
}

/** Session context messages in the shape the model transport sends. */
export function toModelMessages(messages: ContextMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    ...(message.toolCalls === undefined ? {} : { toolCalls: message.toolCalls }),
    ...(message.toolCallId === undefined ? {} : { toolCallId: message.toolCallId }),
  }));
}

export interface ModelToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameters;
}

export type ChatEvent =
  /** Text the model streamed; emit it to the workbench as it arrives. */
  | { type: "text"; text: string }
  /** A complete tool call, assembled from the stream fragments. */
  | { type: "tool_call"; id: string; name: string; arguments: string };

export interface StreamChatOptions {
  model: ModelConfig;
  messages: ChatMessage[];
  /** Omitted or empty for internal calls, such as compaction summaries. */
  tools?: ModelToolDefinition[];
  signal: AbortSignal;
  /** Overridden in tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/** Thrown when the provider refuses or the stream cannot be read. */
export class ModelError extends Error {
  override name = "ModelError";
}

/**
 * Streams one chat completion from an OpenAI-compatible endpoint. No retries:
 * a failure reaches the task loop, which reports it honestly instead of
 * pretending the model replied.
 */
export async function* streamChat(
  options: StreamChatOptions,
): AsyncGenerator<ChatEvent> {
  const response = await (options.fetchImpl ?? fetch)(
    chatCompletionsUrl(options.model),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(options.model.apiKey === undefined
          ? {}
          : { authorization: `Bearer ${options.model.apiKey}` }),
      },
      body: JSON.stringify({
        model: options.model.model,
        messages: options.messages.map(wireMessage),
        ...(options.tools === undefined || options.tools.length === 0
          ? {}
          : { tools: options.tools.map(wireTool) }),
        stream: true,
      }),
      signal: options.signal,
    },
  );
  if (!response.ok)
    throw new ModelError(
      `Model request failed with HTTP ${response.status}: ${(await response.text().catch(() => "")).slice(0, 300)}`,
    );
  if (response.body === null) throw new ModelError("Model response has no body");

  const calls = new Map<number, AccumulatedCall>();
  for await (const data of readSseData(response.body)) {
    if (data === "[DONE]") {
      yield* completeCalls(calls);
      return;
    }
    for (const event of readChunk(data, calls)) yield event;
  }
  yield* completeCalls(calls);
}

function* completeCalls(calls: Map<number, AccumulatedCall>): Generator<ChatEvent> {
  for (const call of [...calls.values()].sort((a, b) => a.index - b.index))
    yield {
      type: "tool_call",
      id: call.id,
      name: call.name,
      arguments: call.arguments,
    };
}

interface AccumulatedCall {
  index: number;
  id: string;
  name: string;
  arguments: string;
}

/** Turn one `data:` payload into text events and accumulated tool calls. */
function readChunk(data: string, calls: Map<number, AccumulatedCall>): ChatEvent[] {
  let payload: DeltaPayload;
  try {
    payload = JSON.parse(data) as DeltaPayload;
  } catch {
    throw new ModelError(
      `Model sent an unreadable stream chunk: ${data.slice(0, 200)}`,
    );
  }
  const delta = payload.choices?.[0]?.delta;
  if (delta === undefined) return [];
  const events: ChatEvent[] = [];
  if (typeof delta.content === "string" && delta.content !== "")
    events.push({ type: "text", text: delta.content });
  for (const fragment of delta.tool_calls ?? []) {
    const call = calls.get(fragment.index) ?? {
      index: fragment.index,
      id: "",
      name: "",
      arguments: "",
    };
    calls.set(fragment.index, {
      index: fragment.index,
      id: fragment.id ?? call.id,
      name: call.name || (fragment.function?.name ?? ""),
      arguments: call.arguments + (fragment.function?.arguments ?? ""),
    });
  }
  return events;
}

interface DeltaPayload {
  choices?: {
    delta?: {
      content?: string;
      tool_calls?: {
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
  }[];
}

function chatCompletionsUrl(model: ModelConfig): string {
  return `${model.baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

function wireMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === "tool")
    return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
  if (message.toolCalls !== undefined && message.toolCalls.length > 0)
    return {
      role: message.role,
      content: message.content === "" ? null : message.content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      })),
    };
  return { role: message.role, content: message.content };
}

function wireTool(tool: ModelToolDefinition): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}
