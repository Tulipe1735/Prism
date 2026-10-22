import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type { JSX } from "react";
import type { CanvasScene } from "./scene.ts";
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  Excalidraw,
  exportToBlob,
  exportToSvg,
  getSceneVersion,
  loadFromBlob,
  restore,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import { Download, Sparkles, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CanvasAgentPanel } from "./agent.tsx";
import { Button } from "./button.tsx";
import { MAX_CANVAS_BYTES } from "./scene.ts";
import { useCanvasDocument } from "./use-canvas.ts";

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH: string;
  }
}

// Fonts and styles load locally only after this view is opened.
window.EXCALIDRAW_ASSET_PATH = new URL("./", import.meta.url).href;
let styles: Promise<void> | undefined;
function loadStyles(): Promise<void> {
  styles ??= new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL("./excalidraw.css", import.meta.url).href;
    link.onload = () => resolve();
    link.onerror = () => {
      styles = undefined;
      link.remove();
      reject(new Error("无法加载画布样式，请重新打开工作台。"));
    };
    document.head.append(link);
  });
  return styles;
}

export interface CanvasProps {
  sessionId: string | null;
  revision: number;
  connected: boolean;
}

export default function Canvas(props: CanvasProps): JSX.Element {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void loadStyles()
      .then(() => live && setReady(true))
      .catch((cause: Error) => {
        if (live) setError(cause.message);
      });
    return () => {
      live = false;
    };
  }, []);
  if (props.sessionId === null)
    return (
      <p className="canvas-loading">先创建或打开一个会话。每个会话都有独立的画布。</p>
    );
  if (!ready)
    return (
      <p className="canvas-loading" role="status">
        {error ?? "正在加载画布…"}
      </p>
    );
  return <CanvasEditor key={props.sessionId} {...props} sessionId={props.sessionId} />;
}

function fingerprint(
  elements: readonly ExcalidrawElement[],
  state: Partial<AppState>,
): string {
  return `${getSceneVersion(elements)}:${state.viewBackgroundColor}:${state.gridSize}:${state.gridModeEnabled}`;
}

