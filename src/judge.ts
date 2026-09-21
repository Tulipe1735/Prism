import type { HistoryEntry, Snapshot } from "./types.ts";
import process from "node:process";
import { postJson } from "./http.ts";
import { JUDGE } from "./prompts.ts";
import { sessionHeaders } from "./text-helper.ts";

export interface JudgeOptions {
  goal: string;
  snapshot: Snapshot;
  history: HistoryEntry[];
  apiKey: string;
  baseUrl?: string;
  model?: string;
  vision?: boolean;
  screenshotBase64?: string;
  sessionId?: string;
  fetchImpl?: typeof fetch;
}

export interface JudgeVerdict {
  satisfied: boolean;
  reason: string;
  model: string;
}

export async function judgeOutcome(options: JudgeOptions): Promise<JudgeVerdict> {
  const baseUrl = (
    options.baseUrl ??
    process.env.PRISM_JUDGE_BASE_URL ??
    process.env.TEXT_MODEL_BASE_URL ??
    "https://api.deepseek.com/v1"
  ).replace(/\/$/, "");
  const model =
    options.model ??
    process.env.PRISM_JUDGE_MODEL ??
    process.env.TEXT_MODEL ??
    "deepseek-chat";

  const evidence = {
    goal: options.goal,
    final_page: {
      url: options.snapshot.url,
      title: options.snapshot.title,
      text: options.snapshot.text.slice(0, 8000),
    },
    recent_actions: options.history.slice(-12).map((entry) => ({
      kind: entry.kind,
      action: entry.action,
      text: entry.text,
      page_changed: entry.page_changed,
    })),
  };

  const content: unknown =
    options.vision === true && options.screenshotBase64 !== undefined
      ? [
          { type: "text", text: JSON.stringify(evidence) },
          {
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${options.screenshotBase64}` },
          },
        ]
      : JSON.stringify(evidence);

  const result = await postJson({
    url: `${baseUrl}/chat/completions`,
    apiKey: options.apiKey,
    fetchImpl: options.fetchImpl,
    headers: sessionHeaders(baseUrl, options.sessionId),
    label: "Judge model",
    body: {
      model,
      max_tokens: 512,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: JUDGE },
        { role: "user", content },
      ],
    },
  });

  const verdict = readVerdict(result);
  return { ...verdict, model };
}

function readVerdict(result: unknown): { satisfied: boolean; reason: string } {
  if (!isRecord(result) || !Array.isArray(result.choices)) throw invalid();
  const first = result.choices[0];
  if (
    !isRecord(first) ||
    !isRecord(first.message) ||
    typeof first.message.content !== "string"
  ) {
    throw invalid();
  }
  let output: unknown;
  try {
    output = JSON.parse(first.message.content);
  } catch {
    throw invalid();
  }
  if (
    !isRecord(output) ||
    typeof output.satisfied !== "boolean" ||
    typeof output.reason !== "string"
  ) {
    throw invalid();
  }
  return { satisfied: output.satisfied, reason: output.reason.slice(0, 500) };
}

function invalid(): Error {
  return new Error("Judge model returned no valid verdict.");
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
