import {
  type ArtifactRef,
  type EffectLease,
  type NodeOutcome,
  nodeOutcomeSchema,
  ROUTER_DECISION_SCHEMA_VERSION,
  type RouterClassification,
  type RouterDecision,
  routerDecisionSchema,
  type RunDagNode,
  runDagNodeRegistry,
  type RunDagNodeType,
  type RunDagRevision,
  runDagRevisionSchema,
  type RunNodeProgress,
} from "@prism/contracts";

export interface RouterInput {
  runId: string;
  prompt: string;
}

function includesAny(value: string, terms: readonly string[]): boolean {
  return terms.some((term) => value.includes(term));
}

function classify(prompt: string): RouterClassification {
  const normalized = prompt.toLowerCase();
  if (includesAny(normalized, ["unclear", "unsure", "maybe", "investigate"])) {
    return "uncertain";
  }

  const coding = includesAny(normalized, [
    "button",
    "css",
    "style",
    "shadow",
    "dialog",
    "form",
    "layout",
    "radius",
  ]);
  const browser = includesAny(normalized, [
    "visible",
    "button",
    "render",
    "rendered",
    "click",
    "page",
    "browser",
    "ui",
  ]);

  if (coding && browser) return "hybrid";
  if (coding) return "coding";
  if (browser) return "browser";
  return "uncertain";
}

function initialNodes(classification: RouterClassification): RunDagNode[] {
  const workspace: RunDagNode = {
    nodeId: "node-1-workspace-inspect",
    nodeType: "workspace.inspect",
    runtime: "coding",
    effectClass: "read_only",
    predecessorIds: [],
    maxAttempts: 2,
  };
  const browser: RunDagNode = {
    nodeId: "node-1-browser-observe",
    nodeType: "browser.observe",
    runtime: "browser",
    effectClass: "read_only",
    predecessorIds: [],
    maxAttempts: 2,
  };

  if (classification === "coding") return [workspace];
  if (classification === "browser") return [browser];
  return [workspace, browser];
}

type RequiredCapability = RouterDecision["requiredCapabilities"][number];

function capabilities(classification: RouterClassification): RequiredCapability[] {
  if (classification === "coding") return ["workspace_read", "source_effect"];
  if (classification === "browser") return ["browser_read", "browser_effect"];
  if (classification === "hybrid") {
    return ["workspace_read", "browser_read", "source_effect", "browser_effect"];
  }
  return ["workspace_read", "browser_read"];
}

export class Router {
  constructor(private readonly clock: () => Date = () => new Date()) {}

  route(input: RouterInput): RouterDecision {
    const classification = classify(input.prompt);
    const initialRevision: RunDagRevision = {
      schemaVersion: "prism.run-dag-revision/v1",
      revision: 1,
      classification,
      createdAt: this.clock().toISOString(),
      nodes: initialNodes(classification),
    };

    return routerDecisionSchema.parse({
      schemaVersion: ROUTER_DECISION_SCHEMA_VERSION,
      classification,
      confidence: classification === "uncertain" ? 0.3 : 0.9,
      requiredCapabilities: capabilities(classification),
      initialRevision,
    });
  }
}
export interface DagSchedulerOptions {
  maxReadOnlyConcurrency?: number;
  clock?: () => Date;
}

export interface DagSchedulerCallbacks {
  onLease?: (lease: EffectLease) => void | Promise<void>;
}

export class DagScheduler {
  private readonly clock: () => Date;
  private readonly maxReadOnlyConcurrency: number;
  private nextFencingToken = 0;

  constructor(options: DagSchedulerOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
    this.maxReadOnlyConcurrency = Math.max(1, options.maxReadOnlyConcurrency ?? 2);
  }

