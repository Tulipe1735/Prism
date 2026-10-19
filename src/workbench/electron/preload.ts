import type {
  DesktopApi,
  DesktopSetupApi,
  DesktopSetupState,
  UpdateState,
} from "./desktop-contract.ts";
import { exposeClerkBridge } from "@clerk/electron/preload";
import { contextBridge, ipcRenderer } from "electron";
import { VERSION } from "../../shared/version.ts";
import { CLERK_PUBLISHABLE_KEY } from "./identity-config.ts";

exposeClerkBridge();

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

const desktop: DesktopApi = {
  version: VERSION,
  clerkPublishableKey: CLERK_PUBLISHABLE_KEY,
  updates: {
    read: () => ipcRenderer.invoke("prism:updates:read"),
    check: () => ipcRenderer.invoke("prism:updates:check"),
    download: () => ipcRenderer.invoke("prism:updates:download"),
    install: () => ipcRenderer.invoke("prism:updates:install"),
    subscribe: (listener) => {
      const receive = (_event: Electron.IpcRendererEvent, state: UpdateState): void =>
        listener(state);
      ipcRenderer.on("prism:updates:state", receive);
      return () => ipcRenderer.removeListener("prism:updates:state", receive);
    },
  },
};
contextBridge.exposeInMainWorld("prismDesktop", desktop);
