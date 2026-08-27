import type { RunDagNode, RunNodeProgress } from "@prism/contracts";

import { describe, expect, it } from "vitest";

import {
  effectAuthorityEmptyMessage,
  runSessionPhaseStates,
} from "./run-dossier-status";

describe("Run dossier effect authority status", () => {
  it("does not report an empty authority queue while orchestration is active", () => {
    expect(effectAuthorityEmptyMessage(true)).toContain(
      "initial read-only evidence is still running",
    );
    expect(effectAuthorityEmptyMessage(true)).not.toContain(
      "No effect is awaiting authority",
    );
  });

  it("reports the settled empty authority queue accurately", () => {
    expect(effectAuthorityEmptyMessage(false)).toContain(
      "No effect is awaiting authority",
    );
  });
});

describe("Run session phases", () => {
  const node = (nodeId: string, nodeType: RunDagNode["nodeType"]): RunDagNode => ({
    nodeId,
    nodeType,
    runtime:
      nodeType === "workspace.inspect" || nodeType === "workspace.patch"
        ? "coding"
        : nodeType === "browser.observe" || nodeType === "browser.verify"
          ? "browser"
          : "orchestrator",
    effectClass:
      nodeType === "workspace.patch"
        ? "source_effect"
        : nodeType === "browser.verify"
          ? "browser_effect"
          : nodeType === "task.complete"
            ? "none"
            : "read_only",
    predecessorIds: [],
    maxAttempts: 2,
  });

  const progress = (
    dagNode: RunDagNode,
    state: RunNodeProgress["state"],
  ): RunNodeProgress => ({
    schemaVersion: "prism.run-node-progress/v1",
    revision: 1,
    nodeId: dagNode.nodeId,
    nodeType: dagNode.nodeType,
    attempt: 1,
    runtime: dagNode.runtime,
    effectClass: dagNode.effectClass,
    state,
    summary: "Test progress",
    artifacts: [],
    journalPosition: 1,
    correlationId: "test",
    causationEventId: null,
    recordedAt: "2026-08-28T00:00:00.000Z",
  });

  it("lights up observation while durable evidence is running", () => {
    const observe = node("node-observe", "browser.observe");

    expect(runSessionPhaseStates([observe], [progress(observe, "running")])).toEqual({
      observe: "active",
      reason: "waiting",
      act: "waiting",
      verification: "waiting",
    });
  });

  it("blocks observation when one required evidence source fails", () => {
    const workspace = node("node-workspace", "workspace.inspect");
    const browser = node("node-browser", "browser.observe");

    expect(
      runSessionPhaseStates(
        [workspace, browser],
        [progress(workspace, "succeeded"), progress(browser, "failed")],
      ),
    ).toEqual({
      observe: "blocked",
      reason: "blocked",
      act: "waiting",
      verification: "waiting",
    });
  });

  it("advances through reason when an action node is ready", () => {
    const observe = node("node-observe", "browser.observe");
    const act = node("node-act", "workspace.patch");

    expect(
      runSessionPhaseStates(
        [observe, act],
        [progress(observe, "succeeded"), progress(act, "ready")],
      ),
    ).toEqual({
      observe: "complete",
      reason: "complete",
      act: "active",
      verification: "waiting",
    });
  });
});
