#!/usr/bin/env node
import type { Command } from "../cli/protocol.ts";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs as parseNodeArgs } from "node:util";
import { commandSchema, ContractError, failure, success } from "../cli/protocol.ts";
import { readReceipt } from "../cli/receipts.ts";
import { prepareDirectory, sendCommand, stateDirectory } from "../cli/transport.ts";
import { VERSION } from "../shared/version.ts";

const HELP = `Prism ${VERSION} — browser CLI for an external agent

Commands:
  session open --url <url> [--browser-url http://127.0.0.1:9222]
  observe --session <s> [--scope local|structural|relations]
  context --session <s> --observation <o> --target <ref> --scope <scope>
  act --session <s> --observation <o> --target <ref> --evidence <v>
      --operation click|fill|select|scroll|wait --request-id <unique-id> [--value <text>]
  receipt --session <s> --request-id <id>
  session close --session <s>
  daemon stop

Use prism <command> --help for examples.
Responses: one JSON object on stdout; diagnostics on stderr. --json is optional.
Global: --state-dir <private-directory>, --help, --version.
Environment: PRISM_STATE_DIR, PRISM_BROWSER_URL. No model key is needed.
Exit: 0 = accepted/query succeeded; 1 = refused or outcome unknown; 2 = invalid arguments.
Executed means input acknowledged, not task success. No automatic action retry.
The broker owns its tabs and closes them after 15 minutes without a request.
`;
const COMMAND_HELP: Record<string, string> = {
  "session open":
    "prism session open --url https://example.com --browser-url http://127.0.0.1:9222\nReturns a session and private event-log path; creates its own browser tab.",
  "session close":
    "prism session close --session <session>\nCloses only the tab owned by this session. Receipts remain queryable.",
  observe:
    "prism observe --session <session> --scope relations\nReturns observation, evidence and target refs. A new observation expires old refs.",
  context:
    "prism context --session <session> --observation <observation> --target <ref> --scope structural\nReturns a target-specific evidence id; all fields come from visible page state.",
  act: "prism act --session <s> --observation <o> --target <ref> --evidence <v> --operation fill --value 'example' --request-id <new-id>\nOr: prism act --stdin < action.json\nstdin requires the full act command object, including command=act and request_id.\nCopy refs and evidence ids from observe/context. Reusing the same request returns its receipt.\nChanged evidence refuses input. Unknown input outcomes require page inspection.",
  receipt:
    "prism receipt --session <session> --request-id <id>\nReads the durable receipt without requiring the broker to be running.",
  "daemon stop":
    "prism daemon stop\nWaits for pending commands, then closes the broker's owned tabs.",
};
const FLAGS = {
  "state-dir": { type: "string" },
  "browser-url": { type: "string" },
  url: { type: "string" },
  session: { type: "string" },
  observation: { type: "string" },
  target: { type: "string" },
  evidence: { type: "string" },
  scope: { type: "string" },
  operation: { type: "string" },
  value: { type: "string" },
  "request-id": { type: "string" },
  stdin: { type: "boolean" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const;
export interface CliOptions {
  directory: string;
  command?: Command;
  stdin?: boolean;
  help?: string;
  version?: boolean;
}

export function parseArgs(argv: string[]): CliOptions {
  try {
    const { values, positionals, tokens } = parseNodeArgs({
      args: argv,
      options: FLAGS,
      strict: true,
      allowPositionals: true,
      tokens: true,
    });
    const directory = stateDirectory(values["state-dir"]);
    const name = positionals.join(" ");
    if (values.version) return { directory, version: true };
    if (values.help || argv.length === 0)
      return { directory, help: COMMAND_HELP[name] ?? HELP };
    if (!Object.hasOwn(COMMAND_HELP, name))
      throw new Error("Unknown command. Run prism --help.");
    const allowed: Record<string, string[]> = {
      "session open": ["url", "browser-url"],
      "session close": ["session"],
      observe: ["session", "scope"],
      context: ["session", "observation", "target", "scope"],
      act: [
        "session",
        "observation",
        "target",
        "evidence",
        "operation",
        "value",
        "request-id",
        "stdin",
      ],
      receipt: ["session", "request-id"],
      "daemon stop": [],
    };
    const seen = new Set<string>();
    for (const token of tokens) {
      if (token.kind !== "option") continue;
      if (seen.has(token.name)) throw new Error(`Duplicate option --${token.name}.`);
      seen.add(token.name);
      if (!["state-dir", "json", ...allowed[name]!].includes(token.name))
        throw new Error(`Option --${token.name} is not valid for ${name}.`);
    }
    if (values.stdin) {
      if ([...seen].some((flag) => !["stdin", "state-dir", "json"].includes(flag)))
        throw new Error("--stdin cannot be mixed with action flags.");
      return { directory, stdin: true };
    }
    const fields = Object.fromEntries(
      allowed[name]!.flatMap((flag) =>
        values[flag as keyof typeof FLAGS] === undefined
          ? []
          : [[flag.replaceAll("-", "_"), values[flag as keyof typeof FLAGS]]],
      ),
    );
    const command =
      name === "session open"
        ? {
            command: "open",
            ...fields,
            browser_url:
              values["browser-url"] ??
              process.env.PRISM_BROWSER_URL ??
              "http://127.0.0.1:9222",
          }
        : {
            command:
              name === "session close"
                ? "close"
                : name === "daemon stop"
                  ? "shutdown"
                  : name,
            ...fields,
          };
    return { directory, command: commandSchema.parse(command) };
  } catch (error) {
    throw new ContractError(
      "INVALID_ARGUMENTS",
      error instanceof Error ? error.message : "Invalid arguments.",
    );
  }
}

async function ensureBroker(directory: string): Promise<void> {
  try {
    await sendCommand(directory, { command: "ping" });
    return;
  } catch (error) {
    if (!(error instanceof ContractError) || !/ENOENT|ECONNREFUSED/.test(error.message))
      throw error;
  }
  await prepareDirectory(directory);
  const source = import.meta.url.endsWith(".ts");
  const daemon = new URL(source ? "./daemon.ts" : "./daemon.js", import.meta.url);
  const logPath = join(directory, "broker.log");
  const log = await open(logPath, "a", 0o600);
  try {
    const child = spawn(
      process.execPath,
      [
        ...(source
          ? ["--experimental-strip-types", "--disable-warning=ExperimentalWarning"]
          : []),
        fileURLToPath(daemon),
        directory,
      ],
      {
        detached: true,
        stdio: ["ignore", log.fd, log.fd],
        env: process.env,
      },
    );
    child.on("error", (error) => console.error(`Prism broker: ${error.message}`));
    child.unref();
  } finally {
    await log.close();
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    try {
      await sendCommand(directory, { command: "ping" });
      return;
    } catch (error) {
      if (
        !(error instanceof ContractError) ||
        !/ENOENT|ECONNREFUSED/.test(error.message)
      )
        throw error;
    }
  }
  throw new ContractError(
    "BROKER_START_FAILED",
    `Broker did not start. Inspect ${logPath}.`,
  );
}

async function readStdin(): Promise<Command> {
  let body = "";
  for await (const chunk of process.stdin) {
    body += chunk.toString();
    if (Buffer.byteLength(body) > 64_000)
      throw new ContractError("INVALID_ARGUMENTS", "stdin command exceeds 64 KB.");
  }
  try {
    const command = commandSchema.parse(JSON.parse(body));
    if (command.command !== "act")
      throw new Error("stdin only accepts an act command.");
    return command;
  } catch (error) {
    throw new ContractError(
      "INVALID_ARGUMENTS",
      error instanceof Error ? error.message : "Invalid stdin.",
    );
  }
}
export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      process.stdout.write(`${options.help}\n`);
      return 0;
    }
    if (options.version) {
      process.stdout.write(`${VERSION}\n`);
      return 0;
    }
    const command = options.stdin ? await readStdin() : options.command!;
    let reply;
    if (command.command === "receipt") {
      const receipt = await readReceipt(
        options.directory,
        command.session,
        command.request_id,
      );
      if (!receipt)
        throw new ContractError(
          "RECEIPT_NOT_FOUND",
          "No durable receipt exists. This does not prove the action was never requested.",
        );
      reply = success({ receipt });
    } else {
      if (command.command === "open") await ensureBroker(options.directory);
      reply = await sendCommand(options.directory, command);
    }
    process.stdout.write(`${JSON.stringify(reply)}\n`);
    return reply.ok ? 0 : 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify(failure(error))}\n`);
    return error instanceof ContractError && error.code === "INVALID_ARGUMENTS" ? 2 : 1;
  }
}
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(realpathSync(entry)).href)
  void main().then((code) => {
    process.exitCode = code;
  });
