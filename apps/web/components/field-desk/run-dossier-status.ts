import type { RunDagNode, RunNodeProgress } from "@prism/contracts";

/** Empty-state copy must distinguish an active read-only phase from a settled Run. */
export function effectAuthorityEmptyMessage(orchestrationActive: boolean): string {
  return orchestrationActive
    ? "The initial read-only evidence is still running. A bounded effect proposal will appear here after browser and workspace observation settle."
    : "No effect is awaiting authority. Decisions, consumption, and recovery stay visible in the durable log below.";
}

export type RunSessionPhase = "observe" | "reason" | "act" | "verification";
export type RunSessionPhaseState = "waiting" | "active" | "complete" | "blocked";

function aggregatePhaseState(
  nodes: RunDagNode[],
  progressByNode: Map<string, RunNodeProgress>,
): RunSessionPhaseState {
  if (nodes.length === 0) return "waiting";

  const latestNodeByType = new Map<RunDagNode["nodeType"], RunDagNode>();
  for (const node of nodes) latestNodeByType.set(node.nodeType, node);

  const states = [...latestNodeByType.values()].map(
    (node) => progressByNode.get(node.nodeId)?.state ?? "ready",
  );
  if (states.some((state) => ["ready", "running", "retrying"].includes(state))) {
    return "active";
  }
  if (states.every((state) => state === "succeeded")) return "complete";
  return "blocked";
}

/** Project durable DAG nodes onto the four operator-facing agent phases. */
export function runSessionPhaseStates(
  nodes: RunDagNode[],
  progress: RunNodeProgress[],
): Record<RunSessionPhase, RunSessionPhaseState> {
  const progressByNode = new Map(progress.map((item) => [item.nodeId, item]));
  const stateFor = (...nodeTypes: RunDagNode["nodeType"][]) =>
    aggregatePhaseState(
      nodes.filter((node) => nodeTypes.includes(node.nodeType)),
      progressByNode,
    );

  const observe = stateFor("workspace.inspect", "browser.observe");
  const act = stateFor("workspace.patch");
  const verification = stateFor("browser.verify", "task.complete");
  const routedReason = stateFor("route.reclassify");
  const reason =
    routedReason !== "waiting"
      ? routedReason
      : observe === "blocked"
        ? "blocked"
        : observe !== "complete"
          ? "waiting"
          : act !== "waiting" || verification !== "waiting"
            ? "complete"
            : "active";

  return { observe, reason, act, verification };
}
