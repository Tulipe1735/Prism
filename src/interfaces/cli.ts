#!/usr/bin/env node
import type { AgentEvent } from "../runtime/agent.ts";
import process from "node:process";
import { createInterface } from "node:readline/promises";

import { pathToFileURL } from "node:url";
import { runBrowserTask } from "../runtime/task.ts";
import { ConfigError } from "../shared/errors.ts";
import { VERSION } from "../shared/version.ts";

const HELP = `prism ${VERSION} — a browser-use CLI agent

Usage:
  prism <url> "<goal>" [options]

Options:
  --max-steps <n>       Action budget (default 60)
  --step                Pause before each action and confirm with Enter
  --record <dir>        Write screenshots, steps.jsonl, and final.json
  --json                Emit one JSON event per line
  --browser-url <url>   Chrome DevTools endpoint (default http://127.0.0.1:9222)
  -h, --help            Show this help
  -v, --version         Show the version

Environment:
  TYPESAFE_API_KEY      TypeSafe decision model key (required)
  TYPESAFE_MODEL        TypeSafe model id (default jev-latest)
  TEXT_MODEL_API_KEY    OpenAI-compatible key for field text
  TEXT_MODEL_BASE_URL   Field-text endpoint (default https://api.deepseek.com/v1)
  TEXT_MODEL            Field-text model (default deepseek-chat)
  TEXT_MODEL_REASONING  "none" to disable reasoning parameters

Exit codes:
  0  the decision model reported DONE
  1  blocked, failed, or interrupted
  2  configuration or browser connection error
`;

export interface CliOptions {
  url?: string;
  goal?: string;
  maxSteps: number;
  step: boolean;
  record?: string;
  json: boolean;
  browserUrl?: string;
  help: boolean;
  version: boolean;
}

const VALUE_FLAGS = new Set(["--max-steps", "--record", "--browser-url"]);

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    maxSteps: 60,
    step: false,
    json: false,
    help: false,
    version: false,
  };
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--version" || arg === "-v") {
      options.version = true;
      continue;
    }
    if (arg === "--step") {
      options.step = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }

    const separator = arg.indexOf("=");
    const flag = separator === -1 ? arg : arg.slice(0, separator);
    if (VALUE_FLAGS.has(flag)) {
      const raw = separator === -1 ? argv[++index] : arg.slice(separator + 1);
      if (raw === undefined || raw.length === 0)
        throw new ConfigError(`Missing value for ${flag}.`);
      if (flag === "--max-steps") {
        const value = Number(raw);
        if (!Number.isInteger(value) || value < 1) {
          throw new ConfigError("--max-steps must be a positive integer.");
        }
        options.maxSteps = value;
      } else if (flag === "--record") {
        options.record = raw;
      } else {
        options.browserUrl = raw;
      }
      continue;
    }

    if (arg.startsWith("-"))
      throw new ConfigError(`Unknown option ${arg}. Run prism --help.`);
    positional.push(arg);
  }

  if (positional.length > 0) options.url = positional[0];
  if (positional.length > 1) options.goal = positional.slice(1).join(" ");
  return options;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(HELP);
    return 0;
  }
  if (options.version) {
    console.log(VERSION);
    return 0;
  }
  if (options.url === undefined || options.goal === undefined) {
    throw new ConfigError(
      'Usage: prism <url> "<goal>" [options]. Run prism --help for details.',
    );
  }

  const controller = new AbortController();
  const onSigint = (): void => controller.abort();
  process.once("SIGINT", onSigint);

  let prompt: ReturnType<typeof createInterface> | undefined;
  try {
    const report = createReporter(options.json);
    if (options.step)
      prompt = createInterface({ input: process.stdin, output: process.stderr });

    const result = await runBrowserTask({
      url: options.url,
      goal: options.goal,
      maxSteps: options.maxSteps,
      recordDir: options.record,
      browserUrl: options.browserUrl,
      signal: controller.signal,
      onEvent: report,
      confirmDecision:
        prompt === undefined
          ? undefined
          : async ({ step, decision, action }): Promise<boolean> => {
              const label = action === null ? decision.operation : `"${action.label}"`;
              const answer = await prompt!.question(
                `Step ${step}: ${decision.operation} ${label} — Enter to run, q to abort: `,
              );
              return answer.trim().toLowerCase() !== "q";
            },
    });

    if (options.json) {
      process.stdout.write(
        `${JSON.stringify({
          type: "result",
          status: result.status,
          reason: result.reason,
          steps: result.steps,
          elapsedMs: result.elapsedMs,
        })}\n`,
      );
    }
    return result.status === "done" ? 0 : 1;
  } finally {
    prompt?.close();
    process.removeListener("SIGINT", onSigint);
  }
}

function createReporter(json: boolean): (event: AgentEvent) => void {
  if (json) return (event) => process.stdout.write(`${JSON.stringify(event)}\n`);

  return (event) => {
    switch (event.type) {
      case "started":
        console.log(`Prism ${VERSION} — ${event.title}`);
        console.log(`  ${event.url} (${event.controls} controls)`);
        break;
      case "decided": {
        const target = event.label === null ? "" : ` ${event.label}`;
        console.log(
          `#${event.step} ${event.operation}${target} p=${event.probability.toFixed(2)} (${event.latencyMs}ms)`,
        );
        break;
      }
      case "acted": {
        const typed =
          event.text === null ? "" : ` — typed ${JSON.stringify(event.text)}`;
        console.log(
          `   ${event.kind}${typed} · page_changed=${event.pageChanged} · ${formatDuration(event.elapsedMs)}`,
        );
        break;
      }
      case "finished":
        console.log(`${event.status.toUpperCase()}: ${event.reason}`);
        break;
    }
  };
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = error instanceof ConfigError ? 2 : 1;
    });
}
