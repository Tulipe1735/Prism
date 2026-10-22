import type { JSX } from "react";
import type { DiffLine, TimelineStep, ToolStep } from "./derive.ts";
import type { UiState } from "./state.ts";
import {
  Check,
  ChevronRight,
  Circle,
  LoaderCircle,
  Terminal,
  TriangleAlert,
} from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AttachmentView } from "./attachment.tsx";
import { PrismMark } from "./components.tsx";
import { parseUnifiedDiff, toTimeline } from "./derive.ts";

export function Timeline({ state }: { state: UiState }): JSX.Element {
  const steps = useMemo(
    () => toTimeline(state.entries, { deltas: new Map(Object.entries(state.deltas)) }),
    [state.entries, state.deltas],
  );
  const container = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useLayoutEffect(() => {
    pinned.current = true;
  }, [state.activeId]);
  useLayoutEffect(() => {
    const node = container.current;
    if (node !== null && pinned.current) node.scrollTop = node.scrollHeight;
  }, [steps]);
  return (
    <div
      id="timeline"
      ref={container}
      role="log"
      aria-label="会话时间线"
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 md:px-8 lg:px-12"
      onScroll={() => {
        const node = container.current;
        if (node !== null)
          pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
      }}
    >
      {steps.length === 0 ? (
        <Welcome />
      ) : (
        <div className="mx-auto max-w-[45rem] space-y-10 py-10">
          {steps.map((step) => (
            <TimelineEntry key={step.id} step={step} sessionId={state.activeId} />
          ))}
        </div>
      )}
    </div>
  );
}

function Welcome(): JSX.Element {
  return (
    <div className="mx-auto flex min-h-full max-w-[45rem] flex-col justify-center py-12 md:py-16">
      <PrismMark className="mb-8 size-9" />
      <h1 className="max-w-lg text-[clamp(30px,3.4vw,46px)] leading-[1.15] font-semibold tracking-[-0.035em]">
        让想法，
        <br />
        <span className="text-muted">成为下一步。</span>
      </h1>
    </div>
  );
}

function TimelineEntry({
  step,
  sessionId,
}: {
  step: TimelineStep;
  sessionId: string | null;
}): JSX.Element {
  if (step.kind === "tool") return <ToolCard step={step} />;
  if (step.kind === "compaction")
    return (
      <details
        className="entry system border-y py-3.5 text-sm text-muted"
        data-entry={step.id}
      >
        <summary className="flex items-center gap-2">
          <ChevronRight size={13} className="disclosure" aria-hidden="true" />
          上下文压缩
        </summary>
        <div className="pt-4 leading-7 whitespace-pre-wrap">{step.summary}</div>
      </details>
    );
  const assistant = step.role === "assistant";
  return (
    <article className={`entry ${step.role}`} data-entry={step.id}>
      <div className="meta mb-2.5 flex items-center gap-2 text-sm font-semibold">
        {assistant ? (
          <PrismMark className="size-4" />
        ) : (
          <Circle size={10} strokeWidth={1.6} aria-hidden="true" />
        )}
        {assistant ? "Prism" : step.role === "user" ? "你" : "系统"}
        {step.streaming ? (
          <span className="ml-1 font-normal text-muted">正在回复…</span>
        ) : null}
      </div>
      <div
        className={
          assistant
            ? "markdown text-base leading-7 break-words"
            : "rounded-md bg-surface px-4 py-3 text-base leading-7 break-words whitespace-pre-wrap"
        }
      >
        {assistant ? (
          <Markdown remarkPlugins={[remarkGfm]}>{step.content}</Markdown>
        ) : (
          step.content
        )}
        {step.attachments === undefined ? null : (
          <ul
            aria-label="已发送文件"
            className="mt-2 flex flex-wrap gap-2 whitespace-normal"
          >
            {sessionId === null
              ? null
              : step.attachments.map((file) => (
                  <AttachmentView key={file.id} file={file} sessionId={sessionId} />
                ))}
          </ul>
        )}
        {step.streaming ? (
          <span
            aria-hidden="true"
            className="ml-1 inline-block h-3.5 w-[3px] animate-pulse rounded-full bg-accent align-middle"
          />
        ) : null}
      </div>
    </article>
  );
}

const TOOL_LABELS = { running: "执行中", ok: "完成", failed: "失败" } as const;

function ToolCard({ step }: { step: ToolStep }): JSX.Element {
  const [open, setOpen] = useState(step.state !== "ok");
  const diff = useMemo(
    () => (step.result === undefined ? null : parseUnifiedDiff(step.result)),
    [step.result],
  );
  return (
    <details
      className="tool overflow-hidden rounded-md border bg-paper"
      data-call={step.callId}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm transition-colors hover:bg-surface/70">
        <ChevronRight
          className="disclosure shrink-0 text-muted"
          size={13}
          aria-hidden="true"
        />
        <Terminal size={14} aria-hidden="true" className="shrink-0 text-muted" />
        <span className="name shrink-0 font-mono text-xs font-medium">{step.name}</span>
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs text-muted"
          title={step.target}
        >
          {step.target}
        </span>
        <span
          className={`state flex shrink-0 items-center gap-1.5 text-xs ${step.state === "ok" ? "text-success" : step.state === "failed" ? "text-accent" : "text-muted"}`}
          data-state={step.state}
        >
          {step.state === "running" ? (
            <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
          ) : step.state === "ok" ? (
            <Check size={13} aria-hidden="true" />
          ) : (
            <TriangleAlert size={13} aria-hidden="true" />
          )}
          {TOOL_LABELS[step.state]}
        </span>
      </summary>
      <div className="border-t">
        <p className="px-4 pt-3 text-xs font-medium text-muted">参数</p>
        <pre className="code-output">{step.arguments}</pre>
      </div>
      {step.result === undefined ? null : (
        <div className="border-t">
          <p className="px-4 pt-3 text-xs font-medium text-muted">结果</p>
          {diff === null ? (
            <pre className="code-output">{step.result}</pre>
          ) : (
            <Diff lines={diff} />
          )}
        </div>
      )}
    </details>
  );
}

export function Diff({ lines }: { lines: DiffLine[] }): JSX.Element {
  return (
    <div className="diff">
      {lines.map((line, index) => (
        <div key={index} className={line.kind}>
          {line.text || " "}
        </div>
      ))}
    </div>
  );
}