  async run<T>(
    nodes: readonly RunDagNode[],
    execute: (node: RunDagNode, fencingToken: number | null) => Promise<T>,
    callbacks: DagSchedulerCallbacks = {},
  ): Promise<Map<string, T>> {
    const results = new Map<string, T>();
    const readOnlyNodes = nodes.filter(
      (node) => node.effectClass === "read_only" || node.effectClass === "none",
    );
    const effectNodes = nodes.filter(
      (
        node,
      ): node is RunDagNode & {
        effectClass: "source_effect" | "browser_effect";
      } =>
        node.effectClass === "source_effect" || node.effectClass === "browser_effect",
    );
    let nextReadOnlyIndex = 0;

    await Promise.all(
      Array.from(
        { length: Math.min(this.maxReadOnlyConcurrency, readOnlyNodes.length) },
        async () => {
          while (nextReadOnlyIndex < readOnlyNodes.length) {
            const node = readOnlyNodes[nextReadOnlyIndex];
            nextReadOnlyIndex += 1;
            results.set(node.nodeId, await execute(node, null));
          }
        },
      ),
    );

    for (const node of effectNodes) {
      const token = ++this.nextFencingToken;
      const activeLease: EffectLease = {
        schemaVersion: "prism.effect-lease/v1",
        token,
        holderNodeId: node.nodeId,
        effectClass: node.effectClass,
        state: "active",
        recordedAt: this.clock().toISOString(),
      };
      await callbacks.onLease?.(activeLease);
      try {
        results.set(node.nodeId, await execute(node, token));
      } finally {
        await callbacks.onLease?.({
          ...activeLease,
          state: "released",
          recordedAt: this.clock().toISOString(),
        });
      }
    }

    return results;
  }
}
export type RunNodeProgressInput = Omit<
  RunNodeProgress,
  "schemaVersion" | "journalPosition" | "causationEventId" | "recordedAt"
>;

export interface OrchestrationJournal {
  appendDagRevision: (revision: RunDagRevision) => Promise<void>;
  appendNodeProgress: (progress: RunNodeProgressInput) => Promise<void>;
  appendEffectLease: (lease: EffectLease) => Promise<void>;
  writeRuntimeArtifact: (
    content: string,
    mediaType: "application/vnd.prism.runtime-evidence+json",
  ) => Promise<ArtifactRef>;
}

export interface ExecuteMockHybridRunInput {
  runId: string;
  prompt: string;
  journal: OrchestrationJournal;
}

export interface OrchestratorOptions {
  clock?: () => Date;
  router?: Router;
  scheduler?: DagScheduler;
  mockRuntimeDelayMs?: number;
}

function nextNodeId(
  revision: number,
  nodeType: RunDagNodeType,
  attempt: number,
): string {
  return `node-${revision}-${nodeType.replace(".", "-")}-attempt-${attempt}`;
}

function attemptsFor(nodeType: RunDagNodeType): number {
  return runDagNodeRegistry[nodeType].effectClass === "read_only" ? 2 : 1;
}

function mockOutcome(node: RunDagNode, attempt: number): NodeOutcome {
  const request =
    node.nodeType === "workspace.inspect"
      ? { kind: "successor" as const, nodeType: "workspace.patch" as const }
      : node.nodeType === "workspace.patch"
        ? { kind: "successor" as const, nodeType: "browser.verify" as const }
        : node.nodeType === "browser.verify"
          ? { kind: "successor" as const, nodeType: "task.complete" as const }
          : { kind: "none" as const };

  return nodeOutcomeSchema.parse({
    nodeId: node.nodeId,
    attempt,
    state: "succeeded",
    summary: `Mock ${node.runtime} runtime completed ${node.nodeType}.`,
    evidence: {
      mediaType: "application/vnd.prism.runtime-evidence+json",
      content: JSON.stringify({
        runtime: node.runtime,
        nodeId: node.nodeId,
        attempt,
        nodeType: node.nodeType,
      }),
    },
    request,
  });
}

export class Orchestrator {
  private readonly clock: () => Date;
  private readonly router: Router;
  private readonly scheduler: DagScheduler;
  private readonly mockRuntimeDelayMs: number;

  constructor(options: OrchestratorOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
    this.router = options.router ?? new Router(this.clock);
    this.scheduler = options.scheduler ?? new DagScheduler({ clock: this.clock });
    this.mockRuntimeDelayMs = Math.max(0, options.mockRuntimeDelayMs ?? 75);
  }

