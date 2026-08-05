import type { RunDagNode, RuntimeTaskEnvelope } from "@prism/contracts";
import { describe, expect, it } from "vitest";

import { DagScheduler, Orchestrator, Router } from "./index";

describe("Router", () => {
  it("emits a validated hybrid initial revision with only registered read-only nodes", () => {
    const decision = new Router(() => new Date("2026-08-04T08:00:00.000Z")).route({
      runId: "run_6dbf6f33-69c4-4e5f-9898-3f693735f5f0",
      prompt: "Make the Save button visibly rounded and prove the rendered control.",
    });

    expect(decision).toMatchObject({
      classification: "hybrid",
      initialRevision: {
        revision: 1,
        nodes: [
          { nodeType: "workspace.inspect", effectClass: "read_only" },
          { nodeType: "browser.observe", effectClass: "read_only" },
        ],
      },
    });
  });
});

describe("DagScheduler", () => {
  it("runs independent reads concurrently but serializes source and browser effects with fences", async () => {
    const scheduler = new DagScheduler({
      maxReadOnlyConcurrency: 2,
      clock: () => new Date("2026-08-04T08:00:00.000Z"),
    });
    const nodes: RunDagNode[] = [
      {
        nodeId: "node-1-workspace-inspect",
        nodeType: "workspace.inspect",
        runtime: "coding",
        effectClass: "read_only",
        predecessorIds: [],
        maxAttempts: 2,
      },
      {
        nodeId: "node-1-browser-observe",
        nodeType: "browser.observe",
        runtime: "browser",
        effectClass: "read_only",
        predecessorIds: [],
        maxAttempts: 2,
      },
      {
        nodeId: "node-1-workspace-patch",
        nodeType: "workspace.patch",
        runtime: "coding",
        effectClass: "source_effect",
        predecessorIds: [],
        maxAttempts: 1,
      },
      {
        nodeId: "node-1-browser-verify",
        nodeType: "browser.verify",
        runtime: "browser",
        effectClass: "browser_effect",
        predecessorIds: [],
        maxAttempts: 1,
      },
    ];
    let activeReads = 0;
    let maxActiveReads = 0;
    let activeEffects = 0;
    let maxActiveEffects = 0;
    const leases: string[] = [];

    await scheduler.run(
      nodes,
      async (node) => {
        if (node.effectClass === "read_only") {
          activeReads += 1;
          maxActiveReads = Math.max(maxActiveReads, activeReads);
          await new Promise((resolve) => setTimeout(resolve, 15));
          activeReads -= 1;
          return;
        }

        activeEffects += 1;
        maxActiveEffects = Math.max(maxActiveEffects, activeEffects);
        await new Promise((resolve) => setTimeout(resolve, 15));
        activeEffects -= 1;
      },
      {
        onLease: (lease) => {
          leases.push(`${lease.state}:${lease.token}:${lease.holderNodeId}`);
        },
      },
    );

    expect(maxActiveReads).toBe(2);
    expect(maxActiveEffects).toBe(1);
    expect(leases).toEqual([
      "active:1:node-1-workspace-patch",
      "released:1:node-1-workspace-patch",
      "active:2:node-1-browser-verify",
      "released:2:node-1-browser-verify",
    ]);
  });
});

