/**
 * 服务端工作区策略
 *
 * 提供"当前配置工作区"的解析与判定：从环境变量 PRISM_WORKSPACE_PATH
 * 读取（未设置时回退到仓库根目录），并用于判断某个 Run 是否落在
 * 已配置的工作区内。比较时统一分隔符并做大小写归一化（Windows）。
 */
import type { LocalWorkspace } from "@prism/contracts";

import path from "node:path";
import process from "node:process";

/** 匹配 Windows 盘符绝对路径（如 C:\ 或 C:/）。 */
const windowsAbsolutePathPattern = /^[A-Z]:[\\/]/i;

/** 从工作区路径取展示名（按平台分隔符取 basename）。 */
function displayNameFor(workspacePath: string) {
  return windowsAbsolutePathPattern.test(workspacePath)
    ? path.win32.basename(workspacePath)
    : path.posix.basename(workspacePath);
}

/**
 * 归一化路径用于比较：统一 "/" 分隔、去掉末尾斜杠，
 * Windows 路径再做小写化（大小写不敏感比较）。
 */
function normalizeForComparison(workspacePath: string) {
  const normalized = workspacePath.replaceAll("\\", "/").replace(/\/+$/, "");

  return windowsAbsolutePathPattern.test(workspacePath)
    ? normalized.toLocaleLowerCase("en-US")
    : normalized;
}

/**
 * 获取当前配置的工作区。
 *
 * 优先读 PRISM_WORKSPACE_PATH；未配置时回退到进程工作目录的上级目录
 * （仓库根）。displayName 取路径 basename，缺省用 "workspace"。
 */
export function getConfiguredWorkspace(): LocalWorkspace {
  const configuredPath = process.env.PRISM_WORKSPACE_PATH?.trim();
  const workspacePath =
    configuredPath && configuredPath.length > 0
      ? configuredPath
      : path.resolve(process.cwd(), "../..");

  return {
    kind: "local",
    path: workspacePath,
    displayName: displayNameFor(workspacePath) || "workspace",
  };
}

/** 判断给定工作区是否等于当前配置的工作区（归一化后比较）。 */
export function isConfiguredWorkspace(workspace: LocalWorkspace) {
  const configuredWorkspace = getConfiguredWorkspace();

  return (
    workspace.kind === configuredWorkspace.kind &&
    normalizeForComparison(workspace.path) ===
      normalizeForComparison(configuredWorkspace.path)
  );
}
