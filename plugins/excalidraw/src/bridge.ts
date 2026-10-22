import type { CanvasDocument, CanvasScene } from "./scene.ts";
import { PluginClient } from "@prism/plugin-sdk/client";

export const transport = new PluginClient();
export const client = {
  readCanvas: (_sessionId: string): Promise<CanvasDocument> =>
    transport.request("canvas.read"),
  saveCanvas: (
    _sessionId: string,
    revision: number,
    scene: CanvasScene,
  ): Promise<CanvasDocument> => transport.request("canvas.save", { revision, scene }),
};