/** Construct programmatic text with the SDK before restore filters zero sizes. */
function restoreScene(
  scene: Parameters<typeof restore>[0],
): ReturnType<typeof restore> {
  const elements = (scene?.elements ?? []).map((element) => {
    if (
      element.type !== "text" ||
      element.isDeleted ||
      (element.width > 0 &&
        element.height > 0 &&
        element.fontSize &&
        element.fontFamily)
    )
      return element;
    const measured = convertToExcalidrawElements([element], {
      regenerateIds: false,
    })[0]!;
    return { ...measured, x: element.x, y: element.y };
  });
  return restore({ ...scene, elements }, null, null, {
    repairBindings: true,
    refreshDimensions: true,
  });
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function CanvasEditor(props: CanvasProps & { sessionId: string }): JSX.Element {
  const document = useCanvasDocument(props.sessionId, props.revision, props.connected);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [count, setCount] = useState(0);
  const [aiOpen, setAiOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const signature = useRef("");
  const restored = useMemo(
    () =>
      document.scene === null
        ? null
        : restoreScene(document.scene as unknown as Parameters<typeof restore>[0]),
    [document.scene],
  );

  useEffect(() => {
    if (api === null || restored === null) return;
    signature.current = fingerprint(restored.elements, restored.appState);
    api.addFiles(Object.values(restored.files));
    api.updateScene({
      elements: restored.elements,
      appState: {
        viewBackgroundColor: restored.appState.viewBackgroundColor,
        gridSize: restored.appState.gridSize,
        gridModeEnabled: restored.appState.gridModeEnabled,
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    api.scrollToContent(undefined, { fitToContent: true });
    setCount(restored.elements.filter((element) => !element.isDeleted).length);
  }, [api, restored]);

  function changed(
    elements: readonly ExcalidrawElement[],
    state: AppState,
    files: BinaryFiles,
  ): void {
    const next = fingerprint(elements, state);
    if (next === signature.current) return;
    signature.current = next;
    setCount(elements.filter((element) => !element.isDeleted).length);
    document.change(
      JSON.parse(serializeAsJSON(elements, state, files, "local")) as CanvasScene,
    );
  }

  async function run(action: () => Promise<void>): Promise<void> {
    setExporting(true);
    setActionError(null);
    try {
      await action();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setExporting(false);
    }
  }

  async function exportScene(format: "excalidraw" | "svg" | "png"): Promise<void> {
    if (api === null) return;
    const name = `画布-${props.sessionId.slice(0, 8)}.${format}`;
    const elements = api.getSceneElements();
    const appState = {
      ...api.getAppState(),
      exportBackground: true,
      exportEmbedScene: true,
    };
    const files = api.getFiles();
    if (format === "excalidraw") {
      download(
        new Blob([serializeAsJSON(elements, appState, files, "local")], {
          type: "application/json",
        }),
        name,
      );
    } else if (format === "svg") {
      const svg = await exportToSvg({ elements, appState, files });
      download(new Blob([svg.outerHTML], { type: "image/svg+xml" }), name);
    } else {
      download(
        await exportToBlob({ elements, appState, files, mimeType: "image/png" }),
        name,
      );
    }
  }

  async function importScene(file: File): Promise<void> {
    if (api === null) return;
    if (file.size > MAX_CANVAS_BYTES) throw new Error("画布文件不能超过 20 MB。");
    const imported = restoreScene(await loadFromBlob(file, null, null));
    signature.current = "";
    api.addFiles(Object.values(imported.files ?? {}));
    api.updateScene({ ...imported, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    api.scrollToContent(undefined, { fitToContent: true });
  }

  const labels = {
    loading: "读取中…",
    saved: "已保存",
    pending: "待保存",
    saving: "保存中…",
    error: "保存失败",
    conflict: "有未合并的修改",
  };
  return (
    <div className="canvas-root">
      <div className="canvas-toolbar">
        <Button
          variant="ghost"
          className="canvas-button"
          disabled={api === null || exporting}
          onClick={() => input.current?.click()}
        >
          <Upload size={13} aria-hidden="true" />
          导入
        </Button>
        <input
          ref={input}
          type="file"
          hidden
          accept=".excalidraw,.json,.png,.svg"
          aria-label="导入画布文件"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file !== undefined) void run(() => importScene(file));
          }}
        />
        {(["excalidraw", "svg", "png"] as const).map((format) => (
          <Button
            key={format}
            variant="ghost"
            className="canvas-button"
            disabled={
              api === null || exporting || (count === 0 && format !== "excalidraw")
            }
            onClick={() => void run(() => exportScene(format))}
          >
            <Download size={13} aria-hidden="true" />
            {format === "excalidraw" ? ".excalidraw" : format.toUpperCase()}
          </Button>
        ))}
      </div>
      {(actionError ?? document.error) ? (
        <div role="alert" className="canvas-error">
          <span>{actionError ?? document.error}</span>
          {document.status === "conflict" ? (
            <Button
              variant="ghost"
              className="canvas-button"
              disabled={exporting}
              onClick={() =>
                void run(async () => {
                  await exportScene("excalidraw");
                  await document.reload();
                })
              }
            >
              导出当前草稿并读取最新画布
            </Button>
          ) : document.status === "error" ? (
            <Button
              variant="ghost"
              className="canvas-button"
              onClick={() =>
                void run(document.scene === null ? document.reload : document.retry)
              }
            >
              重试
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="canvas-content">
        {restored === null ? (
          <p className="canvas-loading" role="status">
            正在读取会话画布…
          </p>
        ) : (
          <Excalidraw
            excalidrawAPI={setApi}
            initialData={restored}
            onChange={changed}
            langCode="zh-CN"
            renderTopRightUI={() => (
              <Button
                className="canvas-ai-toggle"
                aria-label="画布 AI"
                aria-expanded={aiOpen}
                onClick={() => setAiOpen((value) => !value)}
              >
                <Sparkles size={17} aria-hidden="true" />
                AI
              </Button>
            )}
            UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false } }}
          />
        )}
        <CanvasAgentPanel
          sessionId={props.sessionId}
          connected={props.connected}
          open={aiOpen}
          onClose={() => setAiOpen(false)}
          prepare={async () => {
            await document.save();
            const selected = Object.keys(api?.getAppState().selectedElementIds ?? {});
            return `从 Excalidraw 画布面板发来的请求。请先用 excalidraw_read 读取当前会话画布，再按需求用 excalidraw_update 修改，保留未涉及的内容。选中元素 ID：${JSON.stringify(selected)}。`;
          }}
        />
      </div>
      <p
        data-canvas-status
        data-save-state={document.status}
        role="status"
        className="canvas-status"
      >
        {api === null
          ? "画布加载中…"
          : `${count} 个元素 · ${labels[document.status]} · 可在对话中让 Agent 读取和修改画布`}
      </p>
    </div>
  );
}
