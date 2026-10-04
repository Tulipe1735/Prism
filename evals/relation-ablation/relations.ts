import type { SnapshotAction } from "../../src/shared/types.ts";
import { Buffer } from "node:buffer";

/**
 * Arm-specific target formatting and public-DOM relation extraction for the
 * relation ablation block. Nothing here is imported by the frozen historical
 * runners, so the confirmatory/replication/external evidence inventories stay
 * byte-identical.
 *
 * Arms (see protocol.md):
 *   local      framed local context only                       (control)
 *   unbound    local context + every group lexeme + unknown association     (control)
 *   bound      local context + the same lexemes + candidate association       (treatment)
 *   structural frozen structural bundle                        (boundary)
 */
export interface TargetContext {
  context: string;
  container: string;
  nearby_text: string;
  section: string;
}
export interface RelationEntry {
  tag: number;
  text: string;
  scope: string;
}
export type ActionRelations = Record<string, RelationEntry[]>;
export interface OperationSpace {
  targets: Record<string, Record<string, SnapshotAction>>;
}
export interface TargetContextLike {
  context: string;
  container: string;
  nearby_text: string;
  section: string;
}

/** Frozen limits, identical to the historical formatter. */
export const ARM_LIMITS = {
  local: 80,
  nearby: 120,
  section: 48,
  container: 24,
  name: 160,
  group: 24,
};
/*
 * The page-side functions below run in the browser through `toString()` serialization, so
 * they cannot close over module scope: every selector and limit is inlined inside them.
 */

/**
 * Public-DOM group identities for the offered candidates.
 * The rule is fixed and shared by every arm: bounded ancestor walk from the candidate's
 * own container upward, restricted to group scopes that carry a dedicated identity element.
 * A candidate's own control container is never reported as a group, so no arm can turn a
 * local entity label into group evidence. The rule reads no goal, oracle or outcome.
 */
export function extractRelationsInPage(nodes: number[]): ActionRelations {
  const page = globalThis as any;
  const depthLimit = 6;
  const groupLimit = 24;
  const scopes = "section,tr,article,fieldset,li,[role='group'],[role='row']";
  const visible = (el: any): boolean =>
    !el.closest(
      '[hidden],[aria-hidden="true"],[inert],script,style,template,noscript',
    ) && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const collapsed = (el: any): string =>
    (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, groupLimit);
  // A group's identity element must be its direct child, so a nested candidate container's
  // own text can never be reported as the group identity.
  const identity = (el: any): string => {
    const direct = [...el.children];
    for (const tag of ["legend", "caption", "h1", "h2", "h3", "h4", "th"]) {
      const found = direct.find((child: any) => child.tagName === tag.toUpperCase());
      if (found && visible(found)) {
        const text = collapsed(found);
        if (text) return text;
      }
    }
    for (const tag of ["P", "SPAN", "STRONG", "EM", "DT", "SUMMARY"]) {
      const found = direct.find((child: any) => child.tagName === tag);
      if (found && visible(found)) {
        const text = collapsed(found);
        if (text) return text;
      }
    }
    return "";
  };
  const scopeName = (el: any): string =>
    el.getAttribute("role") ??
    (
      {
        TR: "row",
        ARTICLE: "card",
        LI: "list-item",
        FIELDSET: "fieldset",
        SECTION: "section",
      } as Record<string, string>
    )[el.tagName] ??
    "group";
  const tag = new Map<string, number>();
  const next = (key: string): number => {
    if (!tag.has(key)) tag.set(key, tag.size + 1);
    return tag.get(key)!;
  };
  // Visible text of the candidate's own control container, read the way the frozen local
  // context reads it. A candidate's own container text can never be a group identity.
  const containerWords = (element: any): Set<string> => {
    const words = new Set<string>();
    const root = element.parentElement;
    const walker = page.document.createTreeWalker(root, page.NodeFilter.SHOW_TEXT);
    let visited = 0;
    let current;
    while (visited++ < 200) {
      current = walker.nextNode();
      if (!current) break;
      const parent = current.parentElement;
      if (!parent || !visible(parent)) continue;
      if (
        parent.closest('button,a,input,select,textarea,[role="button"],[role="link"]')
      )
        continue;
      const text = current.textContent.replace(/\s+/g, " ").trim();
      if (text) words.add(text);
    }
    return words;
  };
  const relations: ActionRelations = {};
  for (const node of nodes) {
    const element = page.__jevFast.nodes.get(node);
    if (!element) continue;
    const own = containerWords(element);
    const found: RelationEntry[] = [];
    const seen = new Set<string>();
    let ancestor = element.parentElement;
    for (let depth = 1; ancestor && depth <= depthLimit; depth++) {
      if (!ancestor.matches(scopes) || !visible(ancestor)) {
        ancestor = ancestor.parentElement;
        continue;
      }
      const text = identity(ancestor);
      const scope = scopeName(ancestor);
      ancestor = ancestor.parentElement;
      if (!text || seen.has(text)) continue;
      if (own.has(text)) continue;
      seen.add(text);
      // Nearest group first; deeper groups describe the candidate more specifically.
      found.unshift({ tag: next(text), text, scope });
    }
    if (found.length) relations[String(node)] = found;
  }
  // Assign IDs by public text, never by candidate or DOM encounter order.
  const texts = [
    ...new Set(
      Object.values(relations)
        .flat()
        .map((entry) => entry.text),
    ),
  ].sort();
  for (const entries of Object.values(relations))
    for (const entry of entries) entry.tag = texts.indexOf(entry.text) + 1;
  return relations;
}

