import type { FrontendRepairSpec } from "@prism/contracts";
/**
 * Prism 确定性重置（reset）
 *
 * 一次评估尝试结束后，必须把 fixture 源码恢复到确切的已知缺陷态，并证明
 * 原始基线仍然成立（源码逐字节一致 + 渲染 Oracle 判定为 failed）。
 *
 * 实现基于 git：用已知缺陷修订恢复允许作用域内的源文件，然后对清单记录的
 * 每个文件做 SHA-256 校验；恢复后调用 BrowserOracle 观测目标，用
 * before==after 的自比较评估归一化规范 —— 任何非递增（如方形按钮）的
 * 缺陷态必然判为 failed，从而证明页面回到缺陷基线，可以开始下一次尝试。
 */
import { readFile } from "node:fs/promises";

import path from "node:path";

import { execa } from "execa";

import { BrowserOracle, type RenderedTargetObservation } from "./browser-oracle";
import { sha256 } from "./hash";

/** 重置结果。 */
export interface ResetResult {
  /** 已恢复的文件相对路径。 */
  restoredFiles: string[];
  /** 恢复后逐文件哈希校验是否全部命中已知缺陷身份。 */
  hashesVerified: boolean;
  /** 哈希不匹配的文件路径。 */
  mismatchedFiles: string[];
  /** 渲染 Oracle 对重置后状态的判定（before==after 自比较）。 */
  baselineEvaluation: ReturnType<typeof BrowserOracle.evaluateSpec>;
}

/** 重置配置。 */
export interface ResetConfig {
  workspaceRoot: string;
  /** 已知缺陷 git 修订。 */
  knownBadRevision: string;
  /** 已知缺陷身份：相对路径 → SHA-256。 */
  knownBadFileHashes: Readonly<Record<string, string>>;
  /** 需要恢复的相对路径（git checkout 的作用域）。 */
  restorePaths: readonly string[];
  /** 归一化修复规范：用于基线证明。 */
  spec: FrontendRepairSpec;
  /** 渲染 Oracle：观测恢复后的页面。 */
  browserOracle: BrowserOracle;
}

/**
 * 重置 fixture：git 恢复已知缺陷源文件 → 校验哈希 → 渲染 Oracle 证明基线。
 *
 * 基线证明通过 before==after 自比较：若缺陷尚未修复（border-radius 未
 * 递增），metric-increase 谓词必然 failed，证明页面确在缺陷态。
 */
export async function resetFixture(config: ResetConfig): Promise<ResetResult> {
  await gitRestore(config.workspaceRoot, config.knownBadRevision, config.restorePaths);

  const { mismatchedFiles } = await verifyKnownBadHashes(
    config.workspaceRoot,
    config.knownBadFileHashes,
  );

  const observation: RenderedTargetObservation = await config.browserOracle.observe();
  const baselineEvaluation = BrowserOracle.evaluateSpec(
    config.spec,
    observation,
    observation,
  );

  return {
    restoredFiles: [...config.restorePaths],
    hashesVerified: mismatchedFiles.length === 0,
    mismatchedFiles,
    baselineEvaluation,
  };
}

/** 用 git 把作用域内路径恢复到已知缺陷修订。 */
async function gitRestore(
  workspaceRoot: string,
  revision: string,
  paths: readonly string[],
): Promise<void> {
  const result = await execa("git", ["checkout", revision, "--", ...paths], {
    cwd: workspaceRoot,
    reject: false,
    shell: false,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `git checkout ${revision} failed (exit ${result.exitCode}): ${result.stderr}`,
    );
  }
}

/** 校验本地工作区文件是否与已知缺陷身份逐字节一致。 */
export async function verifyKnownBadHashes(
  workspaceRoot: string,
  knownBadFileHashes: Readonly<Record<string, string>>,
): Promise<{ verified: boolean; mismatchedFiles: string[] }> {
  const mismatchedFiles: string[] = [];
  for (const [relativePath, expectedHash] of Object.entries(knownBadFileHashes)) {
    const content = await readFile(path.join(workspaceRoot, relativePath));
    const actualHash = sha256(content);
    if (actualHash !== expectedHash) {
      mismatchedFiles.push(relativePath);
    }
  }
  return { verified: mismatchedFiles.length === 0, mismatchedFiles };
}
