import type { JSX } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import {
  ChevronDown,
  ChevronUp,
  RotateCw,
  Terminal as TerminalIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { KernelClient } from "./client.ts";

export function WorkspaceTerminal({ workspace }: { workspace: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  const [connection, setConnection] = useState(0);
  const [status, setStatus] = useState("连接中…");
  const host = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const node = host.current;
    if (!visited || workspace === "" || node === null) return;
    const client = new KernelClient();
    const controller = new AbortController();
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: '"JetBrains Mono", "Source Han Serif SC", monospace',
      scrollback: 5_000,
      theme: {
        background: "#ffffff",
        foreground: "#1f2328",
        cursor: "#2563eb",
        selectionBackground: "#dbeafe",
      },
    });
    terminalRef.current = terminal;
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(node);
    let id: string | null = null;
    let writes = Promise.resolve();
    const report = (error: unknown): void => {
      if (!controller.signal.aborted)
        setStatus(error instanceof Error ? error.message : String(error));
    };
    const resize = (): void => {
      if (node.clientWidth === 0 || node.clientHeight === 0) return;
      fit.fit();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    const input = terminal.onData((data) => {
      if (id === null) return;
      const terminalId = id;
      writes = writes.then(() => client.writeTerminal(terminalId, data)).catch(report);
    });
    const sizing = terminal.onResize(({ cols, rows }) => {
      if (id !== null) void client.resizeTerminal(id, cols, rows).catch(report);
    });
    setStatus("连接中…");
    void (async () => {
      await document.fonts.ready;
      if (controller.signal.aborted) return;
      resize();
      const opened = await client.openTerminal(workspace, terminal.cols, terminal.rows);
      if (controller.signal.aborted) return;
      id = opened.id;
      setStatus("");
      terminal.focus();
      await client.readTerminal(
        id,
        (event) => {
          if (controller.signal.aborted) return;
          if (event.type === "data") terminal.write(event.data);
          else setStatus(`终端已退出（${event.exitCode}）`);
        },
        controller.signal,
      );
    })().catch(report);
    return () => {
      controller.abort();
      observer.disconnect();
      input.dispose();
      sizing.dispose();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [workspace, visited, connection]);

  return (
    <div id="workspace-terminal" className="shrink-0 border-t bg-paper">
      <div className="flex h-9 items-center gap-2 px-4 text-xs text-muted">
        <button
          type="button"
          id="terminal-toggle"
          aria-expanded={open}
          aria-controls="terminal-panel"
          disabled={workspace === ""}
          onClick={() => {
            setOpen(!open);
            setVisited(true);
            if (!open) requestAnimationFrame(() => terminalRef.current?.focus());
          }}
          className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          <TerminalIcon size={14} aria-hidden="true" />
          <span>终端</span>
          <span className="min-w-0 truncate font-mono text-[11px]" title={workspace}>
            {workspace || "先选择工作区"}
          </span>
          {open ? (
            <ChevronDown size={13} className="ml-auto shrink-0" aria-hidden="true" />
          ) : (
            <ChevronUp size={13} className="ml-auto shrink-0" aria-hidden="true" />
          )}
        </button>
        {open && status !== "" ? (
          <>
            <span role="status" className="truncate">
              {status}
            </span>
            <button
              type="button"
              aria-label="重新连接终端"
              title="重新连接终端"
              onClick={() => setConnection((value) => value + 1)}
              className="rounded p-1 hover:bg-surface"
            >
              <RotateCw size={13} aria-hidden="true" />
            </button>
          </>
        ) : null}
      </div>
      <div
        id="terminal-panel"
        hidden={!open}
        className="h-[clamp(120px,27dvh,260px)] border-t px-3 py-2"
        role="region"
        aria-label="当前工作区终端"
      >
        <div ref={host} className="h-full w-full overflow-hidden" />
      </div>
    </div>
  );
}
