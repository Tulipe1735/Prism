/**
 * Prism 工作区执行器（workspace-executor）包
 *
 * 在受限（confined）环境内执行三类工作区操作：检查（inspect，只读读取
 * 允许列表内文件）、测试（test，运行精确允许列表内的命令）、补丁（patch，
 * 哈希守卫的局部写文件）。
 *
 * 安全模型：
 *  - 路径校验两层：词法（lexical，基于 resolve 后的字符串前缀）与
 *    实际（actual，基于 realpath 解析后的真实路径），二者都必须落在
 *    工作区内，杜绝相对路径逃逸与符号链接逃逸；
 *  - 读/发现/命令都受允许列表约束，glob 与命令参数不做通配；
 *  - 输出有上限（maxOutputBytes），内容做脱敏（redactedValues 与
 *    常见密钥格式），读取有上限（maxReadBytes），发现文件数有上限；
 *  - 拒绝/失败都会返回结构化的 WorkspaceEvidence，绝不越权。
 *
 * 所有公开入口都返回 WorkspaceEvidence（而非抛异常），便于把结果
 * 作为不可变证据直接落盘。
 */
import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  WORKSPACE_EVIDENCE_SCHEMA_VERSION,
  type WorkspaceCommand,
  type WorkspaceEvidence,
  workspaceEvidenceSchema,
  type WorkspaceRequest,
  workspaceRequestSchema,
} from "@prism/contracts";
import { execa } from "execa";
import fg from "fast-glob";
import createIgnore from "ignore";

/** 工作区证据中的拒绝原因码类型。 */
type WorkspaceReasonCode = NonNullable<WorkspaceEvidence["reasonCode"]>;
/** inspect 操作的结果详情类型。 */
type InspectDetails = Extract<WorkspaceEvidence["details"], { operation: "inspect" }>;
/** 有截断标记的文本。 */
interface BoundedText {
  text: string;
  truncated: boolean;
}
/** 有脱敏计数的文本。 */
interface RedactedText {
  text: string;
  count: number;
}
/** 既有截断标记又有脱敏计数的文本。 */
interface BoundedRedactedText extends BoundedText {
  redactionCount: number;
}
/** 一层忽略规则：某目录的 .gitignore 匹配器。 */
interface IgnoreLayer {
  directory: string;
  matcher: ReturnType<typeof createIgnore>;
}

/**
 * 仓库忽略规则：模拟 git 的分层 ignore 语义。
 *
 * 按目录叠加规则层；对一条相对路径，从外层到内层依次应用各层匹配器，
 * 后一层"取消忽略"（unignored）可覆盖前一层（类似 git 的规则优先级）。
 */
class RepositoryIgnoreRules {
  private readonly layers: IgnoreLayer[] = [];

  add(directory: string, patterns: string | readonly string[]): void {
    const matcher = createIgnore({ ignorecase: process.platform === "win32" });
    matcher.add(patterns);
    this.layers.push({ directory, matcher });
  }

  /** 判断一条工作区相对路径是否被任意规则层忽略。 */
  ignores(relativePath: string): boolean {
    let ignored = false;
    for (const layer of this.layers) {
      // 先剥掉规则层所属目录前缀，得到该层视角下的局部路径
      const localPath =
        layer.directory === ""
          ? relativePath
          : relativePath.startsWith(`${layer.directory}/`)
            ? relativePath.slice(layer.directory.length + 1)
            : null;
      if (!localPath) continue;

      const result = layer.matcher.test(localPath);
      if (result.ignored) ignored = true;
      else if (result.unignored) ignored = false;
    }
    return ignored;
  }
}

/** 一条允许执行的命令：精确命令 + 允许的工作目录集合。 */
export interface AllowedWorkspaceCommand {
  command: WorkspaceCommand;
  workingDirectories: readonly string[];
}

/** 工作区执行器的资源上限。 */
export interface WorkspaceExecutorLimits {
  /** 命令输出的最大字节数。 */
  maxOutputBytes: number;
  /** 单文件读取的最大字节数。 */
  maxReadBytes: number;
  /** 发现文件列表的最大数量。 */
  maxDiscoveredFiles: number;
}

