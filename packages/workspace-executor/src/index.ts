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

type WorkspaceReasonCode = NonNullable<WorkspaceEvidence["reasonCode"]>;
type InspectDetails = Extract<WorkspaceEvidence["details"], { operation: "inspect" }>;
interface BoundedText {
  text: string;
  truncated: boolean;
}
interface RedactedText {
  text: string;
  count: number;
}
interface BoundedRedactedText extends BoundedText {
  redactionCount: number;
}
interface IgnoreLayer {
  directory: string;
  matcher: ReturnType<typeof createIgnore>;
}

class RepositoryIgnoreRules {
  private readonly layers: IgnoreLayer[] = [];

  add(directory: string, patterns: string | readonly string[]): void {
    const matcher = createIgnore({ ignorecase: process.platform === "win32" });
    matcher.add(patterns);
    this.layers.push({ directory, matcher });
  }

  ignores(relativePath: string): boolean {
    let ignored = false;
    for (const layer of this.layers) {
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

export interface AllowedWorkspaceCommand {
  command: WorkspaceCommand;
  workingDirectories: readonly string[];
}

export interface WorkspaceExecutorLimits {
  maxOutputBytes: number;
  maxReadBytes: number;
  maxDiscoveredFiles: number;
}

export interface WorkspaceExecutorOptions {
  workspaceRoot: string;
  allowedReadPatterns: readonly string[];
  allowedDiscoveryPatterns: readonly string[];
  allowedCommands: readonly AllowedWorkspaceCommand[];
  environment?: Readonly<Record<string, string>>;
  redactedValues?: readonly string[];
  limits?: Partial<WorkspaceExecutorLimits>;
  clock?: () => Date;
}

export interface WorkspaceExecutionOptions {
  signal?: AbortSignal;
}

const DEFAULT_LIMITS: WorkspaceExecutorLimits = {
  maxOutputBytes: 32_768,
  maxReadBytes: 65_536,
  maxDiscoveredFiles: 200,
};

class WorkspaceDeniedError extends Error {
  readonly reasonCode: WorkspaceReasonCode;

  constructor(reasonCode: WorkspaceReasonCode, message: string) {
    super(message);
    this.name = "WorkspaceDeniedError";
    this.reasonCode = reasonCode;
  }
}

function sha256(content: Uint8Array | string): string {
  return createHash("sha256").update(content).digest("hex");
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..")
  );
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function sameCommand(left: WorkspaceCommand, right: WorkspaceCommand): boolean {
  return (
    left.executable === right.executable &&
    left.arguments.length === right.arguments.length &&
    left.arguments.every((argument, index) => argument === right.arguments[index])
  );
}

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

function looksLikeTraversal(input: unknown): boolean {
  const serialized = JSON.stringify(input);
  return /(?:^|["/\\])\.\.(?:[/\\"]|$)|[a-z]:[\\/]/i.test(serialized);
}

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

  static async create(options: WorkspaceExecutorOptions): Promise<WorkspaceExecutor> {
    const workspaceRoot = await realpath(path.resolve(options.workspaceRoot));
    const workspaceStat = await stat(workspaceRoot);
    if (!workspaceStat.isDirectory()) {
      throw new TypeError("WorkspaceExecutor requires an existing directory root.");
    }

    return new WorkspaceExecutor(options, workspaceRoot);
  }

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

      const beforeSha256 = before ? sha256(before) : null;
      if (beforeSha256 !== change.expectedSha256) {
        throw new WorkspaceDeniedError(
          "patch_conflict",
          `Patch target ${change.path} changed after it was inspected.`,
        );
      }
      prepared.push({ change, candidate, beforeSha256 });
    }

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

  private assertLexicallyInside(candidate: string): void {
    if (!isInside(this.workspaceRoot, candidate)) {
      throw new WorkspaceDeniedError(
        "path_escape",
        "The requested path leaves the selected workspace.",
      );
    }
  }

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

  private boundText(input: string, maxBytes: number): BoundedText {
    const bytes = Buffer.from(input, "utf8");
    if (bytes.byteLength <= maxBytes) return { text: input, truncated: false };
    return {
      text: new TextDecoder().decode(bytes.subarray(0, maxBytes)),
      truncated: true,
    };
  }

  private boundRedactedText(input: string): BoundedRedactedText {
    const redacted = this.redact(input);
    const bounded = this.boundText(redacted.text, this.limits.maxOutputBytes);
    return { ...bounded, redactionCount: redacted.count };
  }

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

  private isMissing(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    );
  }

  private isNoSuchProcess(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ESRCH"
    );
  }
}
