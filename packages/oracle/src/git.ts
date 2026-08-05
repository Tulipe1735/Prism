import path from "node:path";

import { execa } from "execa";

/** 解析工作区所在 git 仓库的根目录（绝对路径）。 */
export async function gitRepoRoot(workspaceRoot: string): Promise<string> {
  const result = await execa("git", ["rev-parse", "--show-toplevel"], {
    cwd: workspaceRoot,
    reject: false,
    shell: false,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `Unable to resolve the git repository root from ${workspaceRoot} (git exit ${result.exitCode}).`,
    );
  }
  return result.stdout.trim();
}

/**
 * 把 git 仓库相对路径换算成相对 workspaceRoot 的路径。
 *
 * fixture 工作区通常嵌套在仓库里（如 fixtures/react-repair），git 输出
 * 的是仓库相对路径；换算后以工作区为基准，供作用域判定与哈希校验使用。
 */
export function toWorkspaceRelativePath(
  workspaceRoot: string,
  repoRoot: string,
  repoRelativePath: string,
): string {
  const absolute = path.join(repoRoot, repoRelativePath);
  return path.relative(workspaceRoot, absolute);
}

/**
 * 把相对 workspaceRoot 的路径换算成 git 仓库相对路径。
 *
 * git show <rev>:<path> 需要仓库相对路径；工作区通常嵌套在仓库内。
 */
export function toRepoRelativePath(
  workspaceRoot: string,
  repoRoot: string,
  workspaceRelativePath: string,
): string {
  const absolute = path.join(workspaceRoot, workspaceRelativePath);
  return path.relative(repoRoot, absolute);
}
