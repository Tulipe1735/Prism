import type { ShellOutcome } from "./shell.ts";
import type { Tool, ToolResult } from "./tool.ts";
import { spawn } from "node:child_process";
import process from "node:process";
import { StringDecoder } from "node:string_decoder";
import { killProcessGroup, runProcess } from "./shell.ts";
import {
  missingArgument,
  readNumber,
  readString,
  resolveToolPath,
} from "./tool-support.ts";
import { runWindowsCommand } from "./windows-command.ts";

/** How long one command may run before the kernel kills it. */
export interface CommandToolOptions {
  timeoutMs: number;
}

/** Uses the host shell, with Windows interop available to the WSL kernel. */
export function createCommandTool(options: CommandToolOptions): Tool {
  return {
    name: "run_command",
    description:
      "Runs a shell command and returns merged output, the exit code and the duration. Defaults to the kernel environment: cmd.exe on Windows, /bin/sh in WSL. A WSL kernel can also run Windows commands through interop. The command runs in the workspace unless cwd says otherwise.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to run." },
        environment: {
          type: "string",
          enum: ["wsl", "windows"],
          description:
            "Execution target; defaults to the kernel environment. To use a WSL workspace from Windows, start the workbench in WSL mode.",
        },
        cwd: {
          type: "string",
          description:
            "Working directory inside the workspace; defaults to the workspace root.",
        },
        timeoutMs: {
          type: "number",
          description:
            "Wall-clock limit in milliseconds; defaults to the configured limit.",
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
    effects: (args) => [
      { kind: "command", command: readString(args, "command") ?? "" },
    ],
    execute: async (args, context) => {
      const command = readString(args, "command");
      if (command === undefined || command.trim() === "")
        return missingArgument("command");

      const environment = readString(args, "environment") ?? context.target;
      if (environment !== "wsl" && environment !== "windows")
        return {
          content: `Unknown environment "${environment}"; valid values are "wsl" and "windows".`,
          isError: true,
        };
      if (environment === "wsl" && process.platform === "win32")
        return {
          content:
            "This kernel runs natively on Windows. Select WSL in the workbench's runtime menu to run tasks in a WSL workspace.",
          isError: true,
        };

      const cwd = readString(args, "cwd") ?? ".";
      const target = resolveToolPath(context, cwd);

      const requestedTimeout = readNumber(args, "timeoutMs");
      if (
        requestedTimeout !== undefined &&
        (!Number.isInteger(requestedTimeout) || requestedTimeout <= 0)
      )
        return {
          content: 'The "timeoutMs" argument must be a positive integer.',
          isError: true,
        };
      const timeoutMs = requestedTimeout ?? options.timeoutMs;

      const run = {
        cwd: target.path,
        timeoutMs,
        signal: context.signal,
      };
      const outcome =
        environment === "windows"
          ? await runWindowsCommand({ command, ...run })
          : await runWslCommand(command, run);
      return commandResult(outcome, timeoutMs);
    },
  };
}

/** Runs a command in the shell of the kernel's own side (WSL). */
function runWslCommand(
  command: string,
  options: { cwd: string; timeoutMs: number; signal: AbortSignal },
): Promise<ShellOutcome> {
  return runProcess((output) => {
    const stdout = new StringDecoder("utf8");
    const stderr = new StringDecoder("utf8");
    const decoders = { stdout, stderr };
    return {
      start: () =>
        spawn(command, {
          cwd: options.cwd,
          shell: true,
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
        }),
      onData: (stream, chunk) => output.append(decoders[stream].write(chunk)),
      onEnd: () => {
        output.append(stdout.end());
        output.append(stderr.end());
      },
      stop: killProcessGroup,
    };
  }, options);
}

/** Formats the outcome for the model: facts first, then the merged output. */
function commandResult(outcome: ShellOutcome, timeoutMs: number): ToolResult {
  const lines = [
    `exit code: ${outcome.exitCode === null ? "none" : outcome.exitCode}`,
    `duration: ${outcome.durationMs}ms`,
  ];
  if (outcome.spawnError !== undefined) lines.push(outcome.spawnError);
  if (outcome.timedOut) lines.push(`timed out after ${timeoutMs}ms`);
  if (outcome.cancelled) lines.push("cancelled by the user");
  const output = outcome.output.render();
  return {
    content: `${lines.join("\n")}\n\n${output === "" ? "(no output)" : output}`,
    isError:
      outcome.spawnError !== undefined ||
      outcome.timedOut ||
      outcome.cancelled ||
      outcome.exitCode !== 0,
  };
}