/** 工作区执行器构造选项。 */
export interface WorkspaceExecutorOptions {
  /** 工作区根目录（会被 realpath 解析为规范路径）。 */
  workspaceRoot: string;
  /** 允许被检查（读取）的相对路径模式。 */
  allowedReadPatterns: readonly string[];
  /** 允许用于发现文件的 glob 模式集合。 */
  allowedDiscoveryPatterns: readonly string[];
  /** 允许运行的测试命令清单。 */
  allowedCommands: readonly AllowedWorkspaceCommand[];
  /** 注入命令的环境变量；未在继承白名单中的变量不会被透传。 */
  environment?: Readonly<Record<string, string>>;
  /** 需要脱敏的敏感值列表。 */
  redactedValues?: readonly string[];
  /** 资源上限（可部分覆盖默认值）。 */
  limits?: Partial<WorkspaceExecutorLimits>;
  /** 时钟注入，便于测试固定时间。 */
  clock?: () => Date;
}

/** 单次执行的附加选项。 */
export interface WorkspaceExecutionOptions {
  /** 取消信号：触发后终止正在运行的命令。 */
  signal?: AbortSignal;
}

/** 默认资源上限。 */
const DEFAULT_LIMITS: WorkspaceExecutorLimits = {
  maxOutputBytes: 32_768,
  maxReadBytes: 65_536,
  maxDiscoveredFiles: 200,
};

/** 工作区操作被策略拒绝的内部异常；携带契约化的 reasonCode。 */
class WorkspaceDeniedError extends Error {
  readonly reasonCode: WorkspaceReasonCode;

  constructor(reasonCode: WorkspaceReasonCode, message: string) {
    super(message);
    this.name = "WorkspaceDeniedError";
    this.reasonCode = reasonCode;
  }
}

/** 计算内容的 SHA-256 十六进制摘要。 */
function sha256(content: Uint8Array | string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** 判断 candidate 是否位于 root 内部（基于 path.relative 的字符串判断）。 */
function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..")
  );
}

/** 把路径分隔符统一为 POSIX "/"，用于 glob 匹配与相对路径比较。 */
function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

/** 精确比较两条命令（可执行名 + 逐参数比较），不允许通配/近似匹配。 */
function sameCommand(left: WorkspaceCommand, right: WorkspaceCommand): boolean {
  return (
    left.executable === right.executable &&
    left.arguments.length === right.arguments.length &&
    left.arguments.every((argument, index) => argument === right.arguments[index])
  );
}

/**
 * 生成给定操作的"空"详情结构。
 *
 * 用于被拒绝/非法请求的证据：此时没有真实结果，但必须返回符合
 * discriminatedUnion 的操作详情形状。
 */
function emptyDetails(
  operation: WorkspaceEvidence["operation"],
  input: unknown,
): WorkspaceEvidence["details"] {
  const candidate = input as {
    command?: WorkspaceCommand;
    workingDirectory?: string;
  };

  if (operation === "test") {
    return {
      operation,
      command: candidate.command ?? { executable: "invalid", arguments: [] },
      workingDirectory: candidate.workingDirectory ?? ".",
      exitCode: null,
      stdout: "",
      stderr: "",
      outputTruncated: false,
      redactionCount: 0,
      durationMs: 0,
    };
  }

  if (operation === "patch") {
    return { operation, files: [] };
  }

  return {
    operation,
    reads: [],
    discoveredPaths: [],
    discoveryTruncated: false,
  };
}

/**
 * 启发式判断输入是否看起来像路径穿越（".." 越级或盘符绝对路径）。
 *
 * 用于非法请求的拒绝原因归类。
 */
function looksLikeTraversal(input: unknown): boolean {
  const serialized = JSON.stringify(input);
  return /(?:^|["/\\])\.\.(?:[/\\"]|$)|[a-z]:[\\/]/i.test(serialized);
}