describe("Orchestrator", () => {
  it("durably appends Pi Coding Runtime outcomes and fences effects", async () => {
    const revisions: Array<{ revision: number; nodes: Array<{ nodeType: string }> }> =
      [];
    const progress: Array<{ nodeType: string; state: string; artifacts: unknown[] }> =
      [];
    const leases: string[] = [];
    const codingEnvelopes: RuntimeTaskEnvelope[] = [];
    const artifact = {
      schemaVersion: "prism.artifact-ref/v1" as const,
      algorithm: "sha256" as const,
      hash: "a".repeat(64),
      byteLength: 12,
      mediaType: "application/vnd.prism.runtime-evidence+json",
    };
    const journal = {
      appendDagRevision: async (revision: (typeof revisions)[number]) => {
        revisions.push(revision);
      },
      appendNodeProgress: async (entry: (typeof progress)[number]) => {
        progress.push(entry);
      },
      appendEffectLease: async (lease: { state: string; token: number }) => {
        leases.push(`${lease.state}:${lease.token}`);
      },
      writeRuntimeArtifact: async () => artifact,
    };

    const codingRuntime = {
      execute: async (envelope: RuntimeTaskEnvelope) => {
        codingEnvelopes.push(envelope);
        return {
          schemaVersion: "prism.pi-runtime-result/v1" as const,
          outcome: {
            nodeId: envelope.nodeId,
            attempt: envelope.attempt,
            state: "succeeded" as const,
            summary: `Pi completed ${envelope.nodeType}.`,
            request:
              envelope.nodeType === "workspace.inspect"
                ? ({ kind: "successor", nodeType: "workspace.patch" } as const)
                : ({ kind: "successor", nodeType: "browser.verify" } as const),
            failure: null,
          },
          artifacts: [artifact],
          usage: {
            model: { provider: "faux", id: "faux-1" },
            modelCalls: 1,
            inputTokens: 10,
            outputTokens: 2,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 12,
            costUsd: 0,
            durationMs: 5,
          },
        };
      },
    };

    await new Orchestrator({
      clock: () => new Date("2026-08-04T08:00:00.000Z"),
    }).executeHybridRun({
      runId: "run_6dbf6f33-69c4-4e5f-9898-3f693735f5f0",
      prompt: "Make the Save button visibly rounded and prove the rendered control.",
      journal,
      codingRuntime,
    });

    expect(revisions.map((revision) => revision.revision)).toEqual([1, 2, 3, 4]);
    expect(
      revisions.map((revision) => revision.nodes.map((node) => node.nodeType)),
    ).toEqual([
      ["workspace.inspect", "browser.observe"],
      ["workspace.inspect", "browser.observe", "workspace.patch"],
      ["workspace.inspect", "browser.observe", "workspace.patch", "browser.verify"],
      [
        "workspace.inspect",
        "browser.observe",
        "workspace.patch",
        "browser.verify",
        "task.complete",
      ],
    ]);
    expect(progress.filter((entry) => entry.state === "succeeded")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeType: "workspace.inspect",
          artifacts: [artifact],
        }),
        expect.objectContaining({ nodeType: "browser.observe", artifacts: [artifact] }),
        expect.objectContaining({ nodeType: "workspace.patch", artifacts: [artifact] }),
        expect.objectContaining({ nodeType: "browser.verify", artifacts: [artifact] }),
      ]),
    );
    expect(leases).toEqual(["active:1", "released:1", "active:2", "released:2"]);
    expect(codingEnvelopes).toEqual([
      expect.objectContaining({
        schemaVersion: "prism.runtime-task-envelope/v1",
        nodeType: "workspace.inspect",
        authority: { workspaceOperations: ["inspect"] },
      }),
      expect.objectContaining({
        nodeType: "workspace.patch",
        authority: { workspaceOperations: ["inspect", "patch", "test"] },
        inputArtifacts: [artifact],
      }),
    ]);
  });
});

it("adds a bounded retry attempt without creating a DAG cycle and blocks effects while uncertain", () => {
  const clock = () => new Date("2026-08-04T08:00:00.000Z");
  const router = new Router(clock);
  const orchestrator = new Orchestrator({ clock, router });
  const decision = router.route({
    runId: "run_6dbf6f33-69c4-4e5f-9898-3f693735f5f0",
    prompt: "Make the Save button visibly rounded and prove the rendered control.",
  });
  const workspaceNode = decision.initialRevision.nodes[0];
  const retryRevision = orchestrator.appendOutcomeRevision({
    revision: decision.initialRevision,
    nodeId: workspaceNode.nodeId,
    attempt: 1,
    completedNodeIds: [workspaceNode.nodeId],
    outcome: {
      nodeId: workspaceNode.nodeId,
      attempt: 1,
      state: "failed",
      summary: "Mock inspection timed out.",
      request: { kind: "retry", reason: "The read-only attempt timed out." },
      failure: { code: "timed_out", retryable: true },
    },
  });

  expect(retryRevision?.nodes.at(-1)).toMatchObject({
    nodeType: "workspace.inspect",
    predecessorIds: [workspaceNode.nodeId],
    nodeId: "node-2-workspace-inspect-attempt-2",
  });

  const uncertain = router.route({
    runId: "run_6dbf6f33-69c4-4e5f-9898-3f693735f5f0",
    prompt: "Investigate this unclear interface problem.",
  });
  const evidenceNode = uncertain.initialRevision.nodes[0];
  expect(() =>
    orchestrator.appendOutcomeRevision({
      revision: uncertain.initialRevision,
      nodeId: evidenceNode.nodeId,
      attempt: 1,
      completedNodeIds: [evidenceNode.nodeId],
      outcome: {
        nodeId: evidenceNode.nodeId,
        attempt: 1,
        state: "succeeded",
        summary: "Mock evidence is available.",
        request: { kind: "successor", nodeType: "workspace.patch" },
        failure: null,
      },
    }),
  ).toThrow(
    "Uncertain routes may request only read-only evidence before reclassification.",
  );
});
