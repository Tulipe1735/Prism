import type { AgentEvent, AgentResult, ConfirmContext } from "./agent.ts";

import type { BrowserSession } from "./browser/session.ts";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { runAgent } from "./agent.ts";
import { connectBrowser, parseBrowserUrl } from "./browser/connect.ts";
import { openBrowserSession } from "./browser/session.ts";
import { choose } from "./decision.ts";
import { ConfigError } from "./errors.ts";
import { judgeOutcome } from "./judge.ts";
import { fieldText } from "./text-helper.ts";

export interface BrowserTaskOptions {
  url: string;
  goal: string;
  maxSteps?: number;
  recordDir?: string;
  judgeVision?: boolean;
  browserUrl?: string;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
  confirmDecision?: (context: ConfirmContext) => Promise<boolean>;
}

export interface BrowserTaskResult {
  status: AgentResult["status"];
  reason: string;
  finalUrl: string;
  finalTitle: string;
  finalText: string;
  verdict: AgentResult["verdict"];
  steps: number;
  elapsedMs: number;
}

/**
 * One complete browser task: connect to Chrome, open a background tab, run the
 * observe/decide/act/judge loop, and close the tab. This is the integration
 * surface for the CLI, the MCP server, and any host that embeds Prism.
 */
export async function runBrowserTask(
  options: BrowserTaskOptions,
): Promise<BrowserTaskResult> {
  loadDotEnv();
  const typesafeKey = env("TYPESAFE_API_KEY");
  if (typesafeKey === undefined) {
    throw new ConfigError("TYPESAFE_API_KEY is required for task decisions.");
  }
  const textKey = env("TEXT_MODEL_API_KEY");
  const judgeKey = env("PRISM_JUDGE_API_KEY") ?? textKey;
  const judgeVision = options.judgeVision ?? isEnabled(process.env.PRISM_JUDGE_VISION);

  // One session id per run so OpenCode Go can route and cache consistently.
  const sessionId = randomUUID();
  const connection = await connectBrowser(
    options.browserUrl === undefined ? {} : parseBrowserUrl(options.browserUrl),
  );
  let session: BrowserSession | undefined;
  try {
    session = await openBrowserSession({ url: options.url, client: connection.client });
    const result = await runAgent({
      session,
      goal: options.goal,
      maxSteps: options.maxSteps,
      judgeVision,
      recordDir: options.recordDir,
      signal: options.signal,
      onEvent: options.onEvent,
      confirmDecision: options.confirmDecision,
      dependencies: {
        choose: ({ snapshot, goal, history }) =>
          choose({ snapshot, goal, history, apiKey: typesafeKey }),
        fieldText: (context) => {
          if (textKey === undefined) {
            throw new ConfigError(
              "TEXT_MODEL_API_KEY is required to type into a field.",
            );
          }
          return fieldText(context, { apiKey: textKey, sessionId });
        },
        judge: (input) => {
          if (judgeKey === undefined) {
            throw new ConfigError(
              "PRISM_JUDGE_API_KEY or TEXT_MODEL_API_KEY is required to verify the goal.",
            );
          }
          return judgeOutcome({
            ...input,
            apiKey: judgeKey,
            vision: judgeVision,
            sessionId,
          });
        },
      },
    });

    return {
      status: result.status,
      reason: result.reason,
      finalUrl: result.finalUrl,
      finalTitle: result.finalTitle,
      finalText: result.finalText,
      verdict: result.verdict,
      steps: result.steps.length,
      elapsedMs: result.elapsedMs,
    };
  } finally {
    await session?.close();
    await connection.close();
  }
}

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function isEnabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function loadDotEnv(): void {
  try {
    process.loadEnvFile(".env");
  } catch {
    // A .env file is optional.
  }
}