/**
 * 受限工作区执行器。
 *
 * 实例必须通过 create() 静态工厂创建：先 realpath 解析工作区根目录，
 * 并用 stat 确认它是已存在目录，后续所有路径判断都以该规范根为基准。
 */
export class WorkspaceExecutor {
  readonly workspaceRoot: string;
  private readonly allowedReadPatterns: readonly string[];
  private readonly allowedDiscoveryPatterns: ReadonlySet<string>;
  private readonly allowedCommands: readonly AllowedWorkspaceCommand[];
  private readonly environment: Readonly<Record<string, string>>;
  private readonly redactedValues: readonly string[];
  private readonly limits: WorkspaceExecutorLimits;
  private readonly clock: () => Date;

  private constructor(options: WorkspaceExecutorOptions, workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.allowedReadPatterns = options.allowedReadPatterns;
    this.allowedDiscoveryPatterns = new Set(options.allowedDiscoveryPatterns);
    this.allowedCommands = options.allowedCommands;
    this.environment = options.environment ?? {};
    this.redactedValues = options.redactedValues ?? [];
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.clock = options.clock ?? (() => new Date());
  }

  /**
   * 创建执行器：解析并校验工作区根目录。
   *
   * @throws TypeError 当根路径不是已存在的目录时
   */
  static async create(options: WorkspaceExecutorOptions): Promise<WorkspaceExecutor> {
    const workspaceRoot = await realpath(path.resolve(options.workspaceRoot));
    const workspaceStat = await stat(workspaceRoot);
    if (!workspaceStat.isDirectory()) {
      throw new TypeError("WorkspaceExecutor requires an existing directory root.");
    }

    return new WorkspaceExecutor(options, workspaceRoot);
  }

  /**
   * 执行一次工作区操作，返回结构化证据（不抛业务异常）。
   *
   * 流程：校验请求契约 → 检查取消 → 按操作分发（inspect/patch/test）。
   * 策略拒绝（WorkspaceDeniedError）映射为 status=denied + 具体 reasonCode；
   * 其余错误映射为 status=failed + execution_failed，且声明"未越权"。
   */
  async execute(
    input: unknown,
    executionOptions: WorkspaceExecutionOptions = {},
  ): Promise<WorkspaceEvidence> {
    const startedAt = this.clock().toISOString();
    const parsed = workspaceRequestSchema.safeParse(input);
    if (!parsed.success) {
      return this.invalidRequestEvidence(input, startedAt);
    }

    const request = parsed.data;
    if (executionOptions.signal?.aborted) {
      return this.finish(
        request,
        "cancelled",
        null,
        "The workspace request was cancelled before execution.",
        emptyDetails(request.operation, request),
        startedAt,
      );
    }

    try {
      if (request.operation === "inspect") {
        return await this.inspect(request, startedAt, executionOptions.signal);
      }
      if (request.operation === "patch") {
        return await this.patch(request, startedAt);
      }
      return await this.test(request, startedAt, executionOptions.signal);
    } catch (error) {
      if (error instanceof WorkspaceDeniedError) {
        return this.finish(
          request,
          "denied",
          error.reasonCode,
          error.message,
          emptyDetails(request.operation, request),
          startedAt,
        );
      }

      return this.finish(
        request,
        "failed",
        "execution_failed",
        "The confined workspace operation failed without widening its authority.",
        emptyDetails(request.operation, request),
        startedAt,
      );
    }
  }

  /**
   * 为不匹配契约的输入构造拒绝证据。
   *
   * 猜测操作类型与原因：形似路径穿越判 path_escape，test 类判
   * command_not_allowlisted，其余判 path_not_allowlisted。
   */
  private invalidRequestEvidence(input: unknown, startedAt: string): WorkspaceEvidence {
    const candidate = input as Partial<WorkspaceRequest>;
    const operation = ["inspect", "test", "patch"].includes(String(candidate.operation))
      ? (candidate.operation as WorkspaceEvidence["operation"])
      : "inspect";
    const reasonCode: WorkspaceReasonCode = looksLikeTraversal(input)
      ? "path_escape"
      : operation === "test"
        ? "command_not_allowlisted"
        : "path_not_allowlisted";

    return workspaceEvidenceSchema.parse({
      schemaVersion: WORKSPACE_EVIDENCE_SCHEMA_VERSION,
      requestId: candidate.requestId,
      runId: candidate.runId,
      operation,
      status: "denied",
      reasonCode,
      summary: "The workspace request did not match the confined operation contract.",
      startedAt,
      finishedAt: this.clock().toISOString(),
      details: emptyDetails(operation, input),
    });
  }

