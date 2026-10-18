import type { Buffer } from "node:buffer";
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

/** The kernel did not come up; `output` carries what it printed instead. */
export class KernelLaunchError extends Error {
  override readonly name = "KernelLaunchError";
  readonly output: string;

  constructor(message: string, output = "") {
    super(message);
    this.output = output;
  }
}

/** How to reach the kernel entry file on this host. */
export interface KernelEntry {
  path: string;
  /** Node flags the entry needs, e.g. type stripping while developing. */
  flags: string[];
}

/** One spawn command for the platform the workbench runs on. */
export interface KernelLaunchPlan {
  command: string;
  args: string[];
}

export interface KernelLaunchOptions {
  /** Root of the Prism checkout; the kernel entry is resolved below it. Defaults to the current directory. */
  projectRoot?: string;
  /** Overrides the entry resolution; tests and packaged builds use this. */
  entry?: KernelEntry;
  dataDir?: string;
  port?: number;
  platform?: NodeJS.Platform;
  /** Path of the kernel entry inside WSL; required on Windows. */
  wslEntry?: string;
  /** Node binary inside WSL, or the host node elsewhere. */
  node?: string;
}

export interface RunningKernelProcess {
  url: string;
  port: number;
  version: string;
  dataDir: string;
  /** True once the kernel process is gone. */
  exited: () => boolean;
  /** Everything the kernel wrote to stderr so far. */
  output: () => string;
  /** Asks the kernel to stop, waits for it, then kills it if it lingers. */
  close: () => Promise<void>;
}

/** Time the kernel gets to print its ready line before the workbench gives up. */
const READY_TIMEOUT_MS = 30_000;
/** Time the kernel gets to exit after `POST /shutdown`. */
const STOP_TIMEOUT_MS = 5_000;

/**
 * The built kernel when the checkout is built, the TypeScript entry while
 * developing; the dev entry needs Node's type stripping.
 */
export function resolveKernelEntry(projectRoot: string): KernelEntry {
  const built = join(projectRoot, "dist/kernel.js");
  if (existsSync(built)) return { path: built, flags: [] };
  return {
    path: join(projectRoot, "src/interfaces/kernel.ts"),
    flags: ["--experimental-strip-types", "--disable-warning=ExperimentalWarning"],
  };
}

/**
 * Builds the spawn command. On Windows the kernel runs inside WSL (ADR-0001)
 * and its path cannot be derived from the Windows checkout, so the user states
 * it once in `PRISM_KERNEL_ENTRY`.
 */
export function planKernelLaunch(options: KernelLaunchOptions): KernelLaunchPlan {
  const platform = options.platform ?? process.platform;
  const node = options.node ?? process.execPath;
  const dataDir = options.dataDir;
  const port = options.port;
  const tail = [
    ...(dataDir === undefined ? [] : ["--data-dir", dataDir]),
    // Port 0 is the kernel default (a free port), so it is left out.
    ...(port === undefined || port === 0 ? [] : ["--port", String(port)]),
  ];
  if (platform === "win32") {
    const entry = options.wslEntry ?? process.env.PRISM_KERNEL_ENTRY;
    if (entry === undefined || entry === "")
      throw new KernelLaunchError(
        "Set PRISM_KERNEL_ENTRY to the kernel entry inside WSL, for example /home/you/prism/dist/kernel.js",
      );
    return { command: "wsl.exe", args: ["-e", node, entry, ...tail] };
  }
  const entry =
    options.entry ?? resolveKernelEntry(options.projectRoot ?? process.cwd());
  return { command: node, args: [...entry.flags, entry.path, ...tail] };
}

/** Starts the kernel and waits for the ready line that announces its port. */
export async function launchKernel(
  options: KernelLaunchOptions,
): Promise<RunningKernelProcess> {
  const plan = planKernelLaunch(options);
  const child = spawn(plan.command, plan.args, { stdio: ["ignore", "pipe", "pipe"] });
  const ready = await waitForReadyLine(child).catch(async (error: unknown) => {
    await stopProcess(child);
    throw error;
  });
  return {
    url: ready.url,
    port: ready.port,
    version: ready.version,
    dataDir: ready.dataDir,
    exited: () => child.exitCode !== null || child.signalCode !== null,
    output: () => ready.output,
    close: async () => {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise<void>((resolve) =>
          child.once("exit", () => resolve()),
        );
        await fetch(`${ready.url}/shutdown`, { method: "POST" }).catch(() => undefined);
        await Promise.race([
          exited,
          new Promise((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS)),
        ]);
      }
      await stopProcess(child);
    },
  };
}

interface ReadyLine {
  url: string;
  port: number;
  version: string;
  dataDir: string;
  output: string;
}

function waitForReadyLine(child: ChildProcess): Promise<ReadyLine> {
  return new Promise<ReadyLine>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      reject(
        new KernelLaunchError(
          `The kernel printed no ready line within ${READY_TIMEOUT_MS / 1000}s`,
          stderr,
        ),
      );
    }, READY_TIMEOUT_MS);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      let newline = stdout.indexOf("\n");
      while (newline !== -1) {
        const line = stdout.slice(0, newline);
        stdout = stdout.slice(newline + 1);
        newline = stdout.indexOf("\n");
        const ready = parseReadyLine(line);
        if (ready === null) continue;
        clearTimeout(timer);
        resolve({ ...ready, output: stderr });
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(
        new KernelLaunchError(`Could not start the kernel: ${error.message}`, stderr),
      );
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(
        new KernelLaunchError(
          `The kernel exited with code ${code} before it was ready${stderr.trim() === "" ? "" : `: ${stderr.trim()}`}`,
          stderr,
        ),
      );
    });
  });
}

function parseReadyLine(line: string): Omit<ReadyLine, "output"> | null {
  try {
    const parsed = JSON.parse(line) as {
      type?: unknown;
      url?: unknown;
      port?: unknown;
      version?: unknown;
      dataDir?: unknown;
    };
    if (parsed.type !== "kernel.ready") return null;
    return {
      url: String(parsed.url),
      port: Number(parsed.port),
      version: String(parsed.version),
      dataDir: String(parsed.dataDir),
    };
  } catch {
    return null;
  }
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  const killed = await Promise.race([
    exited.then(() => true),
    new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), STOP_TIMEOUT_MS),
    ),
  ]);
  if (!killed) {
    child.kill("SIGKILL");
    await exited;
  }
}
