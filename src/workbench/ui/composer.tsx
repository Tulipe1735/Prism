import type { JSX } from "react";
import type { Workbench } from "./use-workbench.ts";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  ArrowUp,
  Check,
  ChevronDown,
  FileText,
  Paperclip,
  ShieldCheck,
  Square,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { THINKING_EFFORTS, type ThinkingEffort } from "../../kernel/types.ts";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from "../../shared/attachments.ts";
import { Button, SCOPE_LABELS } from "./components.tsx";
import { PluginSlot } from "./plugin-slots.tsx";

const THINKING_LABELS: Record<ThinkingEffort, string> = {
  low: "low",
  high: "high",
  max: "max",
};

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
    if (workbench.sending || !enabled) return;
    const message = draft;
    const attached = files;
    if (await workbench.send(message, attached)) {
      setDraft((current) => (current === message ? "" : current));
      setFiles((current) => current.filter((file) => !attached.includes(file)));
    }
  }
  return (
    <div className="composer-dock shrink-0 px-5 pt-3 pb-4 md:px-8 md:pb-6 lg:px-12">
      <form
        id="composer"
        className={`relative mx-auto max-w-[45rem] rounded-lg border bg-paper transition-[border-color,box-shadow] duration-200 focus-within:border-ink/25 focus-within:shadow-[0_2px_8px_rgba(55,53,47,0.06)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/30 ${dragging ? "border-accent ring-2 ring-accent/20" : "border-line"}`}
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
          className="block max-h-48 min-h-[104px] w-full border-0 bg-transparent px-4 pt-4 pb-2 text-base leading-7 outline-none placeholder:text-muted focus-visible:outline-none disabled:cursor-not-allowed md:px-5"
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
        <PluginSlot slot="composer.toolbar" />
        <div className="flex min-h-11 items-center justify-between gap-2 px-3 pb-3 md:px-4">
          <div className="flex min-w-0 items-center gap-2 text-sm text-muted">
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
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <span
              id="composer-model"
              className="max-w-36 truncate text-sm text-muted sm:max-w-56"
              title={state.settings?.model.model}
            >
              {state.settings?.model.model}
            </span>
            <ThinkingEffortMenu
              value={state.settings?.model.thinking ?? "high"}
              disabled={state.settings === null}
              onChange={(thinking) =>
                void workbench.updateSettings({ model: { thinking } })
              }
            />
            {busy ? (
              <Button
                id="cancel"
                data-action="cancel"
                variant="primary"
                disabled={!state.taskRunning || !state.connected}
                className="size-9 min-h-9 rounded-md px-0"
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
            ) : null}
            <Button
              id="send"
              type="submit"
              variant="primary"
              disabled={
                !enabled ||
                workbench.sending ||
                (draft.trim() === "" && files.length === 0)
              }
              className="size-9 min-h-9 rounded-md px-0"
              aria-label={state.taskRunning ? "补充指令" : "发送任务"}
              title={state.taskRunning ? "补充指令（当前步骤结束后处理）" : "发送任务"}
            >
              <ArrowUp size={16} aria-hidden="true" />
            </Button>
          </div>
        </div>
      </form>
      <div className="composer-hint mx-auto mt-3 flex max-w-[45rem] justify-end gap-3 text-[11px] text-muted">
        <span>
          <kbd>Enter</kbd> 发送
        </span>
        <span>
          <kbd>Shift Enter</kbd> 换行
        </span>
      </div>
    </div>
  );
}

const effortItem =
  "flex cursor-default select-none items-center justify-between gap-3 rounded px-2.5 py-2 text-sm text-ink outline-none data-[highlighted]:bg-surface data-[disabled]:opacity-40";

/** Compact menu for the current thinking effort. */
function ThinkingEffortMenu({
  value,
  disabled,
  onChange,
}: {
  value: ThinkingEffort;
  disabled: boolean;
  onChange: (effort: ThinkingEffort) => void;
}): JSX.Element {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild disabled={disabled}>
        <button
          type="button"
          id="composer-thinking"
          aria-label={`思考强度：${THINKING_LABELS[value]}`}
          title="思考强度：回答前的推理深度"
          className="flex h-8 min-h-8 shrink-0 items-center gap-1 rounded-md border border-transparent bg-transparent px-2 py-0 text-sm text-muted transition-colors hover:bg-surface hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:bg-surface data-[state=open]:text-ink"
        >
          <span className="sr-only">思考强度</span>
          <span>effort {THINKING_LABELS[value]}</span>
          <ChevronDown size={12} aria-hidden="true" className="text-muted" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={8}
          className="z-50 w-40 rounded-lg border bg-paper p-1 shadow-lg shadow-ink/10"
        >
          <DropdownMenu.RadioGroup
            value={value}
            aria-label="思考强度"
            onValueChange={(next) => onChange(next as ThinkingEffort)}
          >
            {THINKING_EFFORTS.map((effort) => (
              <DropdownMenu.RadioItem
                key={effort}
                value={effort}
                className={effortItem}
              >
                <span>{THINKING_LABELS[effort]}</span>
                <DropdownMenu.ItemIndicator>
                  <Check size={13} className="text-accent" aria-hidden="true" />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
