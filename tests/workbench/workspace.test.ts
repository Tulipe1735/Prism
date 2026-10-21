import type { BrowserWindow } from "electron";
import { afterEach, expect, it, vi } from "vitest";
import { selectWorkspaceDirectory } from "../../src/workbench/electron/workspace.ts";

const { platform, showOpenDialog, convertWslPath } = vi.hoisted(() => ({
  platform: { platform: "win32" },
  showOpenDialog: vi.fn(),
  convertWslPath: vi.fn(),
}));
vi.mock("node:process", () => ({ default: platform }));
vi.mock("electron", () => ({ dialog: { showOpenDialog } }));
vi.mock("../../src/workbench/wsl-runtime.ts", () => ({ convertWslPath }));

const owner = { id: 1 } as BrowserWindow;
afterEach(() => {
  platform.platform = "win32";
  vi.resetAllMocks();
});

it("opens the native directory picker at the current workspace and converts its selection", async () => {
  convertWslPath
    .mockResolvedValueOnce("\\\\wsl.localhost\\Ubuntu\\home\\demo\\app")
    .mockResolvedValueOnce("/home/demo/项目 with spaces");
  showOpenDialog.mockResolvedValue({
    canceled: false,
    filePaths: ["\\\\wsl.localhost\\Ubuntu\\home\\demo\\项目 with spaces"],
  });
  expect(await selectWorkspaceDirectory(owner, "Ubuntu", "/home/demo/app")).toBe(
    "/home/demo/项目 with spaces",
  );
  expect(showOpenDialog).toHaveBeenCalledWith(owner, {
    title: "选择工作区文件夹",
    buttonLabel: "选择工作区",
    properties: ["openDirectory"],
    defaultPath: "\\\\wsl.localhost\\Ubuntu\\home\\demo\\app",
  });
  expect(convertWslPath.mock.calls).toEqual([
    ["Ubuntu", "/home/demo/app", "-w"],
    ["Ubuntu", "\\\\wsl.localhost\\Ubuntu\\home\\demo\\项目 with spaces", "-u"],
  ]);
});

it("starts in the selected WSL distribution and accepts a Windows directory", async () => {
  showOpenDialog.mockResolvedValue({
    canceled: false,
    filePaths: ["C:\\Users\\demo\\project"],
  });
  convertWslPath.mockResolvedValue("/mnt/c/Users/demo/project");
  expect(await selectWorkspaceDirectory(owner, "Ubuntu", "")).toBe(
    "/mnt/c/Users/demo/project",
  );
  expect(showOpenDialog.mock.calls[0]?.[1].defaultPath).toBe(
    "\\\\wsl.localhost\\Ubuntu\\",
  );
  expect(convertWslPath).toHaveBeenCalledWith(
    "Ubuntu",
    "C:\\Users\\demo\\project",
    "-u",
  );
});

it("returns no workspace when the native picker is canceled", async () => {
  showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
  expect(await selectWorkspaceDirectory(owner, "Ubuntu", "")).toBeNull();
  expect(convertWslPath).not.toHaveBeenCalled();
});

it("reports an inaccessible selection instead of opening the wrong workspace", async () => {
  showOpenDialog.mockResolvedValue({
    canceled: false,
    filePaths: ["\\\\wsl.localhost\\Other\\home\\demo"],
  });
  convertWslPath.mockRejectedValue(new Error("该目录无法在当前 WSL 中访问"));
  await expect(selectWorkspaceDirectory(owner, "Ubuntu", "")).rejects.toThrow(
    "该目录无法在当前 WSL 中访问",
  );
});

it("uses Windows paths directly for the native kernel without invoking WSL", async () => {
  showOpenDialog.mockResolvedValue({
    canceled: false,
    filePaths: ["C:\\Users\\demo\\项目"],
  });
  expect(await selectWorkspaceDirectory(owner, undefined, "C:\\Users\\demo\\app")).toBe(
    "C:\\Users\\demo\\项目",
  );
  expect(showOpenDialog.mock.calls[0]?.[1].defaultPath).toBe("C:\\Users\\demo\\app");
  expect(convertWslPath).not.toHaveBeenCalled();
});

it("uses native paths directly when the desktop and kernel share a filesystem", async () => {
  platform.platform = "linux";
  showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["/srv/project"] });
  expect(await selectWorkspaceDirectory(owner, undefined, "/home/demo/app")).toBe(
    "/srv/project",
  );
  expect(showOpenDialog.mock.calls[0]?.[1].defaultPath).toBe("/home/demo/app");
  expect(convertWslPath).not.toHaveBeenCalled();
});
