export interface DesktopSetupState {
  phase: "checking" | "choose" | "preparing" | "starting" | "error";
  distributions: string[];
  selected: string;
  message: string;
  detail: string;
}

export interface DesktopSetupChoice {
  distribution: string;
  installBrowser: boolean;
}

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
  updates: {
    read: () => Promise<UpdateState>;
    check: () => Promise<UpdateState>;
    download: () => Promise<UpdateState>;
    install: () => Promise<void>;
    subscribe: (listener: (state: UpdateState) => void) => () => void;
  };
}