  appendOutcomeRevision({
    revision,
    nodeId,
    attempt,
    outcome,
    completedNodeIds,
  }: {
    revision: RunDagRevision;
    nodeId: string;
    attempt: number;
    outcome: NodeOutcome;
    completedNodeIds: readonly string[];
  }): RunDagRevision | null {
    const node = revision.nodes.find((candidate) => candidate.nodeId === nodeId);
    if (!node || outcome.nodeId !== nodeId || outcome.attempt !== attempt) {
      throw new TypeError(
        "Runtime outcomes must match the scheduled Run DAG node attempt.",
      );
    }

    if (outcome.request.kind === "none") return null;
    if (outcome.request.kind === "reclassify") {
      if (revision.classification !== "uncertain") {
        throw new TypeError("Only uncertain routes may be reclassified.");
      }
      return runDagRevisionSchema.parse({
        ...revision,
        revision: revision.revision + 1,
        classification: outcome.request.classification,
        createdAt: this.clock().toISOString(),
      });
    }

    const targetType =
      outcome.request.kind === "retry" ? node.nodeType : outcome.request.nodeType;
    const targetDefinition = runDagNodeRegistry[targetType];
    const legalSuccessors = runDagNodeRegistry[node.nodeType]
      .legalSuccessors as readonly string[];
    if (!legalSuccessors.includes(targetType)) {
      throw new TypeError(
        "Runtime outcomes may request only registered legal successors.",
      );
    }
    if (
      revision.classification === "uncertain" &&
      targetDefinition.effectClass !== "read_only" &&
      targetDefinition.effectClass !== "none"
    ) {
      throw new TypeError(
        "Uncertain routes may request only read-only evidence before reclassification.",
      );
    }
    if (outcome.request.kind === "retry" && attempt >= node.maxAttempts) {
      throw new TypeError("The node exhausted its bounded retry allowance.");
    }
    if (
      outcome.request.kind !== "retry" &&
      revision.nodes.some((candidate) => candidate.nodeType === targetType)
    ) {
      return null;
    }

    const predecessorIds =
      outcome.request.kind === "retry"
        ? [node.nodeId]
        : completedNodeIds.filter((candidateId) => {
            const predecessor = revision.nodes.find(
              (candidate) => candidate.nodeId === candidateId,
            );
            return (
              predecessor !== undefined &&
              (
                runDagNodeRegistry[predecessor.nodeType]
                  .legalSuccessors as readonly string[]
              ).includes(targetType)
            );
          });
    const nextAttempt = outcome.request.kind === "retry" ? attempt + 1 : 1;
    const nextNode: RunDagNode = {
      nodeId: nextNodeId(revision.revision + 1, targetType, nextAttempt),
      nodeType: targetType,
      runtime: targetDefinition.runtime,
      effectClass: targetDefinition.effectClass,
      predecessorIds,
      maxAttempts: attemptsFor(targetType),
    };

    return runDagRevisionSchema.parse({
      ...revision,
      revision: revision.revision + 1,
      createdAt: this.clock().toISOString(),
      nodes: [...revision.nodes, nextNode],
    });
  }

  async executeMockHybridRun(
    input: ExecuteMockHybridRunInput,
  ): Promise<RunDagRevision> {
    const decision = this.router.route({ runId: input.runId, prompt: input.prompt });
    let revision = decision.initialRevision;
    const completedNodeIds = new Set<string>();
    const attempts = new Map<string, number>();

    await input.journal.appendDagRevision(revision);

    while (true) {
      const ready = revision.nodes.filter(
        (node) =>
          !completedNodeIds.has(node.nodeId) &&
          node.predecessorIds.every((predecessorId) =>
            completedNodeIds.has(predecessorId),
          ),
      );
      if (ready.length === 0) return revision;

      const outcomes = await this.scheduler.run(
        ready,
        async (node) => {
          const attempt = attempts.get(node.nodeId) ?? 1;
          attempts.set(node.nodeId, attempt);
          await input.journal.appendNodeProgress({
            revision: revision.revision,
            nodeId: node.nodeId,
            nodeType: node.nodeType,
            attempt,
            runtime: node.runtime,
            effectClass: node.effectClass,
            state: "running",
            summary: `Mock ${node.runtime} runtime started ${node.nodeType}.`,
            artifacts: [],
            correlationId: input.runId,
          });
          if (this.mockRuntimeDelayMs > 0) {
            await new Promise<void>((resolve) => {
              setTimeout(resolve, this.mockRuntimeDelayMs);
            });
          }
          const outcome = mockOutcome(node, attempt);
          const artifact = await input.journal.writeRuntimeArtifact(
            outcome.evidence.content,
            outcome.evidence.mediaType,
          );
          await input.journal.appendNodeProgress({
            revision: revision.revision,
            nodeId: node.nodeId,
            nodeType: node.nodeType,
            attempt,
            runtime: node.runtime,
            effectClass: node.effectClass,
            state: outcome.state,
            summary: outcome.summary,
            artifacts: [artifact],
            correlationId: input.runId,
          });
          return outcome;
        },
        { onLease: input.journal.appendEffectLease },
      );

      for (const [nodeId, outcome] of outcomes) {
        completedNodeIds.add(nodeId);
        const nextRevision = this.appendOutcomeRevision({
          revision,
          nodeId,
          attempt: attempts.get(nodeId) ?? 1,
          outcome,
          completedNodeIds: [...completedNodeIds],
        });
        if (nextRevision) {
          revision = nextRevision;
          await input.journal.appendDagRevision(revision);
        }
      }
    }
  }
}
