import type {
  ActionRelations,
  RelationEntry,
  Representation,
  TargetContext,
} from "../../browser/representation.ts";
import type { ControlState, ObservedAction, PublicState } from "../../browser/state.ts";
import type { SnapshotAction } from "../../shared/types.ts";
import type { BrowserPage, Observation } from "./session.ts";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extractInPage, extractRelationsInPage } from "../../browser/representation.ts";
import { createStateReaderInPage } from "../../browser/state.ts";
import { StalePageError } from "./session.ts";

const snapshotSource = readFileSync(
  new URL("../../browser/snapshot.js", import.meta.url),
  "utf8",
);

export interface EvidenceCapture {
  snapshot: Omit<Observation, "actions"> & { actions: ObservedAction[] };
  contexts: Record<string, TargetContext>;
  relations: ActionRelations;
  state: PublicState;
}

export interface TargetCapture {
  contexts: EvidenceCapture["contexts"];
  relations: ActionRelations;
  current: ObservedAction;
}

export interface TargetEvidence {
  scope: Representation;
  description: string;
  state: Partial<Omit<ControlState, "name" | "role">>;
  context: {
    local?: string;
    container?: string;
    nearby_text?: string;
    section?: string;
  };
  relations?: Omit<RelationEntry, "tag">[];
}

/** Snapshot, target context, relations and public state in one synchronous page sample. */
export async function captureEvidence(
  session: BrowserPage,
  scope: Representation = "relations",
): Promise<EvidenceCapture> {
  return session.readObservation(async () => {
    const value = (await session.evaluate(
      `(() => {
      const snapshot = ${snapshotSource};
      if (!snapshot) return null;
      const reader = (${createStateReaderInPage.toString()})();
      snapshot.actions = snapshot.actions.map(reader.readAction);
      const nodes = [...new Set(snapshot.actions.flatMap(a => a.node === undefined ? [] : [a.node]))];
      const context = (${extractInPage.toString()})(nodes);
      const relations = ${scope === "relations" ? `(${extractRelationsInPage.toString()})(nodes)` : "{}"};
      return {snapshot, contexts: context.contexts, relations, state: reader.collect()};
    })()`,
    )) as EvidenceCapture | null;
    if (value === null || value === undefined)
      throw new StalePageError("The page could not be observed. Retry observe.");
    value.snapshot.fingerprint = digest(value.snapshot);
    return value;
  });
}

export async function readTargetEvidence(
  session: BrowserPage,
  action: SnapshotAction,
  scope: Representation = "relations",
): Promise<TargetCapture> {
  const nodes = action.node === undefined ? [] : [action.node];
  const value = (await session.evaluate(
    `(() => {
      const context = (${extractInPage.toString()})(${JSON.stringify(nodes)});
      const relations = ${scope === "relations" ? `(${extractRelationsInPage.toString()})(${JSON.stringify(nodes)})` : "{}"};
      const reader = (${createStateReaderInPage.toString()})();
      const current = reader.readAction(${JSON.stringify(action)});
      return {contexts: context.contexts, relations, current};
    })()`,
  )) as TargetCapture | null;
  if (value === null || value === undefined)
    throw new Error("Target context could not be read.");
  return value;
}

export function targetEvidence(
  action: ObservedAction,
  scope: Representation,
  context: TargetContext | undefined,
  relations: ActionRelations[string] = [],
): TargetEvidence {
  const displayed =
    scope === "structural"
      ? {
          container: (context?.container ?? "").slice(0, 24),
          nearby_text: (context?.nearby_text ?? "").slice(0, 120),
          section: (context?.section ?? "").slice(0, 48),
        }
      : { local: (context?.context ?? "").slice(0, 80) };
  if (action.node !== undefined && !action.control)
    throw new StalePageError("The observed target has no current control state.");
  const { name, role, ...state } = action.control ?? {
    name: action.label,
    role: action.role ?? "control",
  };
  return {
    scope,
    description: `${role} ${JSON.stringify(name)}`,
    state,
    context: displayed,
    ...(scope === "relations"
      ? {
          relations: relations.map(({ text, scope: group, layout }) => ({
            text,
            scope: group,
            ...(layout ? { layout } : {}),
          })),
        }
      : {}),
  };
}

export function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
