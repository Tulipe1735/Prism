import type { ChooseInput } from "../../src/runtime/agent.ts";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { schedule } from "../../evals/runners/cohort.ts";
import { modelInput } from "../../evals/runners/model.ts";
import {
  formatTarget,
  representationCost,
  representationFor,
} from "../../evals/runners/representation.ts";
import { cohortSchema, parseTasks } from "../../evals/schema.ts";

const action = { label: "Delete", role: "button" };
const context = {
  context: "Item B | $29.99",
  container: "row",
  nearby_text: "Item B | $29.99",
  section: "Cart",
};
it("formats controlled increments of information without leaking richer fields into simpler arms", () => {
  expect(formatTarget("37", action, "compact", context)).toBe("[37] Delete");
  expect(formatTarget("37", action, "role", context)).toBe('[37] button "Delete"');
  expect(formatTarget("37", action, "local", context)).toBe(
    '[37] button "Delete"\n  context: Item B | $29.99',
  );
  expect(formatTarget("37", action, "structural", context)).toBe(
    '[37] button "Delete"\n  container: row\n  nearby_text: Item B | $29.99\n  section: Cart',
  );
  expect(representationFor("indexed-local")).toBe("local");
});
it("computes an explicitly estimated representation cost including map syntax and locator evidence", () => {
  const input = { targets: { CLICK: { "1": "[1] Delete" } }, dom: null } as Parameters<
    typeof representationCost
  >[0];
  const cost = representationCost(input);
  expect(cost).toMatchObject({
    candidates: 1,
    characters: JSON.stringify(input.targets).length,
    estimator: "utf8-bytes-div-4",
  });
  expect(cost.estimated_tokens).toBe(Math.ceil(cost.characters / 4));
  expect(representationCost({ ...input, dom: "<body/>" }).characters).toBe(
    cost.characters + 7,
  );
});
it("holds operations/history/page evidence constant and varies only bounded target descriptions", () => {
  const input: ChooseInput = {
    goal: "Delete Item B",
    history: [],
    snapshot: {
      url: "http://local",
      title: "test",
      text: "Item A Delete Item B Delete",
      actions: [
        { id: "e1", kind: "click", node: 1, ...action },
        { id: "wait", kind: "wait", label: "Wait" },
      ],
      w: 1120,
      h: 780,
      scroll: { y: 0, height: 780 },
      marker: [],
      page_key: [],
      guards: {},
      omitted_actions: 0,
      fingerprint: "test",
    },
  };
  const evidence = { contexts: { "1": context }, status: "Pending" };
  const models = (["compact", "role", "local", "structural"] as const).map((rep) =>
    modelInput(input, false, null, rep, evidence),
  );
  for (const m of models) {
    expect(m.page.text).toBe("Pending");
    expect(m.dom).toBeNull();
    expect(m.operations).toEqual(models[0]!.operations);
    expect(m.history).toEqual(models[0]!.history);
  }
  expect(JSON.stringify(models[0])).not.toContain("Item A");
  expect(models[0]!.targets.CLICK!["1"]).not.toContain("Item B");
  expect(models[2]!.targets.CLICK!["1"]).toContain("Item B");
});
it("schedules 800 unique initial runs with no reliability ablation and supports disjoint repeat offsets", async () => {
  const tasks = parseTasks(
    JSON.parse(await readFile("evals/tasks/ambiguity-study.json", "utf8")),
  );
  const cohort = cohortSchema.parse(
    JSON.parse(await readFile("evals/cohorts/ambiguity-initial.json", "utf8")),
  );
  expect(tasks).toHaveLength(16);
  expect(schedule(tasks, cohort)).toHaveLength(800);
  const extension = schedule(tasks.slice(0, 1), {
    ...cohort,
    repeats: 10,
    repetitionOffset: 10,
  });
  expect(extension[0]!.repetition).toBe(10);
  expect(extension.at(-1)!.repetition).toBe(19);
  expect(() =>
    cohortSchema.parse({ ...cohort, variants: ["prism-no-validation"] }),
  ).toThrow(/must not include/);
});

it("selects at most four unstable tasks and excludes stable perfect or uniformly impossible tasks", async () => {
  const { selectRepeatTasks } = await import("../../evals/runners/ambiguity-report.ts");
  const variants = [
    "indexed-compact",
    "indexed-role",
    "indexed-local",
    "indexed-structural",
  ] as const;
  const rows = [];
  for (let task = 0; task < 6; task++)
    for (const variant of variants)
      for (let r = 0; r < 10; r++)
        rows.push({ task_id: `mixed-${task}`, variant, success: r < 5 });
  for (const variant of variants)
    for (let r = 0; r < 10; r++)
      rows.push({
        task_id: "stable",
        variant,
        success: variant === "indexed-local" || variant === "indexed-structural",
      });
  expect(selectRepeatTasks(rows)).toHaveLength(4);
  expect(selectRepeatTasks(rows).some((r) => r.task === "stable")).toBe(false);
});
