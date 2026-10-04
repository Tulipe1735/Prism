import type { SnapshotAction } from "../shared/types.ts";
import type {
  ActionRelations,
  Representation,
  TargetContext,
} from "./representation.ts";
import type { BrowserSession, Observation } from "./session.ts";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  extractInPage,
  extractRelationsInPage,
  formatTarget,
} from "./representation.ts";

const snapshotSource = readFileSync(new URL("./snapshot.js", import.meta.url), "utf8");
export interface EvidenceCapture {
  snapshot: Observation;
  contexts: Record<string, TargetContext>;
  relations: ActionRelations;
  status: string;
}

/** Snapshot and public context are read in one synchronous page evaluation. */
export async function captureEvidence(
  session: BrowserSession,
): Promise<EvidenceCapture> {
  await session.observe(); // Preserve the executor's post-input settling policy.
  const response = await session.call("Runtime.evaluate", {
    expression: `(() => {
      const snapshot = ${snapshotSource};
      if (!snapshot) return null;
      const nodes = [...new Set(snapshot.actions.flatMap(a => a.node === undefined ? [] : [a.node]))];
      const context = (${extractInPage.toString()})(nodes);
      const relations = (${extractRelationsInPage.toString()})(nodes);
      return {snapshot, ...context, relations};
    })()`,
    returnByValue: true,
  });
  if (response.exceptionDetails || !response.result?.value)
    throw new Error("The page could not be observed. Retry observe.");
  const value = response.result.value as EvidenceCapture;
  value.snapshot.fingerprint = digest(value.snapshot);
  return value;
}

export async function readTargetEvidence(
  session: BrowserSession,
  action: SnapshotAction,
): Promise<Omit<EvidenceCapture, "snapshot">> {
  const nodes = action.node === undefined ? [] : [action.node];
  const response = await session.call("Runtime.evaluate", {
    expression: `(() => {
      const context = (${extractInPage.toString()})(${JSON.stringify(nodes)});
      const relations = (${extractRelationsInPage.toString()})(${JSON.stringify(nodes)});
      return {...context, relations};
    })()`,
    returnByValue: true,
  });
  if (response.exceptionDetails || !response.result?.value)
    throw new Error("Target context could not be read.");
  return response.result.value as Omit<EvidenceCapture, "snapshot">;
}

export interface TargetEvidence {
  scope: Representation;
  description: string;
  context: {
    local?: string;
    container?: string;
    nearby_text?: string;
    section?: string;
  };
  relations?: { text: string; scope: string }[];
}
export function targetEvidence(
  action: SnapshotAction,
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
  return {
    scope,
    description: formatTarget(
      action.id,
      action,
      scope === "relations" ? "local" : scope,
      context,
    ),
    context: displayed,
    ...(scope === "relations"
      ? { relations: relations.map(({ text, scope }) => ({ text, scope })) }
      : {}),
  };
}
export function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