  /**
   * 检查操作：按路径读取允许列表内的文件，并按 glob 发现文件。
   *
   * 先校验发现模式在允许集合内，再加载忽略规则与允许读取文件集合；
   * 每个请求路径必须既不被忽略又在允许读取集合内，否则拒绝。
   */
  private async inspect(
    request: Extract<WorkspaceRequest, { operation: "inspect" }>,
    startedAt: string,
    signal?: AbortSignal,
  ): Promise<WorkspaceEvidence> {
    for (const pattern of request.patterns) {
      if (!this.allowedDiscoveryPatterns.has(pattern)) {
        throw new WorkspaceDeniedError(
          "pattern_not_allowlisted",
          `Discovery pattern ${pattern} is not registered for this workspace.`,
        );
      }
    }

    const ignoreRules = await this.loadIgnoreRules();
    const allowlistedFiles = new Set(
      await this.discover(this.allowedReadPatterns, ignoreRules, signal),
    );
    const reads: InspectDetails["reads"] = [];
    for (const relativePath of request.paths) {
      const actualPath = await this.resolveExistingPath(relativePath);
      if (ignoreRules.ignores(relativePath) || !allowlistedFiles.has(relativePath)) {
        throw new WorkspaceDeniedError(
          "path_not_allowlisted",
          `File ${relativePath} is not allowlisted for inspection.`,
        );
      }
      reads.push(await this.readEvidence(relativePath, actualPath));
    }

    const discovered = await this.discover(request.patterns, ignoreRules, signal);
    const discoveryTruncated = discovered.length > this.limits.maxDiscoveredFiles;
    const discoveredPaths = discovered.slice(0, this.limits.maxDiscoveredFiles);

    return this.finish(
      request,
      "succeeded",
      null,
      `Read ${reads.length} file${reads.length === 1 ? "" : "s"} and discovered ${discoveredPaths.length} file${discoveredPaths.length === 1 ? "" : "s"}.`,
      { operation: "inspect", reads, discoveredPaths, discoveryTruncated },
      startedAt,
    );
  }

  /**
   * 发现文件：用 fast-glob 按模式在工作区内列出文件，应用忽略规则。
   *
   * 强制不跟随符号链接、排除 .git/.prism/node_modules；每个命中的条目
   * 都经过 resolveExistingPath 校验真实路径仍位于工作区内。
   */
  private async discover(
    patterns: readonly string[],
    ignoreRules: RepositoryIgnoreRules,
    signal?: AbortSignal,
  ): Promise<string[]> {
    if (patterns.length === 0) return [];
    if (signal?.aborted) throw new DOMException("Discovery cancelled.", "AbortError");
    const entries = await fg([...patterns], {
      cwd: this.workspaceRoot,
      absolute: false,
      dot: true,
      followSymbolicLinks: false,
      onlyFiles: true,
      unique: true,
      ignore: [".git/**", ".prism/**", "node_modules/**"],
    });
    if (signal?.aborted) throw new DOMException("Discovery cancelled.", "AbortError");

    const results: string[] = [];
    for (const entry of entries.map(toPosixPath).sort()) {
      if (ignoreRules.ignores(entry)) continue;
      await this.resolveExistingPath(entry);
      results.push(entry);
    }
    return results;
  }

