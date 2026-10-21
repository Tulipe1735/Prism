import type { BrowserWindow } from "electron";
import process from "node:process";
import { dialog } from "electron";
import { convertWslPath } from "../wsl-runtime.ts";

/** The native picker returns a directory in the kernel's filesystem. */
export async function selectWorkspaceDirectory(
  owner: BrowserWindow,
  distribution: string | undefined,
  currentPath: string,
): Promise<string | null> {
  const windows = process.platform === "win32";
  const wsl = windows && distribution !== undefined;
  const defaultPath = wsl
    ? currentPath.startsWith("/")
      ? await convertWslPath(distribution!, currentPath, "-w")
      : `\\\\wsl.localhost\\${distribution}\\`
    : currentPath;
  const result = await dialog.showOpenDialog(owner, {
    title: "选择工作区文件夹",
    buttonLabel: "选择工作区",
    properties: ["openDirectory"],
    ...(defaultPath === "" ? {} : { defaultPath }),
  });
  const selected = result.filePaths[0];
  if (result.canceled || selected === undefined) return null;
  if (!wsl) return selected;
  return convertWslPath(distribution!, selected, "-u");
}
