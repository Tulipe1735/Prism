import type { ChooseInput } from "../../evals/runtime/agent.ts";
import type { SnapshotAction } from "../../src/shared/types.ts";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { adaptiveTargets, normalizeDescription } from "../../evals/runners/adaptive.ts";
import { schedule } from "../../evals/runners/cohort.ts";
import { modelInput } from "../../evals/runners/model.ts";
import { representationFor } from "../../evals/runners/representation.ts";
import { cohortSchema, parseTasks } from "../../evals/schema.ts";
import { actionSpace } from "../../evals/runtime/action-space.ts";

const action = (node: number, label = "Delete", role = "button"): SnapshotAction => ({
  id: `e${node}`,
  node,
  label,
  role,
  kind: "click",
});
const ctx = (context: string, section = "") => ({
  context,
  section,
  nearby_text: context,
  container: "group",
});
const policy = (actions: SnapshotAction[], contexts = {}) =>
  adaptiveTargets(actionSpace(actions).targets, contexts);
it("unique labels remain compact", () => {
  const result = policy([action(1, "Save"), action(2, "Cancel")]);
  expect(result.adaptive).toMatchObject({
    initial_level: "compact",
    final_level: "compact",
    compact_collided: false,
    number_of_candidates: 2,
  });
  expect(result.targets.CLICK!["1"]).toBe("[1] Save");
});
it("duplicate labels with different roles resolve at role", () => {
  expect(policy([action(1, "Open", "link"), action(2, "Open")]).adaptive).toMatchObject(
    { final_level: "role", compact_collisions: 1, role_collisions: 0 },
  );
});
it("duplicate role and label with different local text resolve at local", () => {
  expect(
    policy([action(1), action(2)], { 1: ctx("Item A"), 2: ctx("Item B") }).adaptive,
  ).toMatchObject({
    final_level: "local",
    role_collisions: 1,
    local_collisions: 0,
    structural_required: false,
  });
});
it("same local text with different sections resolves at structural", () => {
  expect(
    policy([action(1), action(2)], {
      1: ctx("Draft", "Team Alpha"),
      2: ctx("Draft", "Team Beta"),
    }).adaptive,
  ).toMatchObject({
    final_level: "structural",
    local_collisions: 1,
    structural_required: true,
    unresolved_ambiguity: false,
  });
});
it("reports structural collisions instead of treating IDs as disambiguation", () => {
  const result = policy([action(1), action(2)], {
    1: ctx("Draft", "Team Alpha"),
    2: ctx("Draft", "Team Alpha"),
  });
  expect(result.adaptive).toMatchObject({
    final_level: "structural",
    unresolved_ambiguity: true,
  });
  expect(result.adaptive.unresolved_groups[0]!.candidates).toEqual(["1", "2"]);
});
it("ineligible hidden/disabled controls and WAIT do not contribute to candidate collisions", () => {
  // The snapshot owns eligibility; detector receives exactly the offered set.
  const controls = [
    { action: action(1), hidden: false, disabled: false },
    { action: action(2), hidden: true, disabled: false },
    { action: action(3), hidden: false, disabled: true },
  ];
  const eligible = controls
    .filter((c) => !c.hidden && !c.disabled)
    .map((c) => c.action);
  expect(
    policy([...eligible, { id: "wait", kind: "wait", label: "Delete" }]).adaptive,
  ).toMatchObject({
    final_level: "compact",
    number_of_candidates: 1,
    compact_collisions: 0,
  });
});
it("order changes do not alter chosen levels or collision count", () => {
  const actions = [action(1), action(2), action(3, "Save")];
  const contexts = { 1: ctx("Draft", "Team A"), 2: ctx("Draft", "Team B") };
  const a = policy(actions, contexts).adaptive;
  const b = policy([...actions].reverse(), contexts).adaptive;
  expect(a.final_level).toBe(b.final_level);
  expect(a.local_collisions).toBe(b.local_collisions);
  // Indices change with order, so compare levels by actual node identity.
  expect(Object.values(a.candidate_levels.CLICK!).sort()).toEqual(
    Object.values(b.candidate_levels.CLICK!).sort(),
  );
  const targets = actionSpace(actions).targets;
  const reversed = Object.fromEntries(
    Object.entries(targets).map(([op, group]) => [
      op,
      Object.fromEntries(Object.entries(group).reverse()),
    ]),
  );
  expect(adaptiveTargets(reversed, contexts).adaptive).toEqual(
    adaptiveTargets(targets, contexts).adaptive,
  );
});
it("normalizes repeated whitespace deterministically and preserves case", () => {
  expect(normalizeDescription("  Item \n B\t ")).toBe("Item B");
  expect(
    policy([action(1, " Delete "), action(2, "Delete")], {
      1: ctx(" Item   B "),
      2: ctx("Item B"),
    }).adaptive.final_level,
  ).toBe("structural");
  expect(policy([action(1, "Delete"), action(2, "delete")]).adaptive.final_level).toBe(
    "compact",
  );
});
it("expands only colliding groups and scopes collisions by operation", () => {
  const result = policy(
    [action(1), action(2), action(3, "Save"), { ...action(4), kind: "fill" }],
    { 1: ctx("A"), 2: ctx("B") },
  );
  expect(result.adaptive.candidate_levels).toEqual({
    CLICK: { 1: "local", 2: "local", 3: "compact" },
    TYPE_TEXT: { 4: "compact" },
  });
});
it("compares actual truncated descriptions, retains values, and never leaks unavailable local context", () => {
  expect(
    policy([action(1, "X".repeat(161)), action(2, `${"X".repeat(160)}Y`)]).adaptive
      .unresolved_ambiguity,
  ).toBe(true);
  expect(
    policy([
      { ...action(1), value: "a" },
      { ...action(2), value: "b" },
    ]).adaptive.final_level,
  ).toBe("compact");
  expect(policy([action(1), action(2)]).adaptive.unresolved_ambiguity).toBe(true);
});
it("integrates adaptive formatting without altering indexed operations, page or history", () => {
  const input = {
    goal: "Delete B",
    history: [],
    snapshot: {
      actions: [action(1), action(2)],
      url: "http://local",
      title: "test",
      text: "full page",
      w: 1120,
      h: 780,
      scroll: { y: 0, height: 780 },
      marker: [],
      page_key: [],
      guards: {},
      omitted_actions: 0,
      fingerprint: "test",
    },
  } satisfies ChooseInput;
  const evidence = { contexts: { 1: ctx("A"), 2: ctx("B") }, status: "Pending" };
  const adaptive = modelInput(input, false, null, "adaptive", evidence);
  const local = modelInput(input, false, null, "local", evidence);
  expect(adaptive.targets).toEqual(local.targets);
  expect(adaptive.operations).toEqual(local.operations);
  expect(adaptive.page).toEqual(local.page);
  expect(adaptive.history).toEqual(local.history);
  expect(representationFor("indexed-adaptive")).toBe("adaptive");
});
it("freezes a balanced 144-run new pilot without altering historical scheduling", async () => {
  const cohort = cohortSchema.parse(
    JSON.parse(await readFile("evals/cohorts/ambiguity-adaptive-v1.json", "utf8")),
  );
  const tasks = parseTasks(JSON.parse(await readFile(cohort.tasks, "utf8")));
  expect(tasks).toHaveLength(12);
  expect(schedule(tasks, cohort)).toHaveLength(144);
  expect(cohort.variants).toEqual([
    "indexed-local",
    "indexed-structural",
    "indexed-adaptive",
    "raw-selector",
  ]);
});