  /**
   * 加载仓库忽略规则：根 .gitignore + 各层嵌套 .gitignore。
   *
   * 内层规则目录如果自身已被忽略则跳过；嵌套文件按目录深度升序加载，
   * 保证外层先、内层后（内层可覆盖外层）。
   */
  private async loadIgnoreRules(): Promise<RepositoryIgnoreRules> {
    const rules = new RepositoryIgnoreRules();
    rules.add("", [".git/", ".prism/", "node_modules/"]);
    try {
      rules.add(
        "",
        await readFile(path.join(this.workspaceRoot, ".gitignore"), "utf8"),
      );
    } catch (error) {
      if (!this.isMissing(error)) throw error;
    }

    const nestedIgnoreFiles = await fg("**/.gitignore", {
      cwd: this.workspaceRoot,
      absolute: false,
      dot: true,
      followSymbolicLinks: false,
      onlyFiles: true,
      unique: true,
      ignore: [".git/**", ".prism/**", "node_modules/**"],
    });
    for (const ignoreFile of nestedIgnoreFiles
      .map(toPosixPath)
      .filter((ignoreFile) => ignoreFile !== ".gitignore")
      .sort((left, right) => left.split("/").length - right.split("/").length)) {
      const directory = path.posix.dirname(ignoreFile);
      if (rules.ignores(`${directory}/`)) continue;
      rules.add(
        directory,
        await readFile(path.join(this.workspaceRoot, ignoreFile), "utf8"),
      );
    }
    return rules;
  }

  /**
   * 读取单文件证据：限制读取字节数、做脱敏与截断。
   */
  private async readEvidence(
    relativePath: string,
    actualPath: string,
  ): Promise<InspectDetails["reads"][number]> {
    const fileStat = await stat(actualPath);
    if (!fileStat.isFile()) {
      throw new WorkspaceDeniedError(
        "path_not_allowlisted",
        `${relativePath} is not a regular file.`,
      );
    }

    const file = await open(actualPath, "r");
    try {
      // 多读 1 字节用于探测截断，但只返回上限内的内容
      const capture = Buffer.alloc(
        Math.min(fileStat.size, this.limits.maxReadBytes) + 1,
      );
      const { bytesRead } = await file.read(capture, 0, capture.length, 0);
      const raw = capture.subarray(0, Math.min(bytesRead, this.limits.maxReadBytes));
      const redacted = this.redact(raw.toString("utf8"));
      const bounded = this.boundText(redacted.text, this.limits.maxReadBytes);
      return {
        path: relativePath,
        byteLength: fileStat.size,
        capturedSha256: sha256(bounded.text),
        content: bounded.text,
        truncated: fileStat.size > this.limits.maxReadBytes || bounded.truncated,
        redactionCount: redacted.count,
      };
    } finally {
      await file.close();
    }
  }

