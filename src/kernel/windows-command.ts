import type { ShellOutcome } from "./shell.ts";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import process from "node:process";
import { TOOL_RESULT_LIMIT } from "./loop.ts";
import { emptyOutcome, killProcessGroup, runProcess } from "./shell.ts";

/** Console code pages a piped cmd.exe writes its output with. */
const CODE_PAGE_ENCODINGS: Record<number, string> = {
  65001: "utf-8",
  932: "shift_jis",
  936: "gbk",
  949: "euc-kr",
  950: "big5",
  866: "ibm866",
  1251: "windows-1251",
  1252: "windows-1252",
};

/** Chinese Windows, the machine this kernel targets, writes GBK. */
const FALLBACK_ENCODING = "gbk";

/** How long a helper (probe, path conversion, kill) may take. */
const HELPER_TIMEOUT_MS = 10_000;
/** A Windows process tree has to die before the task can move on. */
const KILL_TIMEOUT_MS = 15_000;

/** Raw output kept per stream, before the result limit cuts it to size. */
const RAW_LIMIT = TOOL_RESULT_LIMIT * 4;

/**
 * Command the Windows side runs. The command text travels in an environment
 * variable, because WSL interop escapes quotes in arguments: `cmd /c "git log
 * --oneline"` would reach cmd.exe with backslashes in front of the quotes.
 */
const COMMAND_VARIABLE = "PRISM_WINDOWS_COMMAND";

/** Reads the console code page plus a directory Windows commands can start in. */
const PROBE = "chcp & echo prism-temp:%TEMP%";

/** What the kernel needs to run Windows commands through WSL interop. */
export interface WindowsInterop {
  /** Program that runs Windows commands. */
  command: string;
  /** Linux directory the program starts in, so cmd.exe never starts in a UNC path. */
  spawnDir: string;
  /** Encoding for output that is not UTF-8, taken from the console code page. */
  encoding: string;
}

export type WindowsInteropStatus =
  { available: true; interop: WindowsInterop } | { available: false; reason: string };

/**
 * Checks that Windows commands can run (ADR-0002). The check runs on every
 * call: interop can be switched off between commands, and the answer has to be
 * an explicit error, never a silent fallback.
 */
export async function windowsInteropStatus(): Promise<WindowsInteropStatus> {
  const probe = await capture("cmd.exe", ["/d", "/s", "/c", PROBE], tmpdir());
  if (probe.error !== undefined)
    return {
      available: false,
      reason:
        `The Windows environment needs WSL interop, but cmd.exe did not start: ${probe.error}. ` +
        "Check that interop is enabled in /etc/wsl.conf and that the Windows directories are on PATH.",
    };

  const text = probe.out.toString("latin1");
  const spawnDir = (await convert("-u", markedLine(text, "prism-temp:"))) ?? tmpdir();
  return {
    available: true,
    interop: {
      command: "cmd.exe",
      spawnDir,
      encoding: encodingFor(codePage(text)),
    },
  };
}

/**
 * Runs one command in cmd.exe on the Windows side of WSL interop. The command
 * starts in `cwd` (a WSL path) converted to the Windows path cmd.exe needs: a
 * drive path for files under /mnt, a UNC share mapped to a drive for the rest.
 */
