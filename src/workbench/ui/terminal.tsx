import type { JSX, PointerEvent as ReactPointerEvent } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { RotateCw, Terminal as TerminalIcon, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { KernelClient } from "./client.ts";

const MIN_TERMINAL_HEIGHT = 140;
/** Space the rest of the workbench keeps even with the drawer fully stretched. */
const BOTTOM_RESERVE = 180;

function clampHeight(value: number): number {
  const ceiling = Math.max(MIN_TERMINAL_HEIGHT, window.innerHeight - BOTTOM_RESERVE);
  return Math.round(Math.min(Math.max(value, MIN_TERMINAL_HEIGHT), ceiling));
}

/**
 * Workspace shell that slides in above the composer when the top-bar button asks
 * for it. It stays mounted while hidden, so the shell and its scrollback survive.
 */
export function WorkspaceTerminal({
  workspace,
  open,
  onClose,
}: {
  workspace: string;
  open: boolean;
  onClose: () => void;
}): JSX.Element {
  const [status, setStatus] = useState("连接中…");
  const [connection, setConnection] = useState(0);
  const [started, setStarted] = useState(false);
  const [height, setHeight] = useState<number | null>(null);
  const [measured, setMeasured] = useState<number | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; height: number } | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (open) setStarted(true);
  }, [open]);

  useEffect(() => {
    const node = host.current;
    if (!started || workspace === "" || node === null) return;
    const client = new KernelClient();
    const controller = new AbortController();
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
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
    fitRef.current = fit;
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
      fitRef.current = null;
    };
  }, [workspace, started, connection]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      fitRef.current?.fit();
      terminalRef.current?.focus();
      const rect = panel.current?.getBoundingClientRect();
      if (rect !== undefined) setMeasured(Math.round(rect.height));
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (height === null) return;
    const keep = (): void => setHeight((current) => clampHeight(current ?? 0));
    window.addEventListener("resize", keep);
    return () => window.removeEventListener("resize", keep);
  }, [height]);

  function startResize(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    event.preventDefault();
    drag.current = {
      y: event.clientY,
      height: panel.current?.getBoundingClientRect().height ?? MIN_TERMINAL_HEIGHT,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveResize(event: ReactPointerEvent<HTMLDivElement>): void {
    const started = drag.current;
    if (started === null) return;
    setHeight(clampHeight(started.height - (event.clientY - started.y)));
  }

  function endResize(event: ReactPointerEvent<HTMLDivElement>): void {
    if (drag.current === null) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <div
      ref={panel}
      id="terminal-panel"
      role="region"
      aria-label="当前工作区终端"
      hidden={!open}
      style={height === null ? undefined : { height }}
      className="flex h-[clamp(200px,38dvh,420px)] shrink-0 flex-col overflow-hidden rounded-t-xl border-t border-line bg-paper shadow-[0_-12px_40px_rgba(15,20,30,0.14)]"
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="调整终端高度"
        aria-valuemin={MIN_TERMINAL_HEIGHT}
        aria-valuemax={Math.max(
          MIN_TERMINAL_HEIGHT,
          window.innerHeight - BOTTOM_RESERVE,
        )}
        aria-valuenow={height ?? measured ?? undefined}
        title="拖动调整终端高度，双击恢复默认"
        tabIndex={0}
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        onDoubleClick={() => setHeight(null)}
        onKeyDown={(event) => {
          const step =
            event.key === "ArrowUp" ? 24 : event.key === "ArrowDown" ? -24 : 0;
          if (step === 0) return;
          event.preventDefault();
          const rect = panel.current?.getBoundingClientRect();
          const current = height ?? rect?.height ?? MIN_TERMINAL_HEIGHT;
          setHeight(clampHeight(current + step));
        }}
        className="group flex h-2.5 shrink-0 cursor-row-resize touch-none items-center justify-center transition-colors hover:bg-ink/[0.03] focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:outline-none"
      >
        <span
          aria-hidden="true"
          className="h-0.5 w-8 rounded-full bg-line transition-colors group-hover:bg-muted/60 group-focus-visible:bg-muted/60"
        />
      </div>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3 text-xs text-muted">
        <TerminalIcon size={14} aria-hidden="true" className="shrink-0" />
        <span className="shrink-0">终端</span>
        <span className="min-w-0 truncate font-mono text-xs" title={workspace}>
          {workspace}
        </span>
        {status !== "" ? (
          <span role="status" className="min-w-0 truncate">
            {status}
          </span>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="重新连接终端"
            title="重新连接终端"
            onClick={() => setConnection((value) => value + 1)}
            className="flex size-6 items-center justify-center rounded-md transition-colors hover:bg-ink/5 hover:text-ink"
          >
            <RotateCw size={13} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="收起终端"
            title="收起终端"
            onClick={onClose}
            className="flex size-6 items-center justify-center rounded-md transition-colors hover:bg-ink/5 hover:text-ink"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 px-3 py-2">
        <div ref={host} className="h-full w-full overflow-hidden" />
      </div>
    </div>
  );
}
