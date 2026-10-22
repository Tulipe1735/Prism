import type { JSX } from "react";
import type { Attachment } from "../../kernel/session.ts";
import { FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { KernelClient } from "./client.ts";

const client = new KernelClient();
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/** Text is rendered as text; active documents remain explicit downloads. */
export function AttachmentView({
  file,
  sessionId,
}: {
  file: Attachment;
  sessionId: string;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const url = client.attachmentUrl(sessionId, file.id);
  const text =
    file.mediaType.startsWith("text/") || /\.(?:md|txt|json|csv)$/i.test(file.name);
  useEffect(() => {
    if (!expanded || !text) return;
    const controller = new AbortController();
    void fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("文件读取失败。");
        const content = await response.text();
        if (!controller.signal.aborted) setPreview(content.slice(0, 8_000));
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => controller.abort();
  }, [expanded, text, url]);
  return (
    <li title={file.name} className="max-w-full rounded-md border bg-paper p-2 text-xs">
      <a
        href={url}
        download={file.name}
        className="flex items-center gap-2"
        aria-label={`下载 ${file.name}`}
      >
        {IMAGE_TYPES.has(file.mediaType) ? (
          <img
            src={url}
            alt={file.name}
            loading="lazy"
            className="max-h-36 max-w-56 rounded object-contain"
          />
        ) : (
          <FileText size={14} className="shrink-0 text-muted" aria-hidden="true" />
        )}
        <span className="truncate">{file.name}</span>
      </a>
      {text ? (
        <details onToggle={(event) => setExpanded(event.currentTarget.open)}>
          <summary className="mt-1 cursor-pointer text-muted">预览内容</summary>
          {error === null ? (
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap">
              {preview ?? "读取中…"}
            </pre>
          ) : (
            <p role="alert">{error}</p>
          )}
        </details>
      ) : null}
    </li>
  );
}
