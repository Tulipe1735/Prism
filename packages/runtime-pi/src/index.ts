import { randomUUID } from "node:crypto";

import { type Api, type Model, Type } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  type ArtifactRef,
  type NodeOutcome,
  nodeOutcomeSchema,
  PI_RUNTIME_RESULT_SCHEMA_VERSION,
  type PiRuntimeResult,
  piRuntimeResultSchema,
  type RuntimeResourceUsage,
  type RuntimeTaskEnvelope,
  runtimeTaskEnvelopeSchema,
  WORKSPACE_REQUEST_SCHEMA_VERSION,
  type WorkspaceEvidenceRecord,
  type WorkspaceRequest,
  workspaceRequestSchema,
} from "@prism/contracts";

const PI_TRAJECTORY_MEDIA_TYPE = "application/vnd.prism.pi-trajectory+json";

export interface PiWorkspaceGateway {
  guidance?: {
    allowedReadPatterns: readonly string[];
    allowedDiscoveryPatterns: readonly string[];
  };
  execute: (
    request: WorkspaceRequest,
    signal?: AbortSignal,
  ) => Promise<WorkspaceEvidenceRecord>;
}

export interface PiArtifactCommitter {
  commit: (content: string, mediaType: string) => Promise<ArtifactRef>;
}

interface InspectToolInput {
  paths: string[];
  patterns: string[];
}

interface PatchToolInput {
  files: Array<{
    path: string;
    expectedSha256: string | null;
    content: string;
  }>;
}

interface TestToolInput {
  command: { executable: string; arguments: string[] };
  workingDirectory: string;
  timeoutMs: number;
}

interface SubmitOutcomeInput {
  state: NodeOutcome["state"];
  summary: string;
  request: NodeOutcome["request"];
}

export interface PiSessionHandlers {
  inspect?: (input: InspectToolInput, signal?: AbortSignal) => Promise<unknown>;
  patch?: (input: PatchToolInput, signal?: AbortSignal) => Promise<unknown>;
  test?: (input: TestToolInput, signal?: AbortSignal) => Promise<unknown>;
  submit: (input: SubmitOutcomeInput) => Promise<unknown>;
}

export interface PiSession {
  prompt: (
    prompt: string,
    continueWithinBudget: (usage: RuntimeResourceUsage) => boolean,
  ) => Promise<void>;
  abort: () => Promise<void>;
  dispose: () => void;
  getUsage: () => RuntimeResourceUsage;
}

export interface PiSessionFactory {
  readonly model: RuntimeResourceUsage["model"];
  create: (options: {
    systemPrompt: string;
    handlers: PiSessionHandlers;
    /** Creation must settle when this signal aborts; no late session may escape. */
    signal: AbortSignal;
  }) => Promise<PiSession>;
}

export interface PiSdkSessionFactoryOptions {
  cwd: string;
  model: Model<Api>;
  modelRuntime: ModelRuntime;
}

export class PiSdkConfigurationError extends Error {}

export class PiSessionCleanupError extends Error {
  constructor(cause: unknown) {
    super("The Pi SDK session could not be cleaned up.", { cause });
    this.name = "PiSessionCleanupError";
  }
}

export async function createConfiguredPiSdkSessionFactory(options: {
  cwd: string;
  provider?: string;
  modelId?: string;
}): Promise<PiSdkSessionFactory> {
  const modelRuntime = await ModelRuntime.create();
  const hasExplicitModel = Boolean(options.provider || options.modelId);
  if (hasExplicitModel && (!options.provider || !options.modelId)) {
    throw new PiSdkConfigurationError(
      "Configure both PRISM_PI_PROVIDER and PRISM_PI_MODEL.",
    );
  }
  const model = hasExplicitModel
    ? modelRuntime.getModel(options.provider!, options.modelId!)
    : (await modelRuntime.getAvailable())[0];
  if (!model) {
    throw new PiSdkConfigurationError(
      hasExplicitModel
        ? `The configured Pi model ${options.provider}/${options.modelId} is unavailable.`
        : "No authenticated Pi model is available.",
    );
  }
  return new PiSdkSessionFactory({
    cwd: options.cwd,
    model,
    modelRuntime,
  });
}

