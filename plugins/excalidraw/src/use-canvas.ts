import type { CanvasDocument, CanvasScene } from "./scene.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "./bridge.ts";

export type CanvasSaveState =
  "loading" | "saved" | "pending" | "saving" | "error" | "conflict";

interface CanvasEditorDocument {
  scene: CanvasScene | null;
  status: CanvasSaveState;
  error: string | null;
  change: (scene: CanvasScene) => void;
  retry: () => Promise<void>;
  reload: () => Promise<void>;
  save: () => Promise<void>;
}

/** One autosave writer per editor; preserve pending edits across session switches. */
export function useCanvasDocument(
  sessionId: string,
  remoteRevision: number,
  connected: boolean,
): CanvasEditorDocument {
  const [scene, setScene] = useState<CanvasScene | null>(null);
  const [status, setStatus] = useState<CanvasSaveState>("loading");
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  const pending = useRef<CanvasScene | null>(null);
  const saving = useRef(false);
  const blocked = useRef(false);
  const live = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wanted = useRef(remoteRevision);
  const refresh = useRef(() => {});
  const key = `prism.canvas.draft.${sessionId}`;

  const backup = useCallback(
    (draft: CanvasScene | null): void => {
      try {
        if (draft === null) localStorage.removeItem(key);
        else
          localStorage.setItem(
            key,
            JSON.stringify({ revision: revision.current, scene: draft }),
          );
      } catch {
        // Image drafts can exceed browser storage; the server save still runs.
      }
    },
    [key],
  );

  const flush = useCallback(async (): Promise<void> => {
    if (saving.current || pending.current === null || blocked.current) return;
    saving.current = true;
    if (live.current) setStatus("saving");
    try {
      while (pending.current !== null && !blocked.current) {
        const draft: CanvasScene = pending.current;
        const saved = await client.saveCanvas(sessionId, revision.current, draft);
        revision.current = saved.revision;
        if (pending.current === draft) pending.current = null;
        backup(pending.current);
      }
      if (live.current) {
        setStatus("saved");
        setError(null);
      }
    } catch (cause) {
      blocked.current = true;
      if (live.current) {
        setStatus(
          cause instanceof Error && "code" in cause && cause.code === "CANVAS_CONFLICT"
            ? "conflict"
            : "error",
        );
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      saving.current = false;
      if (live.current && wanted.current > revision.current && !blocked.current)
        refresh.current();
    }
  }, [backup, client, sessionId]);

  useEffect(() => {
    if (!connected) return;
    live.current = true;
    let disposed = false;
    void client
      .readCanvas(sessionId)
      .then((document) => {
        if (disposed) return;
        revision.current = document.revision;
        blocked.current = false;
        let draft: CanvasDocument | null = null;
        try {
          draft = JSON.parse(
            localStorage.getItem(key) ?? "null",
          ) as CanvasDocument | null;
        } catch {
          /* A malformed browser draft does not hide the saved scene. */
        }
        if (
          draft?.scene?.type === "excalidraw" &&
          Array.isArray(draft.scene.elements)
        ) {
          pending.current = draft.scene;
          setScene(draft.scene);
          if (draft.revision !== document.revision) {
            blocked.current = true;
            setStatus("conflict");
            setError(
              "已恢复未保存的草稿，服务器画布也有更新。请导出草稿后读取最新画布。",
            );
          } else {
            setStatus("pending");
            void flush();
          }
        } else {
          setScene(document.scene);
          setStatus("saved");
        }
      })
      .catch((cause: unknown) => {
        if (!disposed) {
          setStatus("error");
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      if (pending.current !== null) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      disposed = true;
      live.current = false;
      clearTimeout(timer.current);
      window.removeEventListener("beforeunload", beforeUnload);
      void flush();
    };
  }, [client, connected, flush, key, sessionId]);

  useEffect(() => {
    wanted.current = remoteRevision;
    if (scene === null || !connected) return;
    let disposed = false;
    const reload = (): void => {
      if (saving.current || blocked.current || pending.current !== null) return;
      void client
        .readCanvas(sessionId)
        .then((document) => {
          if (disposed || saving.current || blocked.current || pending.current !== null)
            return;
          if (document.revision > revision.current) {
            revision.current = document.revision;
            setScene(document.scene);
            setStatus("saved");
            setError(null);
          }
        })
        .catch((cause: unknown) => {
          if (!disposed)
            setError(cause instanceof Error ? cause.message : String(cause));
        });
    };
    refresh.current = reload;
    reload();
    return () => {
      disposed = true;
      refresh.current = () => {};
    };
  }, [client, connected, remoteRevision, scene, sessionId]);

  const change = useCallback(
    (next: CanvasScene): void => {
      pending.current = next;
      backup(next);
      if (!blocked.current) setStatus("pending");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 350);
    },
    [backup, flush],
  );

  async function retry(): Promise<void> {
    blocked.current = false;
    await flush();
  }
  async function reload(): Promise<void> {
    if (saving.current) return;
    const document = await client.readCanvas(sessionId);
    pending.current = null;
    backup(null);
    blocked.current = false;
    revision.current = document.revision;
    setScene(document.scene);
    setStatus("saved");
    setError(null);
  }
  async function save(): Promise<void> {
    // An in-flight autosave must finish before the Agent reads this scene.
    while (saving.current) await new Promise((resolve) => setTimeout(resolve, 25));
    await flush();
    if (pending.current !== null || blocked.current)
      throw new Error("请先处理画布保存错误或冲突，再发送给 AI。");
  }
  return { scene, status, error, change, retry, reload, save };
}
