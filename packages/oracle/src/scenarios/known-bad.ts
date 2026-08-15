import { execa } from "execa";

import { gitRepoRoot, toRepoRelativePath } from "../git";
import { sha256 } from "../hash";

/** 从指定 git 修订读取场景文件，生成稳定的已知缺陷身份。 */
export async function knownBadIdentity(
  workspaceRoot: string,
  sourceFiles: readonly string[],
  requestedRevision?: string,
): Promise<{ revision: string; fileHashes: Record<string, string> }> {
  const revisionResult = requestedRevision
    ? null
    : await execa("git", ["rev-parse", "HEAD"], {
        cwd: workspaceRoot,
        reject: false,
        shell: false,
      });
  if (revisionResult?.exitCode) {
    throw new Error("Unable to resolve the fixture's known-bad git revision.");
  }
  const revision = requestedRevision ?? revisionResult!.stdout.trim();
  const repoRoot = await gitRepoRoot(workspaceRoot);
  const fileHashes: Record<string, string> = {};

  for (const relativePath of sourceFiles) {
    const repoRelative = toRepoRelativePath(workspaceRoot, repoRoot, relativePath);
    const result = await execa("git", ["show", `${revision}:${repoRelative}`], {
      cwd: workspaceRoot,
      reject: false,
      shell: false,
      encoding: "buffer",
      stripFinalNewline: false,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `Known-bad file ${relativePath} is not committed at ${revision}.`,
      );
    }
    fileHashes[relativePath] = sha256(result.stdout);
  }

  return { revision, fileHashes };
}