const nodeTypeSchema = Type.Union([
  Type.Literal("workspace.inspect"),
  Type.Literal("browser.observe"),
  Type.Literal("workspace.patch"),
  Type.Literal("browser.verify"),
  Type.Literal("task.complete"),
  Type.Literal("route.reclassify"),
]);

const outcomeRequestSchema = Type.Union([
  Type.Object({ kind: Type.Literal("none") }, { additionalProperties: false }),
  Type.Object(
    { kind: Type.Literal("successor"), nodeType: nodeTypeSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("evidence"),
      nodeType: Type.Union([
        Type.Literal("workspace.inspect"),
        Type.Literal("browser.observe"),
      ]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("retry"), reason: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("reclassify"),
      classification: Type.Union([
        Type.Literal("coding"),
        Type.Literal("browser"),
        Type.Literal("hybrid"),
      ]),
    },
    { additionalProperties: false },
  ),
]);

function textResult(value: unknown): {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, never>;
} {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    details: {},
  };
}

/**
 * Official Pi Agent SDK adapter. It disables discovered resources and built-in
 * tools, then allowlists only the brokered Prism tools supplied by the runtime.
 */
export class PiSdkSessionFactory implements PiSessionFactory {
  readonly model: RuntimeResourceUsage["model"];

  constructor(private readonly options: PiSdkSessionFactoryOptions) {
    this.model = {
      provider: options.model.provider,
      id: options.model.id,
    };
  }

