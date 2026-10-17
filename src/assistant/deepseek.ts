import type { Model, ModelMessage, ModelReply, ToolDefinition, Usage } from "./types.ts";
import { z } from "zod";

const usageSchema = z.object({
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  prompt_cache_hit_tokens: z.number().int().nonnegative().optional(),
});
const messageSchema = z.object({
  role: z.literal("assistant"),
  content: z.string().nullable(),
  reasoning_content: z.string().nullable().optional(),
  tool_calls: z.array(z.object({
    id: z.string().min(1),
    type: z.literal("function"),
    function: z.object({ name: z.string().min(1), arguments: z.string() }),
  })).nullable().optional(),
});

export class ModelRequestError extends Error {
  readonly usage?: Usage;

  constructor(message: string, usage?: Usage) {
    super(message);
    this.name = "ModelRequestError";
    this.usage = usage;
  }
}

/** Native Chat Completions transport; retries belong to the budgeted task loop. */
export class DeepSeekModel implements Model {
  private readonly options: { apiKey: string; model: string; baseUrl?: string; fetch?: typeof globalThis.fetch; thinking?: boolean };

  constructor(options: { apiKey: string; model: string; baseUrl?: string; fetch?: typeof globalThis.fetch; thinking?: boolean }) {
    if (!options.apiKey.trim() || !options.model.trim()) throw new Error("DeepSeek API key and model are required");
    this.options = options;
  }

  async complete(messages: ModelMessage[], tools: ToolDefinition[], options: { signal: AbortSignal; maxOutputTokens: number }): Promise<ModelReply> {
    options.signal.throwIfAborted();
    const response = await (this.options.fetch ?? globalThis.fetch)(`${(this.options.baseUrl ?? "https://api.deepseek.com").replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${this.options.apiKey}`, "Content-Type": "application/json" },
      signal: options.signal,
      body: JSON.stringify({
        model: this.options.model,
        messages,
        tools: tools.map(definition => ({ type: "function", function: definition })),
        max_tokens: options.maxOutputTokens,
        stream: false,
        thinking: { type: this.options.thinking === false ? "disabled" : "enabled" },
      }),
    });
    if (!response.ok) throw new ModelRequestError(`DeepSeek HTTP ${response.status}; check authorization, provider availability and quota`);
    const body: unknown = await response.json();
    const envelope = z.object({ usage: usageSchema, choices: z.array(z.object({ message: z.unknown(), finish_reason: z.string().optional() })).min(1) }).safeParse(body);
    if (!envelope.success) throw new ModelRequestError("DeepSeek response has no valid usage or completion; cost remains conservatively reserved");
    const rawUsage = envelope.data.usage;
    const usage: Usage = {
      inputTokens: rawUsage.prompt_tokens,
      outputTokens: rawUsage.completion_tokens,
      cacheHitTokens: Math.min(rawUsage.prompt_cache_hit_tokens ?? 0, rawUsage.prompt_tokens),
    };
    const choice = envelope.data.choices[0]!;
    const parsed = messageSchema.safeParse(choice.message);
    if (!parsed.success) throw new ModelRequestError("DeepSeek returned a malformed assistant message", usage);
    const value = parsed.data;
    if (!value.content?.trim() && !value.tool_calls?.length) throw new ModelRequestError("DeepSeek returned no answer or tool request", usage);
    return {
      message: {
        role: "assistant",
        content: value.content,
        ...(value.reasoning_content != null ? { reasoning_content: value.reasoning_content } : {}),
        ...(value.tool_calls?.length ? { tool_calls: value.tool_calls } : {}),
      },
      usage,
      finishReason: choice.finish_reason,
    };
  }
}
