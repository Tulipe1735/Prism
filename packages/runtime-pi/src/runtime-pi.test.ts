import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  InMemoryCredentialStore,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  ARTIFACT_REF_SCHEMA_VERSION,
  type ArtifactRef,
  type RuntimeTaskEnvelope,
  type WorkspaceEvidenceRecord,
  workspaceEvidenceRecordSchema,
  type WorkspaceRequest,
} from "@prism/contracts";
import { WorkspaceExecutor } from "@prism/workspace-executor";
import { afterEach, describe, expect, it } from "vitest";

import {
  PiCodingRuntime,
  PiSdkSessionFactory,
  type PiSessionFactory,
  type PiSessionHandlers,
} from "./index";

const runId = "run_6dbf6f33-69c4-4e5f-9898-3f693735f5f0";
const roots: string[] = [];

function sha256(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("PiCodingRuntime", () => {
  it("runs a real embedded Pi SDK session through the WorkspaceExecutor and commits a replayable repair trajectory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "prism-pi-smoke-"));
    roots.push(root);
    await mkdir(path.join(root, "src"));
    const initialSource = "export const rounded = false;\n";
    const proposedSource = "export const rounded = false; // first proposal\n";
    const correctedSource = "export const rounded = true;\n";
    await writeFile(path.join(root, "src", "button.ts"), initialSource);
    await writeFile(
      path.join(root, "verify.mjs"),
      [
        'import { readFileSync } from "node:fs";',
        'const source = readFileSync(new URL("./src/button.ts", import.meta.url), "utf8");',
        'console.log("token=fixture-secret");',
        'if (!source.includes("rounded = true")) process.exit(1);',
      ].join("\n"),
    );

    const executor = await WorkspaceExecutor.create({
      workspaceRoot: root,
      allowedReadPatterns: ["src/**/*.ts"],
      allowedDiscoveryPatterns: ["src/**/*.ts"],
      allowedCommands: [
        {
          command: { executable: "node", arguments: ["verify.mjs"] },
          workingDirectories: ["."],
        },
      ],
      redactedValues: ["fixture-secret"],
    });
    const artifactContent = new Map<string, string>();
    const commit = async (content: string, mediaType: string): Promise<ArtifactRef> => {
      const hash = sha256(content);
      artifactContent.set(hash, content);
      return {
        schemaVersion: ARTIFACT_REF_SCHEMA_VERSION,
        algorithm: "sha256",
        hash,
        byteLength: Buffer.byteLength(content),
        mediaType,
      };
    };
    const workspace = {
      execute: async (
        request: WorkspaceRequest,
        signal?: AbortSignal,
      ): Promise<WorkspaceEvidenceRecord> => {
        const evidence = await executor.execute(request, { signal });
        const artifact = await commit(
          `${JSON.stringify(evidence)}\n`,
          "application/vnd.prism.workspace-evidence+json",
        );
        return workspaceEvidenceRecordSchema.parse({ evidence, artifact });
      },
    };

    const faux = fauxProvider({ provider: `prism-faux-${randomUUID()}` });
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("prism_inspect", {
          paths: ["src/button.ts"],
          patterns: [],
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall("prism_patch", {
          files: [
            {
              path: "src/button.ts",
              expectedSha256: sha256(initialSource),
              content: proposedSource,
            },
          ],
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall("prism_test", {
          command: { executable: "node", arguments: ["verify.mjs"] },
          workingDirectory: ".",
          timeoutMs: 2_000,
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall("prism_patch", {
          files: [
            {
              path: "src/button.ts",
              expectedSha256: sha256(proposedSource),
              content: correctedSource,
            },
          ],
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall("prism_test", {
          command: { executable: "node", arguments: ["verify.mjs"] },
          workingDirectory: ".",
          timeoutMs: 2_000,
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall("prism_submit_outcome", {
          state: "succeeded",
          summary: "The corrected source passed the final scoped test.",
          request: { kind: "successor", nodeType: "browser.verify" },
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Outcome submitted."),
    ]);
    const modelRuntime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
    });
    modelRuntime.registerNativeProvider(faux.provider);

    const envelope: RuntimeTaskEnvelope = {
      schemaVersion: "prism.runtime-task-envelope/v1",
      runId,
      dagRevision: 2,
      nodeId: "node-2-workspace-patch-attempt-1",
      nodeType: "workspace.patch",
      attempt: 1,
      maxAttempts: 1,
      runtime: "coding",
      prompt: "Make the Save button visibly rounded.",
      inputArtifacts: [],
      authority: { workspaceOperations: ["inspect", "patch", "test"] },
      budget: {
        maxModelCalls: 8,
        maxInputTokens: 100_000,
        maxOutputTokens: 20_000,
        maxTotalTokens: 120_000,
        maxCostUsd: 1,
        maxDurationMs: 30_000,
      },
      deadline: "2026-08-05T09:05:00.000Z",
      cancellationId: "cancel-pi-smoke",
      correlationId: runId,
      causationEventId: null,
      idempotencyKey: `${runId}:2:node-2-workspace-patch-attempt-1:1`,
    };
    const runtime = new PiCodingRuntime({
      workspace,
      artifacts: { commit },
      sessionFactory: new PiSdkSessionFactory({
        cwd: root,
        model: faux.getModel(),
        modelRuntime,
      }),
      clock: () => new Date("2026-08-05T09:00:00.000Z"),
    });

    const result = await runtime.execute(envelope);

    expect(result.outcome).toMatchObject({
      state: "succeeded",
      failure: null,
      request: { kind: "successor", nodeType: "browser.verify" },
    });
    expect(result.usage).toMatchObject({
      model: { provider: faux.getModel().provider, id: faux.getModel().id },
      modelCalls: 7,
    });
    expect(await readFile(path.join(root, "src", "button.ts"), "utf8")).toBe(
      correctedSource,
    );

    const trajectoryRef = result.artifacts.find(
      (artifact) => artifact.mediaType === "application/vnd.prism.pi-trajectory+json",
    );
    expect(trajectoryRef).toBeDefined();
    const trajectory = JSON.parse(artifactContent.get(trajectoryRef!.hash)!);
    expect(trajectory.events.map((event: { type: string }) => event.type)).toEqual([
      "workspace.inspect",
      "workspace.patch",
      "workspace.test",
      "workspace.patch",
      "workspace.test",
      "model.usage",
    ]);
    expect(
      trajectory.events
        .filter((event: { type: string }) => event.type === "workspace.test")
        .map((event: { exitCode: number }) => event.exitCode),
    ).toEqual([1, 0]);
    expect(
      trajectory.events.find(
        (event: { type: string }) => event.type === "workspace.patch",
      ).diff.files[0].diff,
    ).toContain("rounded = false; // first proposal");
    expect(
      [...artifactContent.values()].some((content) => content.includes("[REDACTED]")),
    ).toBe(true);
    expect(JSON.stringify(trajectory)).not.toContain("fixture-secret");
    expect(
      result.artifacts.every((artifact) => artifactContent.has(artifact.hash)),
    ).toBe(true);
  });

  it.each([
    {
      name: "cancellation",
      expected: { code: "cancelled", retryable: false, state: "blocked" },
      arrange: (controller: AbortController) =>
        createFailureSessionFactory(async ({ waitForAbort }) => {
          setTimeout(() => controller.abort(), 10);
          await waitForAbort();
        }),
    },
    {
      name: "timeout",
      expected: { code: "timed_out", retryable: true, state: "failed" },
      deadline: "2026-08-05T09:00:00.050Z",
      arrange: () =>
        createFailureSessionFactory(async ({ waitForAbort }) => {
          await waitForAbort();
        }),
    },
    {
      name: "duration budget exhaustion",
      expected: {
        code: "budget_exhausted",
        retryable: false,
        state: "blocked",
      },
      budgetDurationMs: 50,
      arrange: () =>
        createFailureSessionFactory(async ({ waitForAbort }) => {
          await waitForAbort();
        }),
    },
    {
      name: "budget exhaustion",
      expected: {
        code: "budget_exhausted",
        retryable: false,
        state: "blocked",
      },
      arrange: () =>
        createFailureSessionFactory(async ({ continueWithinBudget, setUsage }) => {
          const overBudget = runtimeUsage({ modelCalls: 3 });
          setUsage(overBudget);
          continueWithinBudget(overBudget);
        }),
    },
    {
      name: "malformed SDK output",
      expected: {
        code: "malformed_sdk_output",
        retryable: true,
        state: "failed",
      },
      arrange: () => createFailureSessionFactory(async () => undefined),
    },
    {
      name: "process cleanup failure",
      expected: {
        code: "process_cleanup_failed",
        retryable: false,
        state: "blocked",
      },
      arrange: () =>
        createFailureSessionFactory(async ({ handlers }) => {
          await handlers.submit({
            state: "succeeded",
            summary: "Inspection completed.",
            request: { kind: "successor", nodeType: "workspace.patch" },
          });
        }, true),
    },
  ])("returns committed typed evidence for $name", async (scenario) => {
    const controller = new AbortController();
    const committed = new Map<string, string>();
    const commit = async (content: string, mediaType: string): Promise<ArtifactRef> => {
      const hash = sha256(content);
      committed.set(hash, content);
      return {
        schemaVersion: ARTIFACT_REF_SCHEMA_VERSION,
        algorithm: "sha256",
        hash,
        byteLength: Buffer.byteLength(content),
        mediaType,
      };
    };
    const envelope = inspectionEnvelope(scenario.budgetDurationMs, scenario.deadline);
    const runtime = new PiCodingRuntime({
      workspace: {
        execute: async () => {
          throw new Error("The failure fixture must not bypass its scripted session.");
        },
      },
      artifacts: { commit },
      sessionFactory: scenario.arrange(controller),
      clock: () => new Date("2026-08-05T09:00:00.000Z"),
    });

    const result = await runtime.execute(envelope, { signal: controller.signal });

    expect(result.outcome).toMatchObject({
      state: scenario.expected.state,
      failure: {
        code: scenario.expected.code,
        retryable: scenario.expected.retryable,
      },
      request: scenario.expected.retryable ? { kind: "retry" } : { kind: "none" },
    });
    expect(result.artifacts).toHaveLength(1);
    expect(committed.has(result.artifacts[0]!.hash)).toBe(true);
  });

  it("enforces the duration budget while the SDK session is still being created", async () => {
    const started = performance.now();
    const sessionFactory: PiSessionFactory = {
      model: runtimeUsageBase().model,
      create: async ({ signal }) => {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 150);
          signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(new Error("session creation aborted"));
            },
            { once: true },
          );
        });
        return createIdleSession();
      },
    };
    const runtime = new PiCodingRuntime({
      workspace: { execute: async () => workspaceRecord("inspect", "succeeded") },
      artifacts: { commit: commitArtifact },
      sessionFactory,
      clock: () => new Date("2026-08-05T09:00:00.000Z"),
    });

    const result = await runtime.execute(inspectionEnvelope(50));

    expect(performance.now() - started).toBeLessThan(120);
    expect(result.outcome.failure).toEqual({
      code: "budget_exhausted",
      retryable: false,
    });
  });

  it("does not accept success after a denied patch even when a test passes", async () => {
    const runtime = new PiCodingRuntime({
      workspace: {
        execute: async (request) =>
          workspaceRecord(
            request.operation,
            request.operation === "patch" ? "denied" : "succeeded",
          ),
      },
      artifacts: { commit: commitArtifact },
      sessionFactory: createFailureSessionFactory(async ({ handlers }) => {
        await handlers.patch!({
          files: [
            {
              path: "src/button.ts",
              expectedSha256: "0".repeat(64),
              content: "export const rounded = true;\n",
            },
          ],
        });
        await handlers.test!({
          command: { executable: "pnpm", arguments: ["test"] },
          workingDirectory: ".",
          timeoutMs: 1_000,
        });
        await handlers.submit({
          state: "succeeded",
          summary: "The repair passed.",
          request: { kind: "successor", nodeType: "browser.verify" },
        });
      }),
      clock: () => new Date("2026-08-05T09:00:00.000Z"),
    });

    const result = await runtime.execute(patchEnvelope());

    expect(result.outcome.failure).toEqual({
      code: "workspace_execution_failed",
      retryable: false,
    });
  });

  it("requires the passing test to occur after the final successful patch", async () => {
    const runtime = new PiCodingRuntime({
      workspace: {
        execute: async (request) => workspaceRecord(request.operation, "succeeded"),
      },
      artifacts: { commit: commitArtifact },
      sessionFactory: createFailureSessionFactory(async ({ handlers }) => {
        const patch = {
          files: [
            {
              path: "src/button.ts",
              expectedSha256: "0".repeat(64),
              content: "export const rounded = true;\n",
            },
          ],
        };
        await handlers.patch!(patch);
        await handlers.test!({
          command: { executable: "pnpm", arguments: ["test"] },
          workingDirectory: ".",
          timeoutMs: 1_000,
        });
        await handlers.patch!(patch);
        await handlers.submit({
          state: "succeeded",
          summary: "The repair passed.",
          request: { kind: "successor", nodeType: "browser.verify" },
        });
      }),
      clock: () => new Date("2026-08-05T09:00:00.000Z"),
    });

    const result = await runtime.execute(patchEnvelope());

    expect(result.outcome.failure).toEqual({
      code: "malformed_sdk_output",
      retryable: false,
    });
  });

  it("maps WorkspaceExecutor cleanup evidence to the typed cleanup outcome", async () => {
    const runtime = new PiCodingRuntime({
      workspace: {
        execute: async () =>
          workspaceRecord("test", "failed", "process_cleanup_failed"),
      },
      artifacts: { commit: commitArtifact },
      sessionFactory: createFailureSessionFactory(async ({ handlers }) => {
        await handlers.test!({
          command: { executable: "pnpm", arguments: ["test"] },
          workingDirectory: ".",
          timeoutMs: 1_000,
        });
      }),
      clock: () => new Date("2026-08-05T09:00:00.000Z"),
    });

    const result = await runtime.execute(patchEnvelope());

    expect(result.outcome.failure).toEqual({
      code: "process_cleanup_failed",
      retryable: false,
    });
  });
});

function runtimeUsage(overrides: Partial<ReturnType<typeof runtimeUsageBase>> = {}) {
  return { ...runtimeUsageBase(), ...overrides };
}

function runtimeUsageBase() {
  return {
    model: { provider: "scripted", id: "scripted-1" },
    modelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    durationMs: 0,
  };
}

function inspectionEnvelope(
  maxDurationMs = 30_000,
  deadline = "2026-08-05T09:05:00.000Z",
): RuntimeTaskEnvelope {
  return {
    schemaVersion: "prism.runtime-task-envelope/v1",
    runId,
    dagRevision: 1,
    nodeId: "node-1-workspace-inspect",
    nodeType: "workspace.inspect",
    attempt: 1,
    maxAttempts: 2,
    runtime: "coding",
    prompt: "Inspect the scoped source before proposing a repair.",
    inputArtifacts: [],
    authority: { workspaceOperations: ["inspect"] },
    budget: {
      maxModelCalls: 2,
      maxInputTokens: 1_000,
      maxOutputTokens: 500,
      maxTotalTokens: 1_500,
      maxCostUsd: 1,
      maxDurationMs,
    },
    deadline,
    cancellationId: "cancel-pi-failure",
    correlationId: runId,
    causationEventId: null,
    idempotencyKey: `${runId}:1:node-1-workspace-inspect:1`,
  };
}

function patchEnvelope(): RuntimeTaskEnvelope {
  return {
    ...inspectionEnvelope(),
    dagRevision: 2,
    nodeId: "node-2-workspace-patch-attempt-1",
    nodeType: "workspace.patch",
    maxAttempts: 1,
    authority: { workspaceOperations: ["inspect", "patch", "test"] },
    idempotencyKey: `${runId}:2:node-2-workspace-patch-attempt-1:1`,
  };
}

async function commitArtifact(
  content: string,
  mediaType: string,
): Promise<ArtifactRef> {
  return {
    schemaVersion: ARTIFACT_REF_SCHEMA_VERSION,
    algorithm: "sha256",
    hash: sha256(content),
    byteLength: Buffer.byteLength(content),
    mediaType,
  };
}

function workspaceRecord(
  operation: WorkspaceRequest["operation"],
  status: WorkspaceEvidenceRecord["evidence"]["status"],
  reasonCode: WorkspaceEvidenceRecord["evidence"]["reasonCode"] = status === "succeeded"
    ? null
    : "execution_failed",
): WorkspaceEvidenceRecord {
  const details =
    operation === "inspect"
      ? {
          operation,
          reads: [],
          discoveredPaths: [],
          discoveryTruncated: false,
        }
      : operation === "patch"
        ? { operation, files: [] }
        : {
            operation,
            command: { executable: "pnpm", arguments: ["test"] },
            workingDirectory: ".",
            exitCode: status === "succeeded" ? 0 : 1,
            stdout: "",
            stderr: "",
            outputTruncated: false,
            redactionCount: 0,
            durationMs: 1,
          };
  const content = `${operation}:${status}`;
  return workspaceEvidenceRecordSchema.parse({
    evidence: {
      schemaVersion: "prism.workspace-evidence/v1",
      requestId: randomUUID(),
      runId,
      operation,
      status,
      reasonCode,
      summary: `Workspace ${operation} ${status}.`,
      startedAt: "2026-08-05T09:00:00.000Z",
      finishedAt: "2026-08-05T09:00:00.001Z",
      details,
    },
    artifact: {
      schemaVersion: ARTIFACT_REF_SCHEMA_VERSION,
      algorithm: "sha256",
      hash: sha256(content),
      byteLength: Buffer.byteLength(content),
      mediaType: "application/vnd.prism.workspace-evidence+json",
    },
  });
}

function createIdleSession() {
  return {
    prompt: async () => undefined,
    abort: async () => undefined,
    dispose: () => undefined,
    getUsage: runtimeUsageBase,
  };
}

function createFailureSessionFactory(
  run: (context: {
    handlers: PiSessionHandlers;
    continueWithinBudget: Parameters<
      Awaited<ReturnType<PiSessionFactory["create"]>>["prompt"]
    >[1];
    setUsage: (usage: ReturnType<typeof runtimeUsageBase>) => void;
    waitForAbort: () => Promise<void>;
  }) => Promise<void>,
  disposeFails = false,
): PiSessionFactory {
  let usage = runtimeUsageBase();
  let releaseAbort: (() => void) | undefined;
  const aborted = new Promise<void>((resolve) => {
    releaseAbort = resolve;
  });
  return {
    model: usage.model,
    create: async ({ handlers }) => ({
      prompt: async (_prompt, continueWithinBudget) =>
        run({
          handlers,
          continueWithinBudget,
          setUsage: (next) => {
            usage = next;
          },
          waitForAbort: () => aborted,
        }),
      abort: async () => releaseAbort?.(),
      dispose: () => {
        if (disposeFails) throw new Error("cleanup failed");
      },
      getUsage: () => usage,
    }),
  };
}
