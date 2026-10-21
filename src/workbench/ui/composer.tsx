import type { JSX } from "react";
import type { Workbench } from "./use-workbench.ts";
import { ArrowUp, FileText, Paperclip, ShieldCheck, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from "../../shared/attachments.ts";
import { Button, SCOPE_LABELS, workspaceName } from "./components.tsx";

export function Composer({ workbench }: { workbench: Workbench }): JSX.Element {
  const { state } = workbench;
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const busy = state.taskRunning || workbench.sending;
  const enabled = state.session !== null && state.connected;
  useEffect(() => {
    if (enabled) textarea.current?.focus();
  }, [enabled]);
  const addFiles = useCallback(
    (incoming: File[]): void => {
      if (!enabled) {
        workbench.dispatch({
          type: "notice",
          notice: "先新建或选择一个会话，再添加文件。",
        });
        return;
      }
      if (incoming.some((file) => file.size > MAX_ATTACHMENT_BYTES)) {
        workbench.dispatch({ type: "notice", notice: "单个文件不能超过 20 MB。" });
        return;
      }
      const added = incoming.filter(
        (file, index) =>
          ![...files, ...incoming.slice(0, index)].some(
            (other) =>
              other.name === file.name &&
              other.size === file.size &&
              other.lastModified === file.lastModified,
          ),
      );
      if (files.length + added.length > MAX_ATTACHMENTS) {
        workbench.dispatch({ type: "notice", notice: "每条消息最多添加 10 个文件。" });
        return;
      }
      setFiles((current) => [...current, ...added]);
      textarea.current?.focus();
    },
    [enabled, files, workbench.dispatch],
  );

  useEffect(() => {
    const chat = document.getElementById("chat");
    if (chat === null) return;
    let depth = 0;
    const hasFiles = (event: DragEvent): boolean =>
      event.dataTransfer?.types.includes("Files") ?? false;
    const enter = (event: DragEvent): void => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const over = (event: DragEvent): void => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer !== null)
        event.dataTransfer.dropEffect = enabled ? "copy" : "none";
    };
    const leave = (event: DragEvent): void => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (event: DragEvent): void => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      if (
        Array.from(event.dataTransfer?.items ?? []).some(
          (item) => item.webkitGetAsEntry()?.isDirectory,
        )
      ) {
        workbench.dispatch({
          type: "notice",
          notice: "请选择文件；暂不支持添加文件夹。",
        });
        return;
      }
      addFiles(Array.from(event.dataTransfer?.files ?? []));
    };
    chat.addEventListener("dragenter", enter);
    chat.addEventListener("dragover", over);
    chat.addEventListener("dragleave", leave);
    chat.addEventListener("drop", drop);
    return () => {
      chat.removeEventListener("dragenter", enter);
      chat.removeEventListener("dragover", over);
      chat.removeEventListener("dragleave", leave);
      chat.removeEventListener("drop", drop);
    };
  }, [addFiles, enabled, workbench.dispatch]);

  async function send(): Promise<void> {
    if (busy) return;
    const message = draft;
    const attached = files;
    if (await workbench.send(message, attached)) {
      setDraft((current) => (current === message ? "" : current));
      setFiles((current) => current.filter((file) => !attached.includes(file)));
    }
  }
  return (
    <div className="shrink-0 px-5 pt-3 pb-4 md:px-8 md:pb-6 lg:px-12">
      <form
        id="composer"
        className={`relative mx-auto max-w-3xl rounded-lg border bg-paper transition-[border-color,box-shadow] duration-200 focus-within:border-accent/40 focus-within:shadow-[0_1px_3px_rgba(37,99,235,0.06)] focus-within:ring-2 focus-within:ring-accent/10 ${dragging ? "border-accent ring-2 ring-accent/20" : "border-line"}`}
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        {dragging ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-paper/95 text-sm text-accent">
            <Paperclip size={16} className="mr-2" aria-hidden="true" />
            松开以添加文件
          </div>
        ) : null}
        <input
          ref={fileInput}
          id="file-input"
          type="file"
          multiple
          hidden
          disabled={!enabled}
          onChange={(event) => {
            addFiles(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
        {files.length === 0 ? null : (
          <ul
            aria-label="待发送文件"
            className="flex max-h-32 flex-wrap gap-2 overflow-y-auto px-4 pt-3"
          >
            {files.map((file, index) => (
              <li
                key={`${file.name}-${file.lastModified}-${index}`}
                className="attachment flex max-w-full items-center gap-2 rounded-md border bg-surface px-2.5 py-1.5 text-xs"
              >
                <FileText
                  size={14}
                  className="shrink-0 text-muted"
                  aria-hidden="true"
                />
                <span className="max-w-44 truncate" title={file.name}>
                  {file.name}
                </span>
                <span className="shrink-0 text-muted">{formatFileSize(file.size)}</span>
                <button
                  type="button"
                  aria-label={`移除 ${file.name}`}
                  disabled={workbench.sending}
                  onClick={() =>
                    setFiles((current) => current.filter((entry) => entry !== file))
                  }
                  className="rounded p-0.5 text-muted hover:bg-ink/5 hover:text-ink disabled:opacity-50"
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <label htmlFor="message" className="sr-only">
          描述任务
        </label>
        <textarea
          ref={textarea}
          id="message"
          rows={3}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={state.session === null}
          placeholder={
            state.session === null
              ? "新建或选择一个会话，开始你的任务…"
              : "你想完成什么？"
          }
          className="block max-h-48 min-h-[88px] w-full border-0 bg-transparent px-4 pt-4 pb-2 text-sm leading-6 outline-none placeholder:text-muted/60 focus-visible:outline-none disabled:cursor-not-allowed md:px-5"
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              event.nativeEvent.keyCode !== 229
            ) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className="flex min-h-11 items-center justify-between gap-2 px-3 pb-3 md:px-4">
          <div className="flex min-w-0 items-center gap-2 text-[13px] text-muted">
            <Button
              id="attach-file"
              variant="ghost"
              className="size-8 min-h-8 px-0"
              aria-label="添加文件"
              title="添加文件"
              disabled={!enabled || workbench.sending}
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip size={16} aria-hidden="true" />
            </Button>
            <span className="hidden items-center gap-1.5 sm:flex">
              <ShieldCheck size={14} className="shrink-0" aria-hidden="true" />
              <span>
                {state.settings === null
                  ? "读取设置中"
                  : SCOPE_LABELS[state.settings.permissions.scope]}
              </span>
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <span
              id="composer-model"
              className="max-w-36 truncate text-[13px] text-muted sm:max-w-56"
              title={state.settings?.model.model}
            >
              {state.settings?.model.model}
            </span>
            {busy ? (
              <Button
                id="cancel"
                data-action="cancel"
                variant="primary"
                disabled={!state.taskRunning || !state.connected}
                className="size-9 min-h-9 rounded-full border-accent bg-accent px-0 text-white hover:border-[#1d4ed8] hover:bg-[#1d4ed8]"
                aria-label="停止任务"
                title="停止任务"
                onClick={() => void workbench.cancel()}
              >
                <Square
                  size={12}
                  fill="currentColor"
                  strokeWidth={0}
                  aria-hidden="true"
                />
              </Button>
            ) : (
              <Button
                id="send"
                type="submit"
                variant="primary"
                disabled={!enabled || (draft.trim() === "" && files.length === 0)}
                className="size-9 min-h-9 rounded-full border-accent bg-accent px-0 text-white hover:border-[#1d4ed8] hover:bg-[#1d4ed8]"
                aria-label="发送任务"
                title="发送任务"
              >
                <ArrowUp size={16} aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>
      </form>
      <div className="mx-auto mt-2.5 flex max-w-3xl items-center justify-between gap-3 text-xs text-muted">
        <span
          id="task-state"
          role="status"
          title={state.workspace}
          className="flex min-w-0 items-center gap-1.5"
        >
          <span
            className={`size-1 shrink-0 rounded-full ${busy ? "animate-pulse bg-accent" : "bg-muted/40"}`}
          />
          <span className="truncate">
            {state.workspace === "" ? "尚未选择工作区" : workspaceName(state.workspace)}
            {busy ? " · 任务运行中…" : ""}
          </span>
        </span>
        <span className="hidden sm:inline">
          <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px]">
            Enter
          </kbd>{" "}
          发送<span className="mx-1.5 text-muted/50">/</span>
          <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px]">
            Shift + Enter
          </kbd>{" "}
          换行
        </span>
      </div>
    </div>
  );
}

export function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
