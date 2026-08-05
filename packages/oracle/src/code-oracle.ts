import type { WorkspaceCommand } from "@prism/contracts";

import { execa } from "execa";

import { gitRepoRoot, toWorkspaceRelativePath } from "./git";

/**
 * Prism 编码 Oracle（code-oracle）
 *
 * 编码侧权威判定：一次修复必须产生"作用域内"的源码变更，并且 fixture 的
 * 构建与相关测试都必须通过。它不要求任何具体实现 —— 只要 diff 落在
 * 允许作用域内、构建成功、相关测试通过即可。
 *
 * 设计：
 *  - isDiffScoped() 是纯函数：检查变更文件清单是否全部落在允许作用域；
 *  - CodeOracle.verify() 组合 git 差异检查与 build/test 命令执行，
 *    命令执行通过可注入的 runner 抽象（测试用确定性 fake）。
 *
 * 差异基准是已知缺陷 git 修订：修复是相对该基线的未提交工作区变更。
 */

/** 单条命令执行结果（runner 返回）。 */
export interface CommandOutcome {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/** 命令执行抽象：生产用 execa，测试用确定性 fake。 */
export interface CommandRunner {
  run: (
    command: WorkspaceCommand,
    cwd: string,
    timeoutMs?: number,
  ) => Promise<CommandOutcome>;
}

/** execa 实现的命令 runner。 */
export const execaCommandRunner: CommandRunner = {
  async run(command, cwd, timeoutMs = 120_000) {
    const result = await execa(command.executable, command.arguments, {
      cwd,
      reject: false,
      shell: false,
      timeout: timeoutMs,
    });
    return {
      exitCode: result.exitCode ?? null,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  },
};

/** 编码 Oracle 配置。 */
export interface CodeOracleConfig {
  workspaceRoot: string;
  /** 修复允许触碰的相对路径作用域（目录前缀或精确文件）。 */
  scopedPaths: readonly string[];
  buildCommand: WorkspaceCommand;
  testCommand: WorkspaceCommand;
  /** 已知缺陷 git 修订：差异基准。 */
  knownBadRevision: string;
  /** 默认 120s 超时。 */
  commandTimeoutMs?: number;
  runner?: CommandRunner;
  /** 生产用 execa 读取 git 差异；测试可注入确定性实现。 */
  diff?: (workspaceRoot: string, knownBadRevision: string) => Promise<string[]>;
}

/** 编码 Oracle 判定结果。 */
export interface CodeOracleResult {
  passed: boolean;
  /** 每条失败原因；passed 时为空。 */
  issues: string[];
  /** 相对 knownBadRevision 的变更文件清单。 */
  changedFiles: string[];
  build: CommandOutcome;
  test: CommandOutcome;
}

/**
 * 判断一份变更文件是否落在允许作用域内。
 *
 * scopedPaths 中的每一项既可以是精确文件路径，也可以是目录前缀
 * （目录前缀必须以 "/" 结尾）；目录前缀按 startsWith 匹配。
 */
export function isPathInScope(
  relativePath: string,
  scopedPaths: readonly string[],
): boolean {
  return scopedPaths.some((scoped) => {
    if (scoped.endsWith("/")) {
      return relativePath.startsWith(scoped);
    }
    return relativePath === scoped;
  });
}

/**
 * 纯函数：整份 diff 是否全部落在允许作用域内。
 *
 * 空 diff（无变更）判定为失败 —— Oracle 要求确有源码变更。
 */
export function isDiffScoped(
  changedFiles: readonly string[],
  scopedPaths: readonly string[],
): { scoped: boolean; outOfScope: string[] } {
  const outOfScope = changedFiles.filter(
    (changed) => !isPathInScope(changed, scopedPaths),
  );
  const hasChanges = changedFiles.length > 0;
  return { scoped: hasChanges && outOfScope.length === 0, outOfScope };
}

/** execa 实现的 git 差异读取：相对 knownBadRevision 的工作区变更清单。 */
export async function gitDiffChangedFiles(
  workspaceRoot: string,
  knownBadRevision: string,
): Promise<string[]> {
  const result = await execa(
    "git",
    ["diff", "--name-only", "--no-ext-diff", knownBadRevision],
    {
      cwd: workspaceRoot,
      reject: false,
      shell: false,
    },
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `Unable to diff the workspace against ${knownBadRevision} (git exit ${result.exitCode}).`,
    );
  }
  const repoRoot = await gitRepoRoot(workspaceRoot);
  return (
    result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      // git 输出仓库相对路径；换算成工作区相对路径供作用域判定
      .map((repoRelative) =>
        toWorkspaceRelativePath(workspaceRoot, repoRoot, repoRelative),
      )
  );
}

/**
 * 编码 Oracle：校验作用域 diff + 构建成功 + 相关测试通过。
 */
export class CodeOracle {
  private readonly runner: CommandRunner;
  private readonly diff: (
    workspaceRoot: string,
    knownBadRevision: string,
  ) => Promise<string[]>;
  private readonly timeoutMs: number;

  constructor(private readonly config: CodeOracleConfig) {
    this.runner = config.runner ?? execaCommandRunner;
    this.diff = config.diff ?? gitDiffChangedFiles;
    this.timeoutMs = config.commandTimeoutMs ?? 120_000;
  }

  /**
   * 运行一次完整校验：读取 git diff → 作用域判定 → 构建 → 测试。
   */
  async verify(): Promise<CodeOracleResult> {
    const changedFiles = await this.diff(
      this.config.workspaceRoot,
      this.config.knownBadRevision,
    );
    const scope = isDiffScoped(changedFiles, this.config.scopedPaths);
    const build = await this.runner.run(
      this.config.buildCommand,
      this.config.workspaceRoot,
      this.timeoutMs,
    );
    const test = await this.runner.run(
      this.config.testCommand,
      this.config.workspaceRoot,
      this.timeoutMs,
    );

    const issues: string[] = [];
    if (!scope.scoped) {
      issues.push(
        scope.outOfScope.length === 0
          ? "The repair produced no source changes."
          : `The repair changed files outside the allowed scope: ${scope.outOfScope.join(", ")}.`,
      );
    }
    if (build.exitCode !== 0) {
      issues.push(`The fixture build failed (exit ${build.exitCode}).`);
    }
    if (test.exitCode !== 0) {
      issues.push(`The relevant tests failed (exit ${test.exitCode}).`);
    }

    return {
      passed: issues.length === 0,
      issues,
      changedFiles,
      build,
      test,
    };
  }
}
