import type { IPty } from "node-pty";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { KernelError } from "./errors.ts";

export type TerminalEvent =
  { type: "data"; data: string } | { type: "exit"; exitCode: number };

interface WorkspaceTerminal {
  id: string;
  workspace: string;
  process: IPty;
  output: string;
  exitCode?: number;
  listeners: Set<(event: TerminalEvent) => void>;
  exited: Promise<void>;
}

/** One persistent shell per workspace, owned and stopped by the kernel. */
export class WorkspaceTerminals {
  private readonly terminals = new Map<string, WorkspaceTerminal>();
  private closed = false;

  async open(workspace: string, cols: number, rows: number): Promise<{ id: string }> {
    if (this.closed) throw new KernelError("INVALID_REQUEST", "终端正在关闭。");
    workspace = resolve(workspace);
    if (!(await stat(workspace).catch(() => null))?.isDirectory())
      throw new KernelError("INVALID_REQUEST", "工作区目录不存在。");
    const { spawn } = await import("node-pty");
    if (this.closed) throw new KernelError("INVALID_REQUEST", "终端正在关闭。");
    const existing = [...this.terminals.values()].find(
      (terminal) => terminal.workspace === workspace && terminal.exitCode === undefined,
    );
    if (existing !== undefined) {
      existing.process.resize(cols, rows);
      return { id: existing.id };
    }
    const windows = process.platform === "win32";
    const shell = windows ? "powershell.exe" : process.env.SHELL || "/bin/sh";
    const pty = spawn(shell, windows ? ["-NoLogo"] : ["-i"], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: workspace,
      env: { ...process.env, TERM: "xterm-256color" },
    });
    let finish: () => void = () => {};
    const exited = new Promise<void>((resolveExit) => {
      finish = resolveExit;
    });
    const terminal: WorkspaceTerminal = {
      id: randomUUID(),
      workspace,
      process: pty,
      output: "",
      listeners: new Set(),
      exited,
    };
    this.terminals.set(terminal.id, terminal);
    const emit = (event: TerminalEvent): void => {
      for (const listener of terminal.listeners) listener(event);
    };
    pty.onData((data) => {
      terminal.output = (terminal.output + data).slice(-1_000_000);
      emit({ type: "data", data });
    });
    pty.onExit(({ exitCode }) => {
      terminal.exitCode = exitCode;
      emit({ type: "exit", exitCode });
      finish();
    });
    return { id: terminal.id };
  }

  subscribe(id: string, listener: (event: TerminalEvent) => void): () => void {
    const terminal = this.get(id);
    listener({ type: "data", data: terminal.output });
    if (terminal.exitCode !== undefined)
      listener({ type: "exit", exitCode: terminal.exitCode });
    terminal.listeners.add(listener);
    return () => terminal.listeners.delete(listener);
  }

  write(id: string, data: string): void {
    const terminal = this.get(id);
    if (terminal.exitCode !== undefined)
      throw new KernelError("INVALID_REQUEST", "终端已退出，请重新打开。");
    terminal.process.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const terminal = this.get(id);
    if (terminal.exitCode === undefined) terminal.process.resize(cols, rows);
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.all(
      [...this.terminals.values()].map(async (terminal) => {
        terminal.listeners.clear();
        if (terminal.exitCode === undefined) {
          if (process.platform === "win32") {
            // End the tree before ConPTY closes; node-pty's kill races its console-list helper.
            await promisify(execFile)(
              "taskkill.exe",
              ["/f", "/t", "/pid", String(terminal.process.pid)],
              { windowsHide: true, timeout: 5_000 },
            ).catch((error: unknown) => {
              if (terminal.exitCode !== undefined) return;
              // taskkill can fail on a console helper after the shell has already exited.
              try {
                process.kill(terminal.process.pid, 0);
              } catch (probeError) {
                if ((probeError as NodeJS.ErrnoException).code === "ESRCH") return;
              }
              throw error;
            });
          } else terminal.process.kill();
        }
        await terminal.exited;
      }),
    );
    this.terminals.clear();
  }

  private get(id: string): WorkspaceTerminal {
    const terminal = this.terminals.get(id);
    if (terminal === undefined)
      throw new KernelError("INVALID_REQUEST", "终端不存在，请重新打开。");
    return terminal;
  }
}
