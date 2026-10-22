import type { AgentSnapshot, ResourceReference } from "@prism/plugin-sdk";
import type { JSX } from "react";
import { Paperclip, Send, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { transport } from "./bridge.ts";
import { Button } from "./button.tsx";

interface AttachedFile {
  resource: ResourceReference;
  url?: string;
  text?: string;
}

/** Presentation only: the host owns the session, task loop, tools and approvals. */
export function CanvasAgentPanel({
  sessionId,
  connected,
  open,
  onClose,
  prepare,
}: {
  sessionId: string;
  connected: boolean;
  open: boolean;
  onClose: () => void;
  prepare: () => Promise<string>;
}): JSX.Element {
  const key = `prism.canvas.ai.draft.${sessionId}`;
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  });
  const [snapshot, setSnapshot] = useState<AgentSnapshot | null>(null);
  const [deltas, setDeltas] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const prompt = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const lifetime = useRef<AbortController | null>(null);
  const urls = useRef(new Set<string>());
  const running = snapshot?.running ?? false;

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    let sequence = 0;
    const refresh = (): void => {
      const request = ++sequence;
      void transport.agent
        .read({ signal: controller.signal })
        .then((value) => {
          if (
            controller.signal.aborted ||
            request !== sequence ||
            value.sessionId !== sessionId
          )
            return;
          setSnapshot(value);
          const persisted = new Set(value.entries.map((entry) => entry.id));
          setDeltas((current) =>
            Object.fromEntries(
              Object.entries(current).filter(([id]) => !persisted.has(id)),
            ),
          );
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted)
            setError(cause instanceof Error ? cause.message : String(cause));
        });
    };
    const closeContext = transport.onContext((context) => {
      if (context.sessionId === sessionId && context.connected) {
        setError(null);
        refresh();
      }
    });
    const closeEvents = transport.agent.subscribe((event) => {
      if (event.type === "message.delta")
        setDeltas((current) => ({
          ...current,
          [event.entryId]: (current[event.entryId] ?? "") + event.delta,
        }));
      else if (event.type === "tool.started")
        setActivity(
          event.name === "excalidraw_read"
            ? "正在读取画布…"
            : event.name === "excalidraw_update"
              ? "正在更新画布…"
              : "正在执行任务步骤…",
        );
      else if (event.type === "approval.requested")
        setActivity("请在会话中确认待审批操作。");
      else if (event.type === "task.input" && event.state === "cancelled") {
        setError("补充指令尚未执行，任务已停止。请重新发送。");
        refresh();
      } else if (
        event.type === "session.updated" ||
        event.type === "task.state" ||
        event.type === "task.input"
      ) {
        if (event.type === "task.state" && !event.running) setActivity("");
        refresh();
      }
    });
    return () => {
      controller.abort();
      closeContext();
      closeEvents();
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current.clear();
    };
  }, [sessionId]);

  useEffect(() => {
    if (open) prompt.current?.focus();
  }, [open]);
  useEffect(() => {
    if (log.current !== null) log.current.scrollTop = log.current.scrollHeight;
  }, [snapshot, deltas, open]);

  function draft(value: string): void {
    setText(value);
    try {
      if (value === "") localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      /* The live draft remains usable. */
    }
  }

  async function attach(selected: File[]): Promise<void> {
    if (files.length + selected.length > 10) {
      setError("每条消息最多添加 10 个文件。");
      return;
    }
    setUploading(true);
    setError(null);
    const signal = lifetime.current?.signal;
    try {
      for (const file of selected) {
        const resource = await transport.resources.upload(file, file.name, { signal });
        // Read through the host reference, so previews exercise the same binary channel.
        const content = await transport.resources.read(resource.id, { signal });
        if (signal?.aborted) return;
        const attached: AttachedFile = { resource };
        if (
          ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
            resource.mediaType,
          )
        ) {
          attached.url = URL.createObjectURL(
            new Blob([content.data], { type: resource.mediaType }),
          );
          urls.current.add(attached.url);
        } else if (
          resource.mediaType.startsWith("text/") ||
          /\.(?:md|txt|json|csv)$/i.test(resource.name)
        ) {
          attached.text = new TextDecoder().decode(content.data.slice(0, 8_000));
        }
        setFiles((current) => [...current, attached]);
      }
    } catch (cause) {
      if (!signal?.aborted)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!signal?.aborted) setUploading(false);
    }
  }

  async function send(): Promise<void> {
    if (
      busy ||
      uploading ||
      !connected ||
      snapshot === null ||
      (text.trim() === "" && files.length === 0)
    )
      return;
    setBusy(true);
    setError(null);
    const signal = lifetime.current?.signal;
    try {
      const context = await prepare();
      const input = {
        text,
        context,
        attachments: files.map((file) => file.resource.id),
      };
      if (running) await transport.agent.steer(input, { signal });
      else await transport.agent.send(input, { signal });
      if (signal?.aborted) return;
      draft("");
      for (const file of files)
        if (file.url !== undefined) {
          URL.revokeObjectURL(file.url);
          urls.current.delete(file.url);
        }
      setFiles([]);
      setSnapshot(await transport.agent.read({ signal }));
    } catch (cause) {
      if (!signal?.aborted)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }

  const messages = (snapshot?.entries ?? [])
    .filter(
      (entry) =>
        entry.type === "message" &&
        (entry.role === "user" || entry.role === "assistant"),
    )
    .slice(-8);
  const persisted = new Set(messages.map((entry) => entry.id));
  return (
    <section className="canvas-ai" aria-label="画布 AI" hidden={!open}>
      <header className="canvas-ai-header">
        <strong>Prism AI</strong>
        <span>当前会话</span>
        <Button className="canvas-button" aria-label="关闭画布 AI" onClick={onClose}>
          <X size={16} />
        </Button>
      </header>
      <div
        className="canvas-ai-log"
        ref={log}
        role="log"
        aria-label="画布 AI 对话"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <p className="canvas-ai-hint">
            描述你想画什么，或选中元素后提出修改要求。Prism 会读取并更新这张画布。
          </p>
        ) : null}
        {messages.map((entry) =>
          entry.type === "message" ? (
            <div key={entry.id} className={`canvas-ai-message ${entry.role}`}>
              <strong>{entry.role === "user" ? "你" : "Prism"}</strong>
              <p>{entry.content}</p>
              {entry.attachments?.map((file) => (
                <small key={file.id}>{file.name} </small>
              ))}
            </div>
          ) : null,
        )}
        {Object.entries(deltas)
          .filter(([id]) => !persisted.has(id))
          .map(([id, value]) => (
            <div key={id} className="canvas-ai-message assistant">
              <strong>Prism</strong>
              <p>{value}</p>
            </div>
          ))}
        {(snapshot?.pending ?? []).map((item) => (
          <p key={item.entryId} className="canvas-ai-hint">
            补充指令已排队，将在当前步骤结束后处理。
          </p>
        ))}
      </div>
      <p className="canvas-ai-state" role="status">
        {!connected
          ? "连接已断开，正在重连…"
          : snapshot === null
            ? "正在同步会话…"
            : snapshot.approvals.length > 0
              ? "请在会话中确认待审批操作。"
              : running
                ? activity || "Prism 正在处理，可继续补充要求…"
                : "已连接 Prism，可直接修改当前画布"}
      </p>
      {error === null ? null : (
        <p role="alert" className="canvas-ai-error">
          {error}
        </p>
      )}
      <form
        className="canvas-ai-form"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        {files.length > 0 ? (
          <ul className="canvas-ai-files" aria-label="画布 AI 附件">
            {files.map((file) => (
              <li key={file.resource.id}>
                {file.url === undefined ? null : (
                  <img src={file.url} alt={file.resource.name} />
                )}
                <span>{file.resource.name}</span>
                {file.text === undefined ? null : (
                  <details>
                    <summary>预览内容</summary>
                    <pre>{file.text}</pre>
                  </details>
                )}
                <Button
                  className="canvas-button"
                  aria-label={`移除 ${file.resource.name}`}
                  disabled={busy || uploading}
                  onClick={() => {
                    if (file.url !== undefined) {
                      URL.revokeObjectURL(file.url);
                      urls.current.delete(file.url);
                    }
                    setFiles((current) => current.filter((item) => item !== file));
                  }}
                >
                  <X size={12} />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <textarea
          ref={prompt}
          value={text}
          aria-label="向画布 AI 提问"
          placeholder="例如：画一个 Agent 工具调用流程图"
          rows={3}
          disabled={busy}
          onChange={(event) => draft(event.currentTarget.value)}
        />
        <div className="canvas-ai-actions">
          <Button
            className="canvas-button"
            aria-label="添加画布 AI 附件"
            disabled={!connected || busy || uploading || files.length >= 10}
            onClick={() => input.current?.click()}
          >
            <Paperclip size={15} />
            {uploading ? "上传中…" : "附件"}
          </Button>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            aria-label="选择画布 AI 附件"
            onChange={(event) => {
              const selected = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              void attach(selected);
            }}
          />
          {running ? (
            <Button
              className="canvas-button"
              aria-label="停止画布 AI"
              disabled={!connected || busy}
              onClick={() => {
                void transport.agent
                  .command("cancel", { signal: lifetime.current?.signal })
                  .catch((cause: unknown) =>
                    setError(cause instanceof Error ? cause.message : String(cause)),
                  );
              }}
            >
              <Square size={12} />
              停止
            </Button>
          ) : null}
          <button
            type="submit"
            className="canvas-button canvas-ai-send"
            disabled={
              !connected ||
              snapshot === null ||
              busy ||
              uploading ||
              (text.trim() === "" && files.length === 0)
            }
          >
            <Send size={14} />
            {busy ? "提交中…" : running ? "补充指令" : "发送"}
          </button>
        </div>
      </form>
    </section>
  );
}
