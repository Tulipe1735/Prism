import type { HistoryEntry, Snapshot, SnapshotAction } from "../shared/types.ts";
import process from "node:process";
import { postJson } from "../shared/http.ts";
import { TEXT_VALUE } from "./prompts.ts";

export interface TextContext {
  goal: string;
  field: Pick<SnapshotAction, "label" | "role" | "value">;
  page: { title: string; text: string };
  recent_actions: Array<{ action: string; text: string | null }>;
}

export interface TextHelperOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  reasoning?: string;
  sessionId?: string;
  fetchImpl?: typeof fetch;
}

export interface TextHelperResult {
  text: string | null;
  model: string;
  usage: Record<string, unknown>;
  latencyMs: number;
}

export function fieldContext(
  goal: string,
  action: SnapshotAction,
  page: Snapshot,
  history: HistoryEntry[],
): TextContext {
  return {
    goal,
    field: { label: action.label, role: action.role, value: action.value },
    page: { title: page.title, text: page.text.slice(0, 6000) },
    recent_actions: history.slice(-6).map((entry) => ({
      action: entry.action,
      text: entry.text,
    })),
  };
}

export async function fieldText(
  context: TextContext,
  options: TextHelperOptions,
): Promise<TextHelperResult> {
  const baseUrl = (
    options.baseUrl ??
    process.env.TEXT_MODEL_BASE_URL ??
    "https://api.deepseek.com/v1"
  ).replace(/\/$/, "");
  const model = options.model ?? process.env.TEXT_MODEL ?? "deepseek-chat";
  const reasoning = resolveReasoning(
    options.reasoning ?? process.env.TEXT_MODEL_REASONING,
    baseUrl,
  );

  const started = Date.now();
  const result = await postJson({
    url: `${baseUrl}/chat/completions`,
    apiKey: options.apiKey,
    fetchImpl: options.fetchImpl,
    headers: sessionHeaders(baseUrl, options.sessionId),
    label: "Text helper model",
    body: {
      model,
      max_tokens: 1024,
      response_format: { type: "json_object" },
      ...reasoning,
      messages: [
        { role: "system", content: TEXT_VALUE },
        { role: "user", content: JSON.stringify(context) },
      ],
    },
  });
  const latencyMs = Date.now() - started;

  const output = readOutput(result);
  return { text: output, model, usage: readUsage(result), latencyMs };
}

function resolveReasoning(
  setting: string | undefined,
  baseUrl: string,
): Record<string, unknown> {
  const deepseek = baseUrl.includes("api.deepseek.com/");
  if (setting === "none") {
    return deepseek
      ? { thinking: { type: "disabled" } }
      : { reasoning: { enabled: false } };
  }
  // Only DeepSeek needs an explicit switch; other OpenAI-compatible providers get no extra field.
  return deepseek ? { thinking: { type: "disabled" } } : {};
}

/** OpenCode Go requires a stable session id per conversation for routing. */
export function sessionHeaders(
  baseUrl: string,
  sessionId: string | undefined,
): Record<string, string> | undefined {
  if (sessionId === undefined || !baseUrl.includes("opencode.ai")) return undefined;
  return { "x-opencode-session": sessionId };
}

function readOutput(result: unknown): string | null {
  const content = readContent(result);
  let output: unknown;
  try {
    output = JSON.parse(content);
  } catch {
    throw new Error("Text helper returned no valid field value; nothing typed.");
  }
  if (!isRecord(output) || Object.keys(output).length !== 1 || !("text" in output)) {
    throw new Error("Text helper returned no valid field value; nothing typed.");
  }
  const value = output.text;
  if (value === null) return null;
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 2000) {
    throw new Error("Text helper returned no valid field value; nothing typed.");
  }
  return value;
}

function readContent(result: unknown): string {
  if (!isRecord(result) || !Array.isArray(result.choices)) throw invalid();
  const first = result.choices[0];
  if (
    !isRecord(first) ||
    !isRecord(first.message) ||
    typeof first.message.content !== "string"
  ) {
    throw invalid();
  }
  return first.message.content;
}

function readUsage(result: unknown): Record<string, unknown> {
  if (!isRecord(result) || !isRecord(result.usage)) return {};
  return result.usage;
}

function invalid(): Error {
  return new Error("Text helper returned no valid field value; nothing typed.");
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
