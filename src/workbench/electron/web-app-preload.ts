import type { NativeAppBridge } from "../../../packages/plugin-sdk/src/index.ts";
import { contextBridge, ipcRenderer } from "electron";

const bridge: NativeAppBridge = {
  send: (message) => ipcRenderer.send("prism:web-app:message", message),
  subscribe: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, message: unknown): void =>
      listener(message);
    ipcRenderer.on("prism:web-app:message", receive);
    return () => ipcRenderer.removeListener("prism:web-app:message", receive);
  },
};
contextBridge.exposeInMainWorld("prismNativeApp", bridge);