  async create(options: {
    systemPrompt: string;
    handlers: PiSessionHandlers;
    signal: AbortSignal;
  }): Promise<PiSession> {
    options.signal.throwIfAborted();
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false },
    });
    const resourceLoader = new DefaultResourceLoader({
      cwd: this.options.cwd,
      agentDir: this.options.cwd,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: options.systemPrompt,
    });
    await resourceLoader.reload();
    options.signal.throwIfAborted();

    const customTools = [];
    const toolNames: string[] = [];
    if (options.handlers.inspect) {
      toolNames.push("prism_inspect");
      customTools.push(
        defineTool({
          name: "prism_inspect",
          label: "Inspect scoped workspace",
          description:
            "Read or discover only paths accepted by the Prism WorkspaceExecutor.",
          parameters: Type.Object(
            {
              paths: Type.Array(Type.String(), { maxItems: 24 }),
              patterns: Type.Array(Type.String(), { maxItems: 24 }),
            },
            { additionalProperties: false },
          ),
          execute: async (_toolCallId, input, signal) =>
            textResult(await options.handlers.inspect!(input, signal)),
        }),
      );
    }
    if (options.handlers.patch) {
      toolNames.push("prism_patch");
      customTools.push(
        defineTool({
          name: "prism_patch",
          label: "Apply scoped patch",
          description:
            "Apply one hash-guarded source file replacement through the Prism WorkspaceExecutor.",
          parameters: Type.Object(
            {
              files: Type.Array(
                Type.Object(
                  {
                    path: Type.String(),
                    expectedSha256: Type.Union([Type.String(), Type.Null()]),
                    content: Type.String(),
                  },
                  { additionalProperties: false },
                ),
                { minItems: 1, maxItems: 1 },
              ),
            },
            { additionalProperties: false },
          ),
          execute: async (_toolCallId, input, signal) =>
            textResult(await options.handlers.patch!(input, signal)),
        }),
      );
    }
    if (options.handlers.test) {
      toolNames.push("prism_test");
      customTools.push(
        defineTool({
          name: "prism_test",
          label: "Run scoped test",
          description:
            "Run an exact allowlisted command through the Prism WorkspaceExecutor.",
          parameters: Type.Object(
            {
              command: Type.Object(
                {
                  executable: Type.String(),
                  arguments: Type.Array(Type.String(), { maxItems: 32 }),
                },
                { additionalProperties: false },
              ),
              workingDirectory: Type.String(),
              timeoutMs: Type.Number(),
            },
            { additionalProperties: false },
          ),
          execute: async (_toolCallId, input, signal) =>
            textResult(await options.handlers.test!(input, signal)),
        }),
      );
    }
    toolNames.push("prism_submit_outcome");
    customTools.push(
      defineTool({
        name: "prism_submit_outcome",
        label: "Submit typed node outcome",
        description:
          "Submit the one typed NodeOutcome for this attempt after evidence is available.",
        parameters: Type.Object(
          {
            state: Type.Union([
              Type.Literal("succeeded"),
              Type.Literal("failed"),
              Type.Literal("blocked"),
            ]),
            summary: Type.String({ minLength: 1, maxLength: 500 }),
            request: outcomeRequestSchema,
          },
          { additionalProperties: false },
        ),
        execute: async (_toolCallId, input) =>
          textResult(await options.handlers.submit(input)),
      }),
    );

    const { session } = await createAgentSession({
      cwd: this.options.cwd,
      model: this.options.model,
      modelRuntime: this.options.modelRuntime,
      thinkingLevel: "off",
      tools: toolNames,
      customTools,
      resourceLoader,
      sessionManager: SessionManager.inMemory(this.options.cwd),
      settingsManager,
    });
    if (options.signal.aborted) {
      let cleanupError: unknown;
      try {
        await session.abort();
      } catch (error) {
        cleanupError = error;
      }
      try {
        session.dispose();
      } catch (error) {
        cleanupError ??= error;
      }
      if (cleanupError) throw new PiSessionCleanupError(cleanupError);
      options.signal.throwIfAborted();
    }

    const usage = (): RuntimeResourceUsage => {
      const stats = session.getSessionStats();
      return {
        model: this.model,
        modelCalls: stats.assistantMessages,
        inputTokens: stats.tokens.input,
        outputTokens: stats.tokens.output,
        cacheReadTokens: stats.tokens.cacheRead,
        cacheWriteTokens: stats.tokens.cacheWrite,
        totalTokens: stats.tokens.total,
        costUsd: stats.cost,
        durationMs: 0,
      };
    };

    return {
      prompt: async (prompt, continueWithinBudget) => {
        const unsubscribe = session.subscribe(async (event) => {
          if (event.type === "turn_end" && !continueWithinBudget(usage())) {
            await session.abort();
          }
        });
        try {
          await session.prompt(prompt, { expandPromptTemplates: false });
        } finally {
          unsubscribe();
        }
      },
      abort: () => session.abort(),
      dispose: () => session.dispose(),
      getUsage: usage,
    };
  }
}

type RuntimeFailureCode = NonNullable<NodeOutcome["failure"]>["code"];

interface TrajectoryEventBase {
  eventId: string;
  sequence: number;
  recordedAt: string;
  correlationId: string;
  causationEventId: string | null;
  attempt: number;
}

function operationRequestId(): string {
  return randomUUID();
}

function uniqueArtifacts(artifacts: readonly ArtifactRef[]): ArtifactRef[] {
  return Array.from(
    new Map(artifacts.map((artifact) => [artifact.hash, artifact])).values(),
  );
}

function isWithinBudget(
  usage: RuntimeResourceUsage,
  envelope: RuntimeTaskEnvelope,
): boolean {
  return (
    usage.modelCalls <= envelope.budget.maxModelCalls &&
    usage.inputTokens <= envelope.budget.maxInputTokens &&
    usage.outputTokens <= envelope.budget.maxOutputTokens &&
    usage.totalTokens <= envelope.budget.maxTotalTokens &&
    usage.costUsd <= envelope.budget.maxCostUsd
  );
}

