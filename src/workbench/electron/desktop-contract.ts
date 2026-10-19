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
