import type { ModelConfig } from "./config.ts";
import type { Attachment, ContextMessage, MessageRole } from "./session.ts";
import type { ToolParameters } from "./tool.ts";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { readSseData } from "../shared/sse.ts";

export type ChatContentPart =
  { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

/** One model-ready message, in the shape the loop builds from the session log. */
export interface ChatMessage {
  role: MessageRole;
  content: string;
  /** Local image references; bytes are loaded only when sending the request. */
  images?: Attachment[];
  /** Assistant tool calls; `arguments` is the JSON text as received. */
  toolCalls?: { id: string; name: string; arguments: string }[];
  /** Set on tool messages: the call this result answers. */
  toolCallId?: string;
  /**
   * The thinking content that preceded this assistant message. Requests that
   * carry tools must send it back, so the provider can reconstruct the turn.
   */
  reasoning?: string;
}

/** Session context messages in the shape the model transport sends. */
export function toModelMessages(messages: ContextMessage[]): ChatMessage[] {
  return messages.map((message) => {
    const content =
      message.context === undefined
        ? message.content
        : [
            message.content,
            `Context supplied by the user interface (user-level task data):\n${message.context}`,
          ]
            .filter(Boolean)
            .join("\n\n");
    const attachments = message.attachments ?? [];
    const images =
      message.role === "user"
        ? attachments.flatMap((file) => {
            const mediaType = imageMediaType(file);
            return mediaType === undefined ? [] : [{ ...file, mediaType }];
          })
        : [];
    return {
      role: message.role,
      content:
        attachments.length === 0
          ? content
          : [
              content,
              images.length === 0
                ? "Attached local files (use file tools to inspect their contents):"
                : "Attached local files (JPEG, PNG, GIF and WebP images are included as image content; use file tools for other files):",
              ...attachments.map((file) =>
                JSON.stringify({
                  name: file.name,
                  path: file.path,
                  size: file.size,
                  mediaType: file.mediaType,
                }),
              ),
            ]
              .filter(Boolean)
              .join("\n\n"),
      ...(images.length === 0 ? {} : { images }),
      ...(message.toolCalls === undefined ? {} : { toolCalls: message.toolCalls }),
      ...(message.toolCallId === undefined ? {} : { toolCallId: message.toolCallId }),
      ...(message.reasoning === undefined ? {} : { reasoning: message.reasoning }),
    };
  });
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
const IMAGE_MEDIA_TYPES = new Set(Object.values(IMAGE_EXTENSIONS));

function imageMediaType(file: Attachment): string | undefined {
  const mediaType = file.mediaType.split(";")[0]?.trim().toLowerCase() ?? "";
  return IMAGE_MEDIA_TYPES.has(mediaType)
    ? mediaType
    : IMAGE_EXTENSIONS[extname(file.name).toLowerCase()];
}

export interface ModelToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameters;
}

export type ChatEvent =
  /** Text the model streamed; emit it to the workbench as it arrives. */
  | { type: "text"; text: string }
  /**
   * Thinking the model streamed before its answer. It stays transport state:
   * the loop keeps it for the next request but never shows it as a result.
   */
  | { type: "reasoning"; text: string }
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
 * 从兼容 OpenAI API 的端点流式获取一次聊天补全结果。
 * 不进行重试：如果请求失败，错误会直接传递给任务循环，
 * 由任务循环如实报告，而不是假装模型已成功返回响应。
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
        reasoning_effort: options.model.thinking,
        messages: await Promise.all(
          options.messages.map((message) => wireMessage(message, options.signal)),
        ),
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
  if (typeof delta.reasoning_content === "string" && delta.reasoning_content !== "")
    events.push({ type: "reasoning", text: delta.reasoning_content });
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
      reasoning_content?: string;
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

// 内部消息 -> API消息格式
async function wireMessage(
  message: ChatMessage,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  let content: string | ChatContentPart[] = message.content;
  if (message.images !== undefined && message.images.length > 0) {
    if (message.role !== "user")
      throw new ModelError("Images can only be sent in user messages.");
    const parts: ChatContentPart[] =
      content === "" ? [] : [{ type: "text", text: content }];
    for (const image of message.images) {
      let bytes;
      try {
        bytes = await readFile(image.path, { signal });
      } catch (error) {
        if (signal.aborted) throw error;
        throw new ModelError(
          `Could not read attached image ${JSON.stringify(image.name)} at ${image.path}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      parts.push({
        type: "image_url",
        image_url: {
          url: `data:${image.mediaType};base64,${bytes.toString("base64")}`,
        },
      });
    }
    content = parts;
  }
  if (message.role === "tool")
    return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
  const body =
    message.toolCalls !== undefined && message.toolCalls.length > 0
      ? {
          role: message.role,
          content: content === "" ? null : content,
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: call.arguments },
          })),
        }
      : { role: message.role, content };
  return message.reasoning === undefined
    ? body
    : { ...body, reasoning_content: message.reasoning };
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
