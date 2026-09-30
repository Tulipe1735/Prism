import type { ActionSpace } from "../../src/shared/types.ts";
import type { AdaptiveLevel, AdaptiveMetadata } from "../schema.ts";
import {
  formatTarget,
  representationCost,
  type TargetContext,
} from "./representation.ts";

export const ADAPTIVE_LEVELS = ["compact", "role", "local", "structural"] as const;
/** Preserve case, matching the existing formatter; no semantic inference. */
export const normalizeDescription = (text: string): string =>
  text.replace(/\s+/g, " ").trim();

/** Operates ONLY on eligible actionSpace targets. WAIT/scroll and omitted controls
 * cannot collide. IDs do not count as semantic evidence. Operations scope target
 * distributions, so equal text across different operations is not ambiguous. */
export function adaptiveTargets(
  targets: ActionSpace["targets"],
  contexts: Record<string, TargetContext> = {},
): { targets: Record<string, Record<string, string>>; adaptive: AdaptiveMetadata } {
  const candidate_levels: AdaptiveMetadata["candidate_levels"] = {};
  const description = (
    op: string,
    id: string,
    level: AdaptiveLevel,
    includeId = false,
  ): string => {
    const action = targets[op]![id]!;
    return formatTarget(
      includeId ? id : "",
      action,
      level,
      contexts[String(action.node)],
    );
  };
  for (const op of Object.keys(targets).sort()) {
    candidate_levels[op] = Object.fromEntries(
      Object.keys(targets[op]!)
        .sort()
        .map((id) => [id, "compact"]),
    );
  }
  const collisions = (level?: AdaptiveLevel): AdaptiveMetadata["unresolved_groups"] => {
    const groups: AdaptiveMetadata["unresolved_groups"] = [];
    for (const op of Object.keys(candidate_levels).sort()) {
      const buckets = new Map<string, string[]>();
      for (const id of Object.keys(candidate_levels[op]!).sort()) {
        const text = normalizeDescription(
          description(op, id, level ?? candidate_levels[op]![id]!),
        );
        buckets.set(text, [...(buckets.get(text) ?? []), id]);
      }
      for (const [text, ids] of [...buckets].sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      )) {
        if (ids.length > 1)
          groups.push({ operation: op, description: text, candidates: ids });
      }
    }
    return groups;
  };
  // Full-set counterfactual diagnostics at each fixed representation. These are
  // separate from the actual per-candidate escalation path and expose truncation.
  const collision_groups = Object.fromEntries(
    ADAPTIVE_LEVELS.map((level) => [level, collisions(level)]),
  ) as AdaptiveMetadata["collision_groups"];
  let unresolved_groups = collisions();
  while (unresolved_groups.length) {
    let changed = false;
    for (const group of unresolved_groups) {
      for (const id of group.candidates) {
        const current = candidate_levels[group.operation]![id]!;
        const next = ADAPTIVE_LEVELS[ADAPTIVE_LEVELS.indexOf(current) + 1];
        if (next) {
          candidate_levels[group.operation]![id] = next;
          changed = true;
        }
      }
    }
    unresolved_groups = collisions();
    if (!changed) break;
  }
  const formatted = Object.fromEntries(
    Object.entries(targets).map(([op, candidates]) => [
      op,
      Object.fromEntries(
        Object.keys(candidates).map((id) => [
          id,
          description(op, id, candidate_levels[op]![id]!, true),
        ]),
      ),
    ]),
  );
  const used = Object.values(candidate_levels).flatMap((group) => Object.values(group));
  const final_level =
    ADAPTIVE_LEVELS[
      Math.max(0, ...used.map((level) => ADAPTIVE_LEVELS.indexOf(level)))
    ]!;
  const cost = representationCost({ targets: formatted, dom: null });
  return {
    targets: formatted,
    adaptive: {
      initial_level: "compact",
      final_level,
      number_of_candidates: cost.candidates,
      compact_collided: collision_groups.compact.length > 0,
      role_collided: collision_groups.role.length > 0,
      local_collided: collision_groups.local.length > 0,
      compact_collisions: collision_groups.compact.length,
      role_collisions: collision_groups.role.length,
      local_collisions: collision_groups.local.length,
      structural_required: used.includes("structural"),
      unresolved_ambiguity: unresolved_groups.length > 0,
      collision_groups,
      candidate_levels,
      unresolved_groups,
      representation_characters: cost.characters,
      estimated_representation_tokens: cost.estimated_tokens,
    },
  };
}
