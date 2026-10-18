import type { Buffer } from "node:buffer";
import type { Tool, ToolResult } from "./tool.ts";
import { spawn } from "node:child_process";
import process from "node:process";
import { StringDecoder } from "node:string_decoder";
import {
  gatePath,
  isRefusal,
  missingArgument,
  OutputBuffer,
  readNumber,
  readString,
} from "./tool-support.ts";

/** How long one command may run before the kernel kills it. */
export interface CommandToolOptions {
  timeoutMs: number;
}

/** Runs shell commands in the WSL environment (05 adds the Windows target). */
export function createCommandTool(options: CommandToolOptions): Tool {
  return {
    name: "run_command",
    description:
      "Runs a shell command and returns merged output, the exit code and the duration. The command runs in the workspace unless cwd says otherwise.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to run." },
        environment: {
          type: "string",
          enum: ["wsl", "windows"],
          description: 'Execution target; defaults to "wsl".',
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
    execute: async (args, context) => {
      const command = readString(args, "command");
      if (command === undefined || command.trim() === "")
        return missingArgument("command");

      const environment = readString(args, "environment") ?? context.target;
      if (environment === "windows")
        return {
          content: 'The "windows" environment is not available yet; use "wsl".',
          isError: true,
        };
      if (environment !== "wsl")
        return {
          content: `Unknown environment "${environment}"; valid values are "wsl" and "windows".`,
          isError: true,
        };

      const cwd = readString(args, "cwd") ?? ".";
      const gate = await gatePath(context, cwd, {
        reason: "Runs a command outside the workspace",
        impact:
          "The command runs with a working directory the workspace does not cover.",
      });
      if (isRefusal(gate)) return gate;

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

      const outcome = await runShell(command, {
        cwd: gate.path,
        timeoutMs,
        signal: context.signal,
      });
      return commandResult(outcome, timeoutMs);
    },
  };
}

interface ShellOutcome {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  timedOut: boolean;
  cancelled: boolean;
  spawnError?: string;
  output: OutputBuffer;
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

/**
 * Runs one command through a shell and settles when the process group is gone.
 * Timeout and task cancellation kill the whole group, not just the shell.
 */
function runShell(
  command: string,
  options: { cwd: string; timeoutMs: number; signal: AbortSignal },
): Promise<ShellOutcome> {
  const output = new OutputBuffer();
  const startedAt = Date.now();
  if (options.signal.aborted)
    return Promise.resolve({
      exitCode: null,
      signal: null,
      durationMs: 0,
      timedOut: false,
      cancelled: true,
      output,
    });

  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: options.cwd,
      shell: true,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = new StringDecoder("utf8");
    const stderr = new StringDecoder("utf8");
    let timedOut = false;
    let cancelled = false;
    let spawnError: string | undefined;
    let settled = false;

    const killGroup = (): void => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // The process group already exited.
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, options.timeoutMs);
    const onAbort = (): void => {
      cancelled = true;
      killGroup();
    };
    options.signal.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (chunk: Buffer) => output.append(stdout.write(chunk)));
    child.stderr?.on("data", (chunk: Buffer) => output.append(stderr.write(chunk)));
    child.on("error", (error) => {
      spawnError = `Could not start the command: ${error.message}`;
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal.removeEventListener("abort", onAbort);
      output.append(stdout.end());
      output.append(stderr.end());
      resolve({
        exitCode: code,
        signal,
        durationMs: Date.now() - startedAt,
        timedOut,
        cancelled,
        ...(spawnError === undefined ? {} : { spawnError }),
        output,
      });
    });
  });
}
