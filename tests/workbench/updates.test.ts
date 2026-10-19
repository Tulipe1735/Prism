import type { UpdateState } from "../../src/workbench/electron/desktop-contract.ts";
import { NsisUpdater } from "electron-updater";
import { expect, it, vi } from "vitest";
import {
  createDesktopUpdates,
  type DesktopUpdates,
} from "../../src/workbench/electron/updates.ts";

function fixture(supported = true): {
  updater: NsisUpdater;
  updates: DesktopUpdates;
  states: UpdateState[];
} {
  const updater = new NsisUpdater(undefined, {
    version: "0.2.2",
    name: "Prism",
    isPackaged: true,
    appUpdateConfigPath: "/unused/app-update.yml",
    userDataPath: "/unused",
    baseCachePath: "/unused",
    whenReady: async () => {},
    relaunch: () => {},
    quit: () => {},
    onQuit: () => {},
  });
  updater.logger = null;
  const states: UpdateState[] = [];
  const updates = createDesktopUpdates({
    updater: supported ? updater : null,
    version: "0.2.2",
    publish: (state) => states.push(state),
  });
  return { updater, updates, states };
}

it("requires explicit download and install, and publishes progress", async () => {
  const { updater, updates, states } = fixture();
  expect(updater.autoDownload).toBe(false);
  expect(updater.autoInstallOnAppQuit).toBe(false);
  expect(() => updates.install()).toThrow("请先下载更新");
  const check = vi.spyOn(updater, "checkForUpdates").mockImplementation(async () => {
    updater.emit("update-available", {
      version: "0.2.3",
      path: "setup.exe",
      sha512: "test-checksum",
      files: [],
      releaseDate: "2026-10-19",
    });
    return null;
  });
  const download = vi.spyOn(updater, "downloadUpdate").mockImplementation(async () => {
    updater.emit("download-progress", {
      percent: 52.4,
      total: 100,
      transferred: 52,
      delta: 52,
      bytesPerSecond: 100,
    });
    updater.emit("update-downloaded", {
      version: "0.2.3",
      path: "setup.exe",
      sha512: "test-checksum",
      files: [],
      releaseDate: "2026-10-19",
      downloadedFile: "/unused/setup.exe",
    });
    return ["/unused/setup.exe"];
  });
  const install = vi.spyOn(updater, "quitAndInstall").mockImplementation(() => {});
  await updates.check();
  expect(check).toHaveBeenCalledOnce();
  expect(updates.read()).toMatchObject({ phase: "available", latestVersion: "0.2.3" });
  expect(download).not.toHaveBeenCalled();
  await updates.download();
  expect(states).toContainEqual({
    phase: "downloading",
    version: "0.2.2",
    latestVersion: "0.2.3",
    percent: 52,
  });
  expect(updates.read().phase).toBe("downloaded");
  expect(install).not.toHaveBeenCalled();
  updates.install();
  expect(install).toHaveBeenCalledWith(true, true);
});

it("recovers from a failed check and ignores duplicate checks", async () => {
  const { updater, updates } = fixture();
  const check = vi
    .spyOn(updater, "checkForUpdates")
    .mockRejectedValueOnce(new Error("offline"));
  await updates.check();
  expect(updates.read().phase).toBe("error");
  let finish: (() => void) | undefined;
  check.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () => {
          updater.emit("update-not-available", {
            version: "0.2.2",
            path: "setup.exe",
            sha512: "test-checksum",
            files: [],
            releaseDate: "2026-10-19",
          });
          resolve(null);
        };
      }),
  );
  const pending = updates.check();
  expect(updates.read().phase).toBe("checking");
  await updates.check();
  expect(check).toHaveBeenCalledTimes(2);
  finish?.();
  await pending;
  expect(updates.read().phase).toBe("current");
});

it("never starts updates outside the packaged Windows app", async () => {
  const { updater, updates } = fixture(false);
  const check = vi.spyOn(updater, "checkForUpdates");
  const download = vi.spyOn(updater, "downloadUpdate");
  await updates.check();
  await updates.download();
  expect(updates.read().phase).toBe("unsupported");
  expect(check).not.toHaveBeenCalled();
  expect(download).not.toHaveBeenCalled();
  expect(() => updates.install()).toThrow();
});
