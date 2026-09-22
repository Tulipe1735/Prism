#!/usr/bin/env node
import type { AgentDependencies, AgentEvent } from "../runtime/agent.ts";
import type { BrowserTaskOptions, BrowserTaskResult } from "../runtime/task.ts";

import process from "node:process";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runBrowserTask } from "../runtime/task.ts";
import { samplingText } from "../runtime/text-helper.ts";
import { VERSION } from "../shared/version.ts";

export type TaskRunner = (options: BrowserTaskOptions) => Promise<BrowserTaskResult>;

const HOST_TEXT_TIMEOUT_MS = 60_000;

const OUTPUT_SCHEMA = {
  status: z.enum(["done", "blocked", "failed"]),
  reason: z.string(),
  final_url: z.string(),
  final_title: z.string(),
  final_text: z.string(),
  steps: z.number().int().nonnegative(),
  elapsed_ms: z.number().nonnegative(),
};

/**
 * A task-level MCP surface. The host supplies a URL and a goal; Prism owns the
 * observe/decide/act loop, freshness guards, and budgets, so no model-generated
 * selector or coordinate ever reaches the browser.
 */
export function createPrismMcpServer(runTask: TaskRunner = runBrowserTask): McpServer {
  const server = new McpServer({ name: "prism", version: VERSION });

  server.registerTool(
    "browser_task",
    {
      title: "Browser task",
      description: [
        "Complete a browser task in the user's own Chrome and report the outcome.",
        "Prism opens a background tab, observes an indexed table of visible controls, and decides and executes one operation at a time.",
        "Use this when a task needs navigation, form filling, search, or reading data from a website.",
        "One call covers the whole browsing subtask; report the returned status and reason to the user.",
      ].join(" "),
      inputSchema: {
        url: z.string().url().describe("The page to start on."),
        goal: z
          .string()
          .min(1)
          .max(2_000)
          .describe("The natural-language goal for the browsing task."),
        max_steps: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Action budget for the task (default 60)."),
        record_dir: z
          .string()
          .optional()
          .describe("Optional directory for screenshots and a step journal."),
      },
      outputSchema: OUTPUT_SCHEMA,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args, extra) => {
      try {
        const result = await runTask({
          url: args.url,
          goal: args.goal,
          maxSteps: args.max_steps,
          recordDir: args.record_dir,
          signal: extra.signal,
          onEvent: progressReporter(extra),
          fieldText: hostFieldText(server, extra.signal),
        });
        return {
          content: [{ type: "text", text: summarize(result) }],
          structuredContent: {
            status: result.status,
            reason: result.reason,
            final_url: result.finalUrl,
            final_title: result.finalTitle,
            final_text: result.finalText,
            steps: result.steps,
            elapsed_ms: result.elapsedMs,
          },
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: error instanceof Error ? error.message : String(error),
            },
          ],
        };
      }
    },
  );

  return server;
}

/**
 * Answers field-text questions with the host's own model when it declares the
 * sampling capability; otherwise the task falls back to TEXT_MODEL_*.
 */
function hostFieldText(
  server: McpServer,
  signal: AbortSignal,
): AgentDependencies["fieldText"] | undefined {
  if (server.server.getClientCapabilities()?.sampling === undefined) return undefined;
  return (context) =>
    samplingText(context, (params) =>
      server.server.createMessage(params, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(HOST_TEXT_TIMEOUT_MS)]),
      }),
    );
}

function summarize(result: BrowserTaskResult): string {
  const lines = [
    `status: ${result.status}`,
    `reason: ${result.reason}`,
    `page: ${result.finalTitle} — ${result.finalUrl}`,
    `steps: ${result.steps} · ${(result.elapsedMs / 1000).toFixed(1)}s`,
  ];
  if (result.finalText.length > 0) {
    lines.push(`visible text:\n${result.finalText}`);
  }
  return lines.join("\n");
}

interface ProgressExtra {
  _meta?: { progressToken?: string | number };
  sendNotification: (notification: {
    method: "notifications/progress";
    params: { progressToken: string | number; progress: number; message?: string };
  }) => Promise<void>;
}

function progressReporter(
  extra: ProgressExtra,
): ((event: AgentEvent) => void) | undefined {
  const token = extra._meta?.progressToken;
  if (token === undefined) return undefined;
  let progress = 0;
  return (event) => {
    if (event.type !== "acted" && event.type !== "finished") return;
    progress += 1;
    void extra
      .sendNotification({
        method: "notifications/progress",
        params: {
          progressToken: token,
          progress,
          message:
            event.type === "acted"
              ? `step ${event.step}: ${event.kind} ${event.label}`
              : `status ${event.status}: ${event.reason}`,
        },
      })
      .catch(() => {});
  };
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  const server = createPrismMcpServer();
  server.connect(new StdioServerTransport()).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