  /**
   * 补丁操作：哈希守卫的局部写文件。
   *
   * 每个待改文件依次校验：未被忽略、词法与实际路径都在工作区内、
   * 不是符号链接、是常规文件；磁盘当前摘要必须等于请求中的
   * expectedSha256（不一致即 patch_conflict，防止并发修改导致覆盖失配）。
   * 全部校验通过后，先写临时文件、再逐个 rename 提交。
   */
  private async patch(
    request: Extract<WorkspaceRequest, { operation: "patch" }>,
    startedAt: string,
  ): Promise<WorkspaceEvidence> {
    const ignoreRules = await this.loadIgnoreRules();
    const prepared = [];

    for (const change of request.files) {
      if (ignoreRules.ignores(change.path)) {
        throw new WorkspaceDeniedError(
          "path_not_allowlisted",
          `File ${change.path} is excluded from workspace writes.`,
        );
      }

      const candidate = path.resolve(this.workspaceRoot, change.path);
      this.assertLexicallyInside(candidate);
      const parent = await realpath(path.dirname(candidate));
      this.assertActuallyInside(parent, "symlink_escape");

      let before: Buffer | null = null;
      try {
        const entry = await lstat(candidate);
        if (entry.isSymbolicLink()) {
          const target = await realpath(candidate);
          this.assertActuallyInside(target, "symlink_escape");
          throw new WorkspaceDeniedError(
            "symlink_escape",
            `Patch target ${change.path} is a symbolic link.`,
          );
        }
        if (!entry.isFile()) {
          throw new WorkspaceDeniedError(
            "path_not_allowlisted",
            `Patch target ${change.path} is not a regular file.`,
          );
        }
        before = await readFile(candidate);
      } catch (error) {
        if (!this.isMissing(error)) throw error;
      }

      // 哈希守卫：磁盘内容必须与检查时一致
      const beforeSha256 = before ? sha256(before) : null;
      if (beforeSha256 !== change.expectedSha256) {
        throw new WorkspaceDeniedError(
          "patch_conflict",
          `Patch target ${change.path} changed after it was inspected.`,
        );
      }
      prepared.push({ change, candidate, beforeSha256 });
    }

    // 全部校验通过后才落盘：先写临时文件，成功后逐个 rename
    const temporaryPaths: string[] = [];
    try {
      for (const item of prepared) {
        const temporaryPath = `${item.candidate}.${randomUUID()}.prism-tmp`;
        temporaryPaths.push(temporaryPath);
        await writeFile(temporaryPath, item.change.content, {
          encoding: "utf8",
          flag: "wx",
        });
      }
      for (const [index, item] of prepared.entries()) {
        await rename(temporaryPaths[index]!, item.candidate);
      }
    } finally {
      await Promise.all(
        temporaryPaths.map((temporaryPath) => rm(temporaryPath, { force: true })),
      );
    }

    const files = prepared.map(({ change, beforeSha256 }) => ({
      path: change.path,
      beforeSha256,
      afterSha256: sha256(change.content),
      byteLength: Buffer.byteLength(change.content),
    }));
    return this.finish(
      request,
      "succeeded",
      null,
      `Applied a hash-guarded patch to ${files.length} file${files.length === 1 ? "" : "s"}.`,
      { operation: "patch", files },
      startedAt,
    );
  }

  /**
   * 测试操作：运行精确允许列表内的命令，带超时/取消与输出上限。
   *
   * 命令必须与允许清单精确一致（含参数），工作目录必须在该命令
   * 允许的集合内。执行期间：超时终止进程树、AbortSignal 取消终止、
   * 超出 maxBuffer 立即终止。输出做脱敏与截断。
   */
  private async test(
    request: Extract<WorkspaceRequest, { operation: "test" }>,
    startedAt: string,
    signal?: AbortSignal,
  ): Promise<WorkspaceEvidence> {
    const policy = this.allowedCommands.find(({ command }) =>
      sameCommand(command, request.command),
    );
    if (!policy) {
      throw new WorkspaceDeniedError(
        "command_not_allowlisted",
        "The requested executable and argument vector are not registered.",
      );
    }
    if (!policy.workingDirectories.includes(request.workingDirectory)) {
      throw new WorkspaceDeniedError(
        "working_directory_not_allowlisted",
        `Working directory ${request.workingDirectory} is not registered for this command.`,
      );
    }
    const cwd = await this.resolveExistingPath(request.workingDirectory);
    if (!(await stat(cwd)).isDirectory()) {
      throw new WorkspaceDeniedError(
        "working_directory_not_allowlisted",
        `${request.workingDirectory} is not a directory.`,
      );
    }

    const started = performance.now();
    const child = execa(request.command.executable, request.command.arguments, {
      cwd,
      cleanup: true,
      detached: process.platform !== "win32",
      env: this.commandEnvironment(),
      extendEnv: false,
      maxBuffer: this.limits.maxOutputBytes + 1,
      reject: false,
      shell: false,
      stripFinalNewline: false,
      windowsHide: true,
    });

    // 超时与取消共用一次性的终止逻辑；先触发者生效
    let termination: "timed_out" | "cancelled" | null = null;
    let terminationPromise = Promise.resolve();
    const terminate = (kind: "timed_out" | "cancelled"): void => {
      if (termination !== null) return;
      termination = kind;
      terminationPromise = this.terminateProcessTree(child.pid);
    };
    const timer = setTimeout(() => terminate("timed_out"), request.timeoutMs);
    const cancel = (): void => terminate("cancelled");
    signal?.addEventListener("abort", cancel, { once: true });

    let result;
    try {
      result = await child;
      if (result.isMaxBuffer) {
        await this.terminateProcessTree(child.pid);
      }
      await terminationPromise;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }

    const stdout = this.boundRedactedText(String(result.stdout ?? ""));
    const stderr = this.boundRedactedText(String(result.stderr ?? ""));
    const outputTruncated = stdout.truncated || stderr.truncated || result.isMaxBuffer;
    const details = {
      operation: "test" as const,
      command: request.command,
      workingDirectory: request.workingDirectory,
      exitCode: result.exitCode ?? null,
      stdout: stdout.text,
      stderr: stderr.text,
      outputTruncated,
      redactionCount: stdout.redactionCount + stderr.redactionCount,
      durationMs: performance.now() - started,
    };

    if (termination) {
      return this.finish(
        request,
        termination,
        null,
        termination === "timed_out"
          ? `The command exceeded its ${request.timeoutMs} ms deadline and its process tree was terminated.`
          : "The command was cancelled and its process tree was terminated.",
        details,
        startedAt,
      );
    }
    if (result.isMaxBuffer) {
      return this.finish(
        request,
        "failed",
        "output_limit",
        "The command exceeded its bounded output allowance and was terminated.",
        details,
        startedAt,
      );
    }
    if (result.exitCode !== 0) {
      return this.finish(
        request,
        "failed",
        "execution_failed",
        `The allowlisted command exited with code ${result.exitCode ?? "unknown"}.`,
        details,
        startedAt,
      );
    }
    return this.finish(
      request,
      "succeeded",
      null,
      "The exact allowlisted test command completed successfully.",
      details,
      startedAt,
    );
  }

