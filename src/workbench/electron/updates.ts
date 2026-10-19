import type { AppUpdater } from "electron-updater";
import type { UpdateState } from "./desktop-contract.ts";

export interface DesktopUpdates {
  read: () => UpdateState;
  check: () => Promise<UpdateState>;
  download: () => Promise<UpdateState>;
  install: () => void;
}

export function createDesktopUpdates({
  updater,
  version,
  publish,
}: {
  updater: AppUpdater | null;
  version: string;
  publish: (state: UpdateState) => void;
}): DesktopUpdates {
  let state: UpdateState = {
    phase: updater === null ? "unsupported" : "idle",
    version,
  };
  const update = (patch: Omit<UpdateState, "version">): void => {
    state = { version, ...patch };
    publish(state);
  };
  if (updater !== null) {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.on("checking-for-update", () => update({ phase: "checking" }));
    updater.on("update-available", (info) =>
      update({ phase: "available", latestVersion: info.version }),
    );
    updater.on("update-not-available", () => update({ phase: "current" }));
    updater.on("download-progress", (progress) =>
      update({
        phase: "downloading",
        latestVersion: state.latestVersion,
        percent: Math.min(100, Math.max(0, Math.round(progress.percent))),
      }),
    );
    updater.on("update-downloaded", (info) =>
      update({ phase: "downloaded", latestVersion: info.version }),
    );
    updater.on("error", () =>
      update({ phase: "error", message: "更新失败，请检查网络后重试。" }),
    );
  }

  return {
    read: (): UpdateState => state,
    async check(): Promise<UpdateState> {
      if (
        updater === null ||
        state.phase === "checking" ||
        state.phase === "downloading" ||
        state.phase === "downloaded"
      )
        return state;
      update({ phase: "checking" });
      try {
        await updater.checkForUpdates();
      } catch {
        update({ phase: "error", message: "检查更新失败，请检查网络后重试。" });
      }
      return state;
    },
    async download(): Promise<UpdateState> {
      if (updater === null || state.phase !== "available") return state;
      update({ phase: "downloading", latestVersion: state.latestVersion, percent: 0 });
      try {
        await updater.downloadUpdate();
      } catch {
        update({ phase: "error", message: "下载更新失败，请检查网络后重试。" });
      }
      return state;
    },
    install(): void {
      if (updater === null || state.phase !== "downloaded")
        throw new Error("请先下载更新。");
      updater.quitAndInstall(true, true);
    },
  };
}
