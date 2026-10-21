import type { Buffer } from "node:buffer";
import type { ChildProcess } from "node:child_process";
import process from "node:process";
import { OutputBuffer } from "./tool-support.ts";

/** Facts and merged output of one finished command. */
export interface ShellOutcome {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  timedOut: boolean;
  cancelled: boolean;
  spawnError?: string;
  output: OutputBuffer;
}

/** One started process: how to read its streams and how to end its tree. */
export interface ProcessSpec {
  start: () => ChildProcess;
  onData: (stream: "stdout" | "stderr", chunk: Buffer) => void;
  /** Flushes whatever the readers buffered; runs once, after the process ends. */
  onEnd: () => void;
  /** Ends the whole process tree; the runner may call it twice. */
  stop: (child: ChildProcess) => void;
}

/**
 * Runs one process and settles when it is gone. Timeout and task cancellation
 * end the whole process tree, not just the shell; each execution target says
 * how, because ending a Windows process works differently.
 */
export function runProcess(
  build: (output: OutputBuffer) => ProcessSpec,
  options: { timeoutMs: number; signal: AbortSignal },
): Promise<ShellOutcome> {
  if (options.signal.aborted)
    return Promise.resolve({ ...emptyOutcome(), cancelled: true });
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const output = new OutputBuffer();
    const spec = build(output);
    const child = spec.start();
    let timedOut = false;
    let cancelled = false;
    let spawnError: string | undefined;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      spec.stop(child);
    }, options.timeoutMs);
    const onAbort = (): void => {
      cancelled = true;
      spec.stop(child);
    };
    options.signal.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (chunk: Buffer) => spec.onData("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => spec.onData("stderr", chunk));
    child.on("error", (error) => {
      spawnError = `Could not start the command: ${error.message}`;
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal.removeEventListener("abort", onAbort);
      spec.onEnd();
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

/** An outcome for a command that never ran, with an empty output buffer. */
export function emptyOutcome(spawnError?: string): ShellOutcome {
  return {
    exitCode: null,
    signal: null,
    durationMs: 0,
    timedOut: false,
    cancelled: false,
    ...(spawnError === undefined ? {} : { spawnError }),
    output: new OutputBuffer(),
  };
}

/** Kills a whole process group; the process must be its group leader. */
export function killProcessGroup(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    // The process group already exited.
  }
}
