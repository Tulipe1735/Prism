import type { DesktopSetupApi, DesktopSetupState } from "./desktop-contract.ts";
import { contextBridge, ipcRenderer } from "electron";

const setup: DesktopSetupApi = {
  read: () => ipcRenderer.invoke("prism:setup:read"),
  prepare: (choice) => ipcRenderer.invoke("prism:setup:prepare", choice),
  openWslGuide: () => ipcRenderer.invoke("prism:setup:wsl-guide"),
  subscribe: (listener) => {
    const receive = (
      _event: Electron.IpcRendererEvent,
      state: DesktopSetupState,
    ): void => listener(state);
    ipcRenderer.on("prism:setup:state", receive);
    return () => {
      ipcRenderer.removeListener("prism:setup:state", receive);
    };
  },
};

contextBridge.exposeInMainWorld("prismSetup", setup);
