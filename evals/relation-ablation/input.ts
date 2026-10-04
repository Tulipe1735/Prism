import type { Snapshot, SnapshotAction } from "../../src/shared/types.ts";
import type {
  ActionRelations,
  OperationSpace,
  TargetContextLike,
} from "./relations.ts";
import { actionSpace } from "../../src/runtime/action-space.ts";
import { decisionOperations } from "../../src/runtime/decision.ts";
import { actionEvidence } from "../runners/representation.ts";
import {
  extractRelationsInPage,
  formatArmTarget,
  formatForArm,
  pooledRelations,
} from "./relations.ts";

/**
 * The model-facing payload for one decision. Field order and global-shape rules mirror the
 * frozen `evals/runners/model.ts` builder so the L/S control arms stay byte-comparable with
 * the historical representation study; only the arm-specific target lines differ.
 */
/** Contexts as read by the frozen extractor plus the block's own scope identity. */
export type ObservedContexts = Record<string, TargetContextLike>;

export interface ArmPayload {
  goal: string;
  page: { url: string; title: string; text: string };
  dom: null;
  dom_truncated: false;
  target_mode: "indexed";
  targets: Record<string, Record<string, string>>;
  operations: Record<string, string>;
  history: {
    action: string;
    kind: string;
    text: string | null;
    page_changed: boolean | null;
  }[];
}

export interface HistoryEntry {
  action: string;
  kind: string;
  text: string | null;
  page_changed: boolean | null;
}

export function armPayload(options: {
  arm: string;
  goal: string;
  snapshot: Snapshot;
  evidence: { contexts: ObservedContexts; status: string };
  relations: ActionRelations;
  history: HistoryEntry[];
}): ArmPayload {
  const { arm, goal, snapshot, evidence, relations, history } = options;
  const format = formatForArm(arm);
  const space: OperationSpace = actionSpace(snapshot.actions);
  const targets = Object.fromEntries(
    Object.entries(space.targets).map(([operation, candidates]) => [
      operation,
      (() => {
        const nodes = Object.values(candidates).flatMap((action: SnapshotAction) =>
          action.node === undefined ? [] : [action.node],
        );
        const pooled = pooledRelations(relations, nodes);
        return Object.fromEntries(
          Object.entries(candidates).map(([id, action]) => [
            id,
            formatArmTarget(
              id,
              action,
              format,
              evidence.contexts[String(action.node)],
              relations[String(action.node)] ?? [],
              pooled,
            ),
          ]),
        );
      })(),
    ]),
  );
  return {
    goal,
    page: { url: snapshot.url, title: snapshot.title, text: evidence.status },
    dom: null,
    dom_truncated: false,
    target_mode: "indexed",
    targets,
    operations: decisionOperations(snapshot),
    history: history.slice(-10),
  };
}

/** Frozen bounded context/status reader; identical bytes to the historical study. */
export const observeContexts = actionEvidence;

/** In-page relation extraction for the experiment arm; never reads the goal or the oracle. */
export async function observeRelations(
  session: { call: (method: string, params?: object) => Promise<any> },
  snapshot: Snapshot,
): Promise<ActionRelations> {
  const nodes = [
    ...new Set(
      snapshot.actions.flatMap((action) =>
        action.node === undefined ? [] : [action.node],
      ),
    ),
  ];
  const result = await session.call("Runtime.evaluate", {
    expression: `(${extractRelationsInPage.toString()})(${JSON.stringify(nodes)})`,
    returnByValue: true,
  });
  if (result.exceptionDetails || !result.result?.value)
    throw new Error("Action relation observation failed.");
  return result.result.value as ActionRelations;
}
