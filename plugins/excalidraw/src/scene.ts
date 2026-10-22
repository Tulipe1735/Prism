/** Standard Excalidraw JSON; element defaults are restored by Excalidraw itself. */
export interface CanvasScene {
  type: "excalidraw";
  version: 2;
  source: string;
  elements: Record<string, unknown>[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

export interface CanvasDocument {
  revision: number;
  scene: CanvasScene;
}

export const MAX_CANVAS_BYTES = 20 * 1024 * 1024;

export function emptyCanvasScene(): CanvasScene {
  return {
    type: "excalidraw",
    version: 2,
    source: "Prism",
    elements: [],
    appState: { viewBackgroundColor: "#ffffff" },
    files: {},
  };
}
