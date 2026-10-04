import type { Snapshot } from "../../src/shared/types.ts";
import type { ArmPayload } from "./input.ts";
import process from "node:process";
import { parseDecisionResponse } from "../../src/runtime/decision.ts";
import { sessionHeaders } from "../../src/runtime/text-helper.ts";
import { postJson } from "../../src/shared/http.ts";
import { digest, SYSTEM_PROMPT } from "../runners/model.ts";

export interface DecisionPlan {
  model: string;
  baseUrl: string;
  apiKeyEnv: string;
  temperature: number;
  topP: number;
  maxTokens: number;
  httpRetries: number;
  timeoutMs: number;
}
interface Receipt {
  httpCalls: number;
  httpRetries: number;
  model: string | null;
  usage: Record<string, unknown>;
  requestBody: unknown;
  rawContent: string | null;
  promptHash: string;
}
export interface ArmDecision extends Receipt {
  operation: string;
  target: string | null;
  text: string | null;
  confidence: number;
  operationProbabilities: Record<string, number>;
  targetProbabilities: Record<string, number>;
}
export interface DecisionFailure extends Receipt {
  kind: "provider" | "output";
  message: string;
}

export function armMessages(payload: ArmPayload): { role: string; content: string }[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify(payload) },
  ];
}
export function armRequestBody(cohort: DecisionPlan, payload: ArmPayload): unknown {
  return {
    model: cohort.model,
    temperature: cohort.temperature,
    top_p: cohort.topP,
    max_tokens: cohort.maxTokens,
    response_format: { type: "json_object" },
    messages: armMessages(payload),
  };
}

/** Use the historical parser, including choice/argmax and confidence checks. */
export async function armDecision(options: {
  cohort: DecisionPlan;
  apiKey: string;
  payload: ArmPayload;
  snapshot: Snapshot;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
  beforeAttempt?: () => void;
}): Promise<ArmDecision | DecisionFailure> {
  const { cohort, payload } = options;
  const requestBody = armRequestBody(cohort, payload);
  const promptHash = digest(JSON.stringify(armMessages(payload)));
  const receipt: Receipt = {
    httpCalls: 0,
    httpRetries: 0,
    model: null,
    usage: {},
    requestBody,
    rawContent: null,
    promptHash,
  };
  let response: any;
  try {
    response = await postJson({
      url: `${cohort.baseUrl.replace(/\/$/, "")}/chat/completions`,
      apiKey: options.apiKey,
      body: requestBody,
      headers: sessionHeaders(cohort.baseUrl, promptHash),
      signal: options.signal,
      maxAttempts: cohort.httpRetries + 1,
      timeoutMs: Math.min(120000, cohort.timeoutMs),
      label: "Relation ablation decision model",
      fetchImpl: async (url, init) => {
        options.beforeAttempt?.();
        if (receipt.httpCalls > 0) receipt.httpRetries += 1;
        receipt.httpCalls += 1;
        return (options.fetchImpl ?? fetch)(url, init);
      },
    });
  } catch (error) {
    return {
      ...receipt,
      kind: "provider",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  receipt.model = typeof response?.model === "string" ? response.model : null;
  receipt.usage = response?.usage ?? {};
  const content = response?.choices?.[0]?.message?.content;
  receipt.rawContent = typeof content === "string" ? content : null;
  if (receipt.rawContent === null)
    return {
      ...receipt,
      kind: "output",
      message: "Missing model content; no action executed.",
    };
  try {
    const output = JSON.parse(receipt.rawContent);
    const operation = output?.operation?.choice;
    const decision = parseDecisionResponse(
      {
        model: receipt.model,
        usage: receipt.usage,
        answers: {
          operation: output?.operation,
          [`${String(operation).toLowerCase()}_target`]: output?.target,
        },
      },
      { snapshot: options.snapshot, latencyMs: 0, request: requestBody },
    );
    if (decision.operation === "TYPE_TEXT" && typeof output.text !== "string")
      throw new Error("TYPE_TEXT requires text; no action executed.");
    return {
      ...receipt,
      operation: decision.operation,
      target: decision.target,
      text: typeof output.text === "string" ? output.text : null,
      confidence: decision.confidence,
      operationProbabilities: decision.operationProbabilities,
      targetProbabilities: decision.targetProbabilities,
    };
  } catch (error) {
    return {
      ...receipt,
      kind: "output",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
export function isFailure(
  value: ArmDecision | DecisionFailure,
): value is DecisionFailure {
  return "kind" in value;
}
export function apiKey(cohort: DecisionPlan): string {
  const value = process.env[cohort.apiKeyEnv]?.trim();
  if (!value) throw new Error(`Missing ${cohort.apiKeyEnv}; no run started.`);
  return value;
}