function systemPrompt(
  envelope: RuntimeTaskEnvelope,
  guidance: PiWorkspaceGateway["guidance"],
): string {
  return [
    "You are the embedded Pi Coding Runtime inside Prism.",
    "Use only the available Prism tools. They are the complete authority for this attempt.",
    "Never claim a file, command, patch, test, artifact, approval, or DAG change that a tool did not confirm.",
    "Call prism_submit_outcome exactly once. Prism supplies identity, committed artifacts, resource usage, and failure typing.",
    ...(guidance
      ? [
          `Exact reads must match one of: ${guidance.allowedReadPatterns.join(", ")}.`,
          `Discovery patterns must be copied exactly from: ${guidance.allowedDiscoveryPatterns.join(", ")}.`,
          "Discover with a registered pattern, then read returned paths. Do not guess directory paths or unregistered globs.",
        ]
      : []),
    `Run: ${envelope.runId}`,
    `DAG revision: ${envelope.dagRevision}`,
    `Node: ${envelope.nodeId} (${envelope.nodeType}), attempt ${envelope.attempt}/${envelope.maxAttempts}`,
    `Task: ${envelope.prompt}`,
    `Input artifact hashes: ${envelope.inputArtifacts.map((artifact) => artifact.hash).join(", ") || "none"}`,
  ].join("\n");
}

export interface PiCodingRuntimeOptions {
  workspace: PiWorkspaceGateway;
  artifacts: PiArtifactCommitter;
  sessionFactory: PiSessionFactory;
  clock?: () => Date;
}

/** Embedded Pi Coding Runtime constrained by Prism contracts and brokers. */
export class PiCodingRuntime {
  private readonly clock: () => Date;

  constructor(private readonly options: PiCodingRuntimeOptions) {
    this.clock = options.clock ?? (() => new Date());
  }