  /**
   * 解析一条工作区相对路径为已存在的真实路径。
   *
   * 先做词法校验，再 realpath 解析（顺带穿透符号链接），最后做实际
   * 校验：解析结果必须仍位于工作区内，防止符号链接逃逸。
   *
   * @throws WorkspaceDeniedError 路径不存在、词法越界或符号链接逃逸
   */
  private async resolveExistingPath(relativePath: string): Promise<string> {
    const candidate = path.resolve(this.workspaceRoot, relativePath);
    this.assertLexicallyInside(candidate);
    let resolved: string;
    try {
      resolved = await realpath(candidate);
    } catch (error) {
      if (this.isMissing(error)) {
        throw new WorkspaceDeniedError(
          "path_not_allowlisted",
          `Workspace path ${relativePath} does not exist.`,
        );
      }
      throw error;
    }
    this.assertActuallyInside(resolved, "symlink_escape");
    return resolved;
  }

  /** 词法层校验：resolve 后的候选路径必须位于工作区内。 */
  private assertLexicallyInside(candidate: string): void {
    if (!isInside(this.workspaceRoot, candidate)) {
      throw new WorkspaceDeniedError(
        "path_escape",
        "The requested path leaves the selected workspace.",
      );
    }
  }

  /**
   * 实际层校验：realpath 解析后的真实路径必须位于工作区内。
   * reasonCode 用于区分是目录父级还是链接目标逃逸。
   */
  private assertActuallyInside(
    candidate: string,
    reasonCode: WorkspaceReasonCode,
  ): void {
    if (!isInside(this.workspaceRoot, candidate)) {
      throw new WorkspaceDeniedError(
        reasonCode,
        "A symbolic link resolves outside the selected workspace.",
      );
    }
  }

