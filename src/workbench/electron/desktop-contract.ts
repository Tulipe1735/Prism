export interface DesktopSetupState {
  phase: "checking" | "choose" | "preparing" | "starting" | "error";
  distributions: string[];
  selected: string;
  mode: "native" | "wsl";
  message: string;
  detail: string;
}

export type DesktopSetupChoice = { installBrowser: boolean } & (
  { mode: "native" } | { mode: "wsl"; distribution: string }
);

export interface DesktopSetupApi {
  read: () => Promise<DesktopSetupState>;
  prepare: (choice: DesktopSetupChoice) => Promise<void>;
  subscribe: (listener: (state: DesktopSetupState) => void) => () => void;
  openWslGuide: () => Promise<void>;
}

export interface UpdateState {
  phase:
    | "idle"
    | "checking"
    | "current"
    | "available"
    | "downloading"
    | "downloaded"
    | "error"
    | "unsupported";
  version: string;
  latestVersion?: string;
  percent?: number;
  message?: string;
}

export interface DesktopApi {
  version: string;
  clerkPublishableKey: string;
  selectWorkspace: (currentPath: string) => Promise<string | null>;
  updates: {
    read: () => Promise<UpdateState>;
    check: () => Promise<UpdateState>;
    download: () => Promise<UpdateState>;
    install: () => Promise<void>;
    subscribe: (listener: (state: UpdateState) => void) => () => void;
  };
}