/** Every group identity reachable from the offered candidates, in page-tag order. */
export function pooledRelations(
  relations: ActionRelations,
  nodes: number[],
): RelationEntry[] {
  const byTag = new Map<number, RelationEntry>();
  for (const node of nodes)
    for (const entry of relations[String(node)] ?? [])
      if (!byTag.has(entry.tag)) byTag.set(entry.tag, entry);
  return [...byTag.values()].sort((left, right) => left.tag - right.tag);
}

/** Arm identifier to the format its target lines use, e.g. `indexed-bound` -> `bound`. */
export function formatForArm(arm: string): string {
  return arm.startsWith("indexed-") ? arm.slice(8) : arm;
}

export function relationLine(relations: RelationEntry[]): string {
  return relations
    .map((entry) => `[R${entry.tag}: ${entry.text.replace(/\s+/g, " ").trim()}]`)
    .join(" ");
}

/**
 * Target line for one arm. The `local` and `structural` branches reproduce the frozen
 * formatter byte-for-byte; `bound`/`unbound` add exactly one `groups:` line on top of the
 * same local fields, so both carry the same group lexemes. Only `belongs_to` references differ.
 * Unknown markers have the same byte length as their bound references.
 */
export function formatArmTarget(
  id: string,
  action: Pick<SnapshotAction, "label" | "role" | "value" | "current_value">,
  arm: string,
  context?: TargetContextLike,
  bound: RelationEntry[] = [],
  pooled: RelationEntry[] = [],
): string {
  const name = action.label.replace(/\s+/g, " ").trim().slice(0, ARM_LIMITS.name);
  let line = `[${id}] ${arm === "compact" ? name : `${action.role ?? "control"} ${JSON.stringify(name)}`}`;
  if (action.current_value || action.value)
    line += ` value=${JSON.stringify(action.current_value ?? action.value)}`;
  if (arm === "local" && context?.context)
    line += `\n  context: ${context.context.slice(0, ARM_LIMITS.local)}`;
  if (arm === "bound" || arm === "unbound") {
    if (context?.context)
      line += `\n  context: ${context.context.slice(0, ARM_LIMITS.local)}`;
    if (pooled.length) {
      line += `\n  groups: ${relationLine(pooled)}`;
      const width = Math.max(...pooled.map((entry) => String(entry.tag).length));
      const references = bound.map((entry) =>
        arm === "bound"
          ? `R${String(entry.tag).padStart(width, "0")}`
          : "?".repeat(width + 1),
      );
      line += `\n  belongs_to: ${references.length ? references.join(" ") : "unknown"}`;
    }
  }
  if (arm === "structural" && context) {
    if (context.container)
      line += `\n  container: ${context.container.slice(0, ARM_LIMITS.container)}`;
    if (context.nearby_text)
      line += `\n  nearby_text: ${context.nearby_text.slice(0, ARM_LIMITS.nearby)}`;
    // Preserve the original extractor value, including cases where it misses the group.
    const section = context.section;
    if (section && !context.nearby_text.includes(section))
      line += `\n  section: ${section.slice(0, ARM_LIMITS.section)}`;
  }
  return line;
}

/** Representation-cost estimate compatible with the historical `utf8-bytes-div-4` proxy. */
export function armCost(payload: { targets: Record<string, Record<string, string>> }): {
  candidates: number;
  characters: number;
  estimated_tokens: number;
} {
  const text = JSON.stringify(payload.targets);
  const candidates = Object.values(payload.targets).reduce(
    (total, group) => total + Object.keys(group).length,
    0,
  );
  const characters = Array.from(text).length;
  return {
    candidates,
    characters,
    estimated_tokens: Math.ceil(Buffer.byteLength(text, "utf8") / 4),
  };
}