export async function runWindowsCommand(options: {
  command: string;
  cwd: string;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<ShellOutcome> {
  const status = await windowsInteropStatus();
  if (!status.available) return emptyOutcome(status.reason);
  if (/[\r\n]/.test(options.command))
    return emptyOutcome(
      'The Windows target runs one cmd.exe command line, and cmd drops the lines after the first one. Join the steps with "&" or run them as separate commands.',
    );
  const windowsCwd = await convert("-w", options.cwd);
  if (windowsCwd === null)
    return emptyOutcome(
      `Could not convert the working directory ${options.cwd} to a Windows path.`,
    );

  const { interop } = status;
  const marker = `prism${randomUUID().replaceAll("-", "")}`;
  return runProcess((output) => {
    const raw = { stdout: [] as Buffer[], stderr: [] as Buffer[] };
    const kept = { stdout: 0, stderr: 0 };
    return {
      start: () =>
        spawn(
          interop.command,
          ["/d", "/s", "/c", `set ${marker}=1 & %${COMMAND_VARIABLE}%`],
          {
            cwd: interop.spawnDir,
            env: {
              ...process.env,
              [COMMAND_VARIABLE]: `pushd "${windowsCwd}" && ${options.command}`,
              WSLENV: passedThrough(process.env.WSLENV, COMMAND_VARIABLE),
            },
            detached: true,
            stdio: ["ignore", "pipe", "pipe"],
          },
        ),
      onData: (stream, chunk) => {
        const room = RAW_LIMIT - kept[stream];
        if (room <= 0) return;
        raw[stream].push(chunk.subarray(0, room));
        kept[stream] += chunk.length;
      },
      onEnd: () => {
        output.append(decode(raw.stdout, interop.encoding));
        output.append(decode(raw.stderr, interop.encoding));
      },
      // The Linux side cannot signal the Windows process tree; ask Windows to
      // end it, then drop the interop process that hosted it.
      stop: (child) => {
        void endWindowsTree(interop, marker).finally(() => killProcessGroup(child));
      },
    };
  }, options);
}

/**
 * Ends the Windows process tree cmd.exe started. WSL gives the kernel no
 * Windows pid, so the shell is found again by the marker in its command line
 * and ended with `taskkill /t`, which covers the children it spawned.
 */
async function endWindowsTree(interop: WindowsInterop, marker: string): Promise<void> {
  const query =
    "Get-CimInstance Win32_Process -Filter \"Name='cmd.exe'\" | " +
    `Where-Object { $_.CommandLine -like '*${marker}=1*' } | ForEach-Object { $_.ProcessId }`;
  const lookup = await capture(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", query],
    interop.spawnDir,
    KILL_TIMEOUT_MS,
  );
  const pid = lookup.out.toString("latin1").trim();
  if (!/^\d+$/.test(pid)) return;
  await capture(
    interop.command,
    ["/d", "/s", "/c", `taskkill /f /t /pid ${pid}`],
    interop.spawnDir,
    KILL_TIMEOUT_MS,
  );
}

interface Captured {
  code: number | null;
  out: Buffer;
  error?: string;
}

/** Runs a short helper process and collects its output; never rejects. */
function capture(
  file: string,
  args: string[],
  cwd: string,
  timeoutMs = HELPER_TIMEOUT_MS,
): Promise<Captured> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const child = spawn(file, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (result: Captured): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({
        code: null,
        out: Buffer.concat(chunks),
        error: `no answer within ${timeoutMs}ms`,
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.resume();
    child.on("error", (error) =>
      finish({ code: null, out: Buffer.concat(chunks), error: error.message }),
    );
    child.on("close", (code) => finish({ code, out: Buffer.concat(chunks) }));
  });
}

/** Converts between WSL and Windows paths with the tool WSL ships. */
async function convert(flag: "-u" | "-w", path: string): Promise<string | null> {
  const result = await capture("wslpath", [flag, path], "/");
  const converted = result.out.toString("utf8").trim();
  if (result.error !== undefined || result.code !== 0 || converted === "") return null;
  return converted;
}

/** The text that follows `prefix` on the line carrying it. */
function markedLine(text: string, prefix: string): string {
  return (
    text
      .split(/\r?\n/)
      .find((line) => line.startsWith(prefix))
      ?.slice(prefix.length)
      .trim() ?? ""
  );
}

/** The console code page chcp reports, which cmd writes built-in output with. */
function codePage(text: string): number {
  const lines = text.split(/\r?\n/);
  const marked = lines.findIndex((line) => line.startsWith("prism-temp:"));
  const page = /(\d{3,5})/.exec(lines[marked - 1] ?? "")?.[1];
  return Number(page ?? "");
}

/** The decoder for a console code page, with GBK as the fallback. */
function encodingFor(page: number): string {
  const label = CODE_PAGE_ENCODINGS[page] ?? FALLBACK_ENCODING;
  try {
    return new TextDecoder(label).encoding;
  } catch {
    return FALLBACK_ENCODING;
  }
}

/** cmd writes the console code page to pipes; modern tools write UTF-8. */
function decode(bytes: Buffer[], encoding: string): string {
  const raw = Buffer.concat(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    return new TextDecoder(encoding).decode(raw);
  }
}

/** Adds a variable to the list WSL copies into interop processes. */
function passedThrough(current: string | undefined, variable: string): string {
  return current === undefined || current === "" ? variable : `${current}:${variable}`;
}
