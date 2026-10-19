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
        <Welcome
          hasSession={state.session !== null}
          hasWorkspace={state.workspace !== ""}
        />
      ) : (
        <div className="mx-auto max-w-3xl space-y-7 py-8">
          {steps.map((step) => (
            <TimelineEntry key={step.id} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}

function Welcome({
  hasSession,
  hasWorkspace,
}: {
  hasSession: boolean;
  hasWorkspace: boolean;
}): JSX.Element {
  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-center py-10 md:py-16">
      <div className="mb-7 flex items-center gap-3">
        <span className="h-px w-8 bg-accent" />
        <span className="eyebrow text-accent">A clear space to create</span>
      </div>
      <h1 className="text-[clamp(32px,4vw,56px)] leading-[1.2] font-semibold tracking-[-0.05em]">
        让想法，
        <br />
        <span className="text-muted">成为下一步。</span>
      </h1>
      <p className="mt-6 max-w-sm text-[13px] leading-7 text-muted">
        {hasSession
          ? "写下你的目标。Prism 会理解代码、推进任务，让每一步都清晰可见。"
          : hasWorkspace
            ? "工作区已就绪。新建一个会话，从你想解决的问题开始。"
            : "从一个工作区开始。让 Prism 和你一起读代码、做修改、核查结果。"}
      </p>
      <div className="mt-10 grid grid-cols-1 border-y sm:grid-cols-3">
        {[
          ["01", "选择工作区", "你的项目，是工作的起点。"],
          ["02", "描述任务", "给出目标，也可以随时补充。"],
          ["03", "查看结果", "过程、改动与产物一目了然。"],
        ].map(([number, title, detail]) => (
          <div
            key={number}
            className="py-5 sm:pr-3 sm:not-first:border-l sm:not-first:pl-4 max-sm:not-first:border-t"
          >
            <span className="font-mono text-[10px] text-accent">{number}</span>
            <h2 className="mt-3 text-xs font-semibold">{title}</h2>
            <p className="mt-1.5 text-[10px] leading-5 text-muted">{detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelineEntry({ step }: { step: TimelineStep }): JSX.Element {
  if (step.kind === "tool") return <ToolCard step={step} />;
  if (step.kind === "compaction")
    return (
      <details
        className="entry system border-y py-3 text-xs text-muted"
        data-entry={step.id}
      >
        <summary className="flex items-center gap-2">
          <ChevronRight size={12} className="disclosure" aria-hidden="true" />
          上下文压缩<span className="ml-auto font-mono text-[9px]">COMPACTION</span>
        </summary>
        <div className="pt-4 leading-7 whitespace-pre-wrap">{step.summary}</div>
      </details>
    );
  const assistant = step.role === "assistant";
  return (
    <article
      className={`entry ${step.role} ${assistant ? "" : "border-l-2 border-line pl-4"}`}
      data-entry={step.id}
    >
      <div className="meta mb-3 flex items-center gap-2.5 text-[11px] font-semibold">
        {assistant ? (
          <PrismMark className="size-3.5" />
        ) : (
          <Circle size={11} strokeWidth={1.4} aria-hidden="true" />
        )}
        {assistant ? "Prism" : step.role === "user" ? "你" : "系统"}
        <span className="ml-auto font-mono text-[9px] font-normal tracking-widest text-muted">
          {step.streaming
            ? "THINKING / 正在回复"
            : assistant
              ? "ASSISTANT"
              : step.role === "user"
                ? "YOU"
                : "SYSTEM"}
        </span>
      </div>
      <div className="text-[13px] leading-7 break-words whitespace-pre-wrap">
        {step.content}
        {step.streaming ? (
          <span
            aria-hidden="true"
            className="ml-1 inline-block h-3.5 w-1.5 animate-pulse bg-accent align-middle"
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
      className="tool overflow-hidden rounded-sm border"
      data-call={step.callId}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex items-center gap-2.5 bg-surface/40 px-3 py-3 text-[11px]">
        <ChevronRight
          className="disclosure shrink-0 text-muted"
          size={12}
          aria-hidden="true"
        />
        <Terminal size={13} aria-hidden="true" className="shrink-0 text-muted" />
        <span className="name shrink-0 font-mono font-medium">{step.name}</span>
        <span
          className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted"
          title={step.target}
        >
          {step.target}
        </span>
        <span
          className={`state flex shrink-0 items-center gap-1.5 ${step.state === "ok" ? "text-success" : step.state === "failed" ? "text-accent" : "text-muted"}`}
          data-state={step.state}
        >
          {step.state === "running" ? (
            <LoaderCircle size={12} className="animate-spin" aria-hidden="true" />
          ) : step.state === "ok" ? (
            <Check size={12} aria-hidden="true" />
          ) : (
            <TriangleAlert size={12} aria-hidden="true" />
          )}
          {TOOL_LABELS[step.state]}
        </span>
      </summary>
      <div className="border-t">
        <p className="eyebrow px-4 pt-3">Arguments / 参数</p>
        <pre className="code-output">{step.arguments}</pre>
      </div>
      {step.result === undefined ? null : (
        <div className="border-t">
          <p className="eyebrow px-4 pt-3">Result / 结果</p>
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
