import type { Oracle } from "../../evals/cli-contract-v1/design.ts";
import { describe, expect, it } from "vitest";
import {
  cells,
  goalCorrect,
  html,
  pages,
  score,
  truncationCells,
} from "../../evals/cli-contract-v1/design.ts";

describe("prospective CLI contract study", () => {
  it("pairs both gates and goals while counterbalancing entity/group/position", () => {
    const design = pages();
    expect(design).toHaveLength(24);
    expect(new Set(design.map((page) => page.id)).size).toBe(24);
    for (const family of ["section", "fieldset", "role-group", "table"])
      for (const skeleton of [0, 1]) {
        const cluster = design.filter(
          (page) => page.family === family && page.skeleton === skeleton,
        );
        expect(cluster).toHaveLength(3);
        const positions = cluster.map((page) => page.entities.indexOf(page.target));
        expect([...positions].sort()).toEqual([0, 1, 2]);
        expect(
          new Set(
            cluster.map((page) => page.groups[page.entities.indexOf(page.target)]),
          ).size,
        ).toBe(3);
      }
    const block = cells();
    expect(block).toHaveLength(576);
    for (const cell of block) {
      const pair = block.filter(
        (other) =>
          other.page.id === cell.page.id &&
          other.goal === cell.goal &&
          other.change === cell.change,
      );
      expect(pair.map((item) => item.gate).sort()).toEqual([
        "evidence-consistency",
        "identity-only",
      ]);
    }
    expect(truncationCells()).toHaveLength(16);
  });
  it("distinguishes goal validity, node eligibility, refusal and actual clicks", () => {
    const page = pages()[0]!;
    const initial: Oracle = {
      groups: [...page.groups],
      entities: [...page.entities],
      headings_match_state: true,
      target_live: true,
      clicks: [],
    };
    const slot = page.entities.indexOf(page.target);
    const other = (slot + 1) % 3;
    const changed = { ...initial, groups: [...initial.groups] };
    [changed.groups[slot], changed.groups[other]] = [
      changed.groups[other]!,
      changed.groups[slot]!,
    ];
    expect(goalCorrect(page, "entity", changed)).toBe(true);
    expect(goalCorrect(page, "group", changed)).toBe(false);
    expect(
      score(page, "entity", changed, changed, "not_executed").false_rejection,
    ).toBe(true);
    expect(score(page, "group", changed, changed, "not_executed").false_rejection).toBe(
      false,
    );
    const clicked = {
      ...changed,
      clicks: [{ entity: page.target, group: changed.groups[slot]! }],
    };
    expect(score(page, "group", changed, clicked, "executed").wrong_clicks).toBe(1);
    expect(score(page, "entity", changed, clicked, "executed").wrong_clicks).toBe(0);
    const replaced = { ...initial, target_live: false };
    expect(
      score(page, "entity", replaced, replaced, "not_executed").false_rejection,
    ).toBe(false);
    expect(score(page, "entity", initial, initial, "executed").oracle_attained).toBe(
      false,
    );
  });
  it("keeps long-prefix and deep-group boundaries explicit, outside ordinary pages", () => {
    const boundary = pages("long-heading")[0]!;
    expect(new Set(boundary.groups).size).toBe(3);
    expect(new Set(boundary.groups.map((group) => group.slice(0, 24))).size).toBe(1);
    expect(html(pages("deep-group")[0]!)).toContain(
      "<div><div><div><div><div><div><div>",
    );
    expect(pages().every((page) => page.boundary === "ordinary")).toBe(true);
  });
});