  /**
   * 构造命令环境：白名单继承系统变量 + 注入自定义变量。
   *
   * 只透传 PATH 等少数必需变量（避免泄漏宿主机完整环境）；Windows 上
   * 注入变量时先删除同名的继承变量（大小写不敏感），保证覆盖语义一致。
   */
  private commandEnvironment(): Record<string, string> {
    const inherited = [
      "PATH",
      "Path",
      "PATHEXT",
      "SYSTEMROOT",
      "SystemRoot",
      "COMSPEC",
    ];
    const environment: Record<string, string> = {};
    for (const key of inherited) {
      const value = process.env[key];
      const normalizedKey = process.platform === "win32" ? key.toLowerCase() : key;
      const alreadyInherited = Object.keys(environment).some(
        (candidate) =>
          (process.platform === "win32" ? candidate.toLowerCase() : candidate) ===
          normalizedKey,
      );
      if (value !== undefined && !alreadyInherited) environment[key] = value;
    }
    for (const [key, value] of Object.entries(this.environment)) {
      if (process.platform === "win32") {
        for (const inheritedKey of Object.keys(environment)) {
          if (inheritedKey.toLowerCase() === key.toLowerCase()) {
            delete environment[inheritedKey];
          }
        }
      }
      environment[key] = value;
    }
    return environment;
  }

  /**
   * 终止进程树：Windows 用 taskkill /t /f；POSIX 先 SIGTERM 整个进程组，
   * 短暂等待后 SIGKILL 兜底。
   */
  private async terminateProcessTree(pid: number | undefined): Promise<void> {
    if (pid === undefined) return;
    if (process.platform === "win32") {
      await execa("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
        reject: false,
        windowsHide: true,
      });
      return;
    }

    try {
      process.kill(-pid, "SIGTERM");
    } catch (error) {
      if (!this.isNoSuchProcess(error)) throw error;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 75));
    try {
      process.kill(-pid, "SIGKILL");
    } catch (error) {
      if (!this.isNoSuchProcess(error)) throw error;
    }
  }

  /**
   * 脱敏：先替换配置的敏感值，再按常见密钥格式（如 token/secret/password
   * 后的值）正则脱敏，返回脱敏后文本与替换计数。
   */
  private redact(input: string): RedactedText {
    let text = input;
    let count = 0;
    for (const value of this.redactedValues) {
      if (value.length === 0) continue;
      const parts = text.split(value);
      count += parts.length - 1;
      text = parts.join("[REDACTED]");
    }
    text = text.replace(
      /((?:api[_-]?key|access[_-]?token|token|secret|password)\s*[:=]\s*)(?!\[REDACTED\])[^\s,'"}]+/gi,
      (_match, prefix: string) => {
        count += 1;
        return `${prefix}[REDACTED]`;
      },
    );
    return { text, count };
  }

  /** 把文本按 UTF-8 字节数截断到上限，标记是否截断。 */
  private boundText(input: string, maxBytes: number): BoundedText {
    const bytes = Buffer.from(input, "utf8");
    if (bytes.byteLength <= maxBytes) return { text: input, truncated: false };
    return {
      text: new TextDecoder().decode(bytes.subarray(0, maxBytes)),
      truncated: true,
    };
  }

  /** 先脱敏再截断输出，并携带脱敏计数。 */
  private boundRedactedText(input: string): BoundedRedactedText {
    const redacted = this.redact(input);
    const bounded = this.boundText(redacted.text, this.limits.maxOutputBytes);
    return { ...bounded, redactionCount: redacted.count };
  }

  /** 统一构造并校验一条完成态的工作区证据。 */
  private finish(
    request: Pick<WorkspaceRequest, "requestId" | "runId" | "operation">,
    status: WorkspaceEvidence["status"],
    reasonCode: WorkspaceEvidence["reasonCode"],
    summary: string,
    details: WorkspaceEvidence["details"],
    startedAt: string,
  ): WorkspaceEvidence {
    return workspaceEvidenceSchema.parse({
      schemaVersion: WORKSPACE_EVIDENCE_SCHEMA_VERSION,
      requestId: request.requestId,
      runId: request.runId,
      operation: request.operation,
      status,
      reasonCode,
      summary,
      startedAt,
      finishedAt: this.clock().toISOString(),
      details,
    });
  }

  /** 判断错误是否为"文件不存在"（ENOENT）。 */
  private isMissing(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    );
  }

  /** 判断错误是否为"进程不存在"（ESRCH）。 */
  private isNoSuchProcess(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ESRCH"
    );
  }
}