  async execute(
    envelopeInput: RuntimeTaskEnvelope,
    options: { signal?: AbortSignal } = {},
  ): Promise<PiRuntimeResult> {
    const envelope = runtimeTaskEnvelopeSchema.parse(envelopeInput);
    const startedAt = this.clock();
    const trajectory: Array<TrajectoryEventBase & Record<string, unknown>> = [];
    const committedArtifacts: ArtifactRef[] = [];
    let sequence = 0;
    let submittedOutcome: NodeOutcome | undefined;
    let lastTestSucceeded = false;
    let latestInspectStatus: WorkspaceEvidenceRecord["evidence"]["status"] | undefined;
    let latestPatchStatus: WorkspaceEvidenceRecord["evidence"]["status"] | undefined;
    let latestTestStatus: WorkspaceEvidenceRecord["evidence"]["status"] | undefined;
    let workspaceFailed = false;
    let malformedOutput = false;
    let abortReason: RuntimeFailureCode | undefined;
    let cleanupFailed = false;
    let session: PiSession | undefined;

    const eventBase = (): TrajectoryEventBase => ({
      eventId: randomUUID(),
      sequence: ++sequence,
      recordedAt: this.clock().toISOString(),
      correlationId: envelope.correlationId,
      causationEventId: envelope.causationEventId,
      attempt: envelope.attempt,
    });
    const recordWorkspace = (
      record: WorkspaceEvidenceRecord,
      extra: Record<string, unknown>,
    ): WorkspaceEvidenceRecord => {
      if (record.evidence.reasonCode === "process_cleanup_failed") {
        cleanupFailed = true;
      }
      if (record.evidence.status === "cancelled") {
        abortReason = "cancelled";
        void session?.abort().catch(() => undefined);
      }
      if (record.evidence.status === "timed_out") {
        abortReason = "timed_out";
        void session?.abort().catch(() => undefined);
      }
      committedArtifacts.push(record.artifact);
      trajectory.push({
        ...eventBase(),
        type: `workspace.${record.evidence.operation}`,
        status: record.evidence.status,
        artifact: record.artifact,
        ...extra,
      });
      return record;
    };
    const executeWorkspace = async (
      request: WorkspaceRequest,
      signal?: AbortSignal,
    ): Promise<WorkspaceEvidenceRecord> => {
      try {
        return await this.options.workspace.execute(request, signal);
      } catch (error) {
        workspaceFailed = true;
        throw error;
      }
    };

    const handlers: PiSessionHandlers = {
      submit: async (input) => {
        if (submittedOutcome) {
          malformedOutput = true;
          throw new TypeError("Pi may submit only one NodeOutcome per attempt.");
        }
        try {
          submittedOutcome = nodeOutcomeSchema.parse({
            nodeId: envelope.nodeId,
            attempt: envelope.attempt,
            state: input.state,
            summary: input.summary,
            request: input.request,
            failure: null,
          });
        } catch (error) {
          malformedOutput = true;
          throw error;
        }
        return { accepted: true };
      },
    };

    const operations = new Set(envelope.authority.workspaceOperations);
    if (operations.has("inspect")) {
      handlers.inspect = async (input, signal) => {
        const request = workspaceRequestSchema.parse({
          schemaVersion: WORKSPACE_REQUEST_SCHEMA_VERSION,
          requestId: operationRequestId(),
          runId: envelope.runId,
          operation: "inspect",
          ...input,
        });
        const record = await executeWorkspace(request, signal);
        latestInspectStatus = record.evidence.status;
        return recordWorkspace(record, {
          paths: input.paths,
          patterns: input.patterns,
        });
      };
    }
    if (operations.has("patch")) {
      handlers.patch = async (input, signal) => {
        const request = workspaceRequestSchema.parse({
          schemaVersion: WORKSPACE_REQUEST_SCHEMA_VERSION,
          requestId: operationRequestId(),
          runId: envelope.runId,
          operation: "patch",
          ...input,
        });
        lastTestSucceeded = false;
        latestTestStatus = undefined;
        const record = await executeWorkspace(request, signal);
        latestPatchStatus = record.evidence.status;
        return recordWorkspace(record, {
          diff:
            record.evidence.details.operation === "patch"
              ? {
                  artifact: record.artifact,
                  files: record.evidence.details.files,
                }
              : null,
        });
      };
    }
    if (operations.has("test")) {
      handlers.test = async (input, signal) => {
        const request = workspaceRequestSchema.parse({
          schemaVersion: WORKSPACE_REQUEST_SCHEMA_VERSION,
          requestId: operationRequestId(),
          runId: envelope.runId,
          operation: "test",
          ...input,
        });
        const record = await executeWorkspace(request, signal);
        const details = record.evidence.details;
        const exitCode = details.operation === "test" ? details.exitCode : null;
        latestTestStatus = record.evidence.status;
        lastTestSucceeded = record.evidence.status === "succeeded" && exitCode === 0;
        return recordWorkspace(record, {
          command: input.command,
          workingDirectory: input.workingDirectory,
          exitCode,
        });
      };
    }

    const deadlineMs = new Date(envelope.deadline).getTime() - startedAt.getTime();
    if (options.signal?.aborted) abortReason = "cancelled";
    if (deadlineMs <= 0) abortReason = "timed_out";

    let usage: RuntimeResourceUsage = {
      model: this.options.sessionFactory.model,
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      durationMs: 0,
    };
    const executionController = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const stopExecution = (reason: RuntimeFailureCode): void => {
      if (abortReason) return;
      abortReason = reason;
      executionController.abort(reason);
      void session?.abort().catch(() => undefined);
    };
    const onExternalAbort = (): void => {
      stopExecution("cancelled");
    };

    if (!abortReason) {
      options.signal?.addEventListener("abort", onExternalAbort, { once: true });
      const durationIsLimiting = envelope.budget.maxDurationMs <= deadlineMs;
      const timeoutMs = Math.min(envelope.budget.maxDurationMs, deadlineMs);
      timeout = setTimeout(
        () => stopExecution(durationIsLimiting ? "budget_exhausted" : "timed_out"),
        timeoutMs,
      );
      try {
        session = await this.options.sessionFactory.create({
          systemPrompt: systemPrompt(envelope, this.options.workspace.guidance),
          handlers,
          signal: executionController.signal,
        });
        await session.prompt(envelope.prompt, (currentUsage) => {
          if (!isWithinBudget(currentUsage, envelope)) {
            stopExecution("budget_exhausted");
            return false;
          }
          return true;
        });
      } catch (error) {
        if (error instanceof PiSessionCleanupError) cleanupFailed = true;
        else if (!abortReason) malformedOutput = true;
      } finally {
        if (timeout) clearTimeout(timeout);
        options.signal?.removeEventListener("abort", onExternalAbort);
        if (session) {
          usage = session.getUsage();
          try {
            session.dispose();
          } catch {
            cleanupFailed = true;
          }
        }
      }
    }

    usage = {
      ...usage,
      durationMs: Math.max(0, this.clock().getTime() - startedAt.getTime()),
    };
    if (!isWithinBudget(usage, envelope)) abortReason = "budget_exhausted";
    if (!submittedOutcome && !abortReason && !workspaceFailed) malformedOutput = true;
    if (submittedOutcome?.state === "succeeded") {
      if (envelope.nodeType === "workspace.inspect") {
        if (latestInspectStatus === undefined) malformedOutput = true;
        else if (latestInspectStatus !== "succeeded") workspaceFailed = true;
      } else if (latestPatchStatus === undefined || latestTestStatus === undefined) {
        malformedOutput = true;
      } else if (
        latestPatchStatus !== "succeeded" ||
        latestTestStatus !== "succeeded" ||
        !lastTestSucceeded
      ) {
        workspaceFailed = true;
      }
      if (malformedOutput || workspaceFailed) submittedOutcome = undefined;
    }
    if (
      submittedOutcome &&
      submittedOutcome.state !== "succeeded" &&
      (envelope.nodeType === "workspace.inspect"
        ? latestInspectStatus !== undefined && latestInspectStatus !== "succeeded"
        : (latestPatchStatus !== undefined && latestPatchStatus !== "succeeded") ||
          (latestTestStatus !== undefined && latestTestStatus !== "succeeded"))
    ) {
      workspaceFailed = true;
      submittedOutcome = undefined;
    }

    const failureCode: RuntimeFailureCode | undefined = cleanupFailed
      ? "process_cleanup_failed"
      : (abortReason ??
        (workspaceFailed
          ? "workspace_execution_failed"
          : malformedOutput
            ? "malformed_sdk_output"
            : undefined));
    if (failureCode) {
      const canRetry =
        ["timed_out", "malformed_sdk_output", "workspace_execution_failed"].includes(
          failureCode,
        ) && envelope.attempt < envelope.maxAttempts;
      submittedOutcome = nodeOutcomeSchema.parse({
        nodeId: envelope.nodeId,
        attempt: envelope.attempt,
        state:
          failureCode === "cancelled" ||
          failureCode === "budget_exhausted" ||
          failureCode === "process_cleanup_failed"
            ? "blocked"
            : "failed",
        summary: `Pi Coding Runtime ended with ${failureCode.replaceAll("_", " ")}.`,
        request: canRetry
          ? { kind: "retry", reason: `Retry after ${failureCode}.` }
          : { kind: "none" },
        failure: { code: failureCode, retryable: canRetry },
      });
    }

    trajectory.push({
      ...eventBase(),
      type: "model.usage",
      model: usage.model,
      modelCalls: usage.modelCalls,
      tokens: {
        input: usage.inputTokens,
        output: usage.outputTokens,
        cacheRead: usage.cacheReadTokens,
        cacheWrite: usage.cacheWriteTokens,
        total: usage.totalTokens,
      },
      costUsd: usage.costUsd,
      durationMs: usage.durationMs,
    });
    const trajectoryArtifact = await this.options.artifacts.commit(
      `${JSON.stringify({
        schemaVersion: "prism.pi-trajectory/v1",
        runId: envelope.runId,
        dagRevision: envelope.dagRevision,
        nodeId: envelope.nodeId,
        attempt: envelope.attempt,
        correlationId: envelope.correlationId,
        causationEventId: envelope.causationEventId,
        events: trajectory,
      })}\n`,
      PI_TRAJECTORY_MEDIA_TYPE,
    );
    committedArtifacts.push(trajectoryArtifact);

    return piRuntimeResultSchema.parse({
      schemaVersion: PI_RUNTIME_RESULT_SCHEMA_VERSION,
      outcome: submittedOutcome,
      artifacts: uniqueArtifacts(committedArtifacts),
      usage,
    });
  }
}
