import type { Snapshot } from "../../src/shared/types.ts";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { contrast } from "../../evals/relation-ablation/analyze.ts";
import { armDecision, armRequestBody } from "../../evals/relation-ablation/decision.ts";
import { armPayload } from "../../evals/relation-ablation/input.ts";
import {
  armCost,
  formatArmTarget,
  pooledRelations,
} from "../../evals/relation-ablation/relations.ts";
import { runExperiment, schedule } from "../../evals/relation-ablation/run.ts";
import {
  parseExperimentCohort,
  parseExperimentTasks,
} from "../../evals/relation-ablation/schema.ts";
import { formatTarget } from "../../evals/runners/representation.ts";
import { validateChoice } from "../../evals/runtime/decision.ts";

const context = {
  context: "Item 7",
  container: "group",
  nearby_text: "Item 7",
  section: "Manage entries",
};
const entries = [
  { tag: 1, text: "Alpha", scope: "card" },
  { tag: 2, text: "Beta", scope: "card" },
  { tag: 3, text: "Gamma", scope: "card" },
];
const snapshot = {
  url: "http://local/opaque.html",
  title: "Manage entries",
  text: "Pending",
  w: 1120,
  h: 780,
  scroll: { y: 0, height: 780 },
  marker: null,
  page_key: null,
  guards: {},
  omitted_actions: 0,
  actions: [
    {
      id: "e1",
      kind: "click",
      node: 1,
      label: "Item 7",
      role: "button",
      rect: { x: 0, y: 0, w: 10, h: 10 },
    },
    {
      id: "e2",
      kind: "click",
      node: 2,
      label: "Item 12",
      role: "button",
      rect: { x: 0, y: 20, w: 10, h: 10 },
    },
    {
      id: "e3",
      kind: "click",
      node: 3,
      label: "Item 31",
      role: "button",
      rect: { x: 0, y: 40, w: 10, h: 10 },
    },
    { id: "wait", kind: "wait", label: "Wait" },
  ],
} as Snapshot;
const build = (arm: string, assignment = [0, 1, 2]) =>
  armPayload({
    arm,
    goal: "Edit the control for Beta.",
    snapshot,
    history: [],
    evidence: {
      status: "Pending",
      contexts: { "1": context, "2": context, "3": context },
    },
    relations: Object.fromEntries(
      assignment.map((entry, i) => [String(i + 1), [entries[entry]!]]),
    ),
  });

it("preserves both historical control formatters without group overrides", () => {
  for (const arm of ["local", "structural"]) {
    expect(formatArmTarget("1", snapshot.actions[0]!, arm, context)).toBe(
      formatTarget("1", snapshot.actions[0]!, arm as "local", context),
    );
  }
});

it("matches R/U lexical occurrences, shape and UTF-8 length on every candidate", () => {
  const bound = build("indexed-bound");
  const unbound = build("indexed-unbound");
  for (const id of ["1", "2", "3"]) {
    const r = bound.targets.CLICK![id]!;
    const u = unbound.targets.CLICK![id]!;
    expect(r.split("\n").slice(0, -1)).toEqual(u.split("\n").slice(0, -1));
    for (const word of ["Alpha", "Beta", "Gamma"])
      expect(r.split(word).length).toBe(u.split(word).length);
    expect(Buffer.byteLength(r)).toBe(Buffer.byteLength(u));
    expect(u).toMatch(/belongs_to: \?\?$/);
  }
  expect(armCost(bound)).toEqual(armCost(unbound));
  expect(Buffer.byteLength(JSON.stringify(bound))).toBe(
    Buffer.byteLength(JSON.stringify(unbound)),
  );
  expect(JSON.stringify(bound)).not.toContain("indexed-bound");
});

it("keeps U invariant under entity-group reassignment and lets R track that mapping", () => {
  const initial = build("indexed-unbound", [0, 1, 2]);
  expect(build("indexed-unbound", [2, 0, 1])).toEqual(initial);
  expect(build("indexed-bound", [2, 0, 1]).targets.CLICK!["1"]).toMatch(
    /belongs_to: R3$/,
  );
  for (const arm of [
    "indexed-local",
    "indexed-unbound",
    "indexed-bound",
    "indexed-structural",
  ])
    expect(Object.keys(build(arm).targets.CLICK!)).toEqual(["1", "2", "3"]);
  expect(pooledRelations({}, [1, 2])).toEqual([]);
});

it("runs every task in every arm, with a complete within-task primary contrast", async () => {
  const tasks = parseExperimentTasks(
    JSON.parse(await readFile("evals/tasks/relation-ablation-v1.json", "utf8")),
  );
  const plan = parseExperimentCohort(
    JSON.parse(await readFile("evals/cohorts/relation-ablation-v1-glm.json", "utf8")),
  );
  const cells = schedule(tasks, plan.arms);
  expect(cells).toHaveLength(192);
  expect(new Set(cells.map((c) => `${c.task.id}/${c.arm}`)).size).toBe(192);
  for (const task of tasks)
    expect(
      new Set(cells.filter((c) => c.task.id === task.id).map((c) => c.arm)),
    ).toEqual(new Set(plan.arms));
  for (const arm of plan.arms) {
    const group = cells.filter((c) => c.arm === arm);
    expect(group).toHaveLength(48);
    for (const condition of ["local", "group"])
      for (const position of [1, 2, 3])
        expect(
          group.filter(
            (c) =>
              c.task.design.condition === condition &&
              c.task.design.position === position,
          ),
        ).toHaveLength(8);
  }
  expect(cells.slice(0, 4).map((c) => c.arm)).not.toEqual(
    cells.slice(4, 8).map((c) => c.arm),
  );
});

it("varies each entity's group and keeps URLs opaque", async () => {
  const plan = JSON.parse(await readFile("evals/relation-ablation/plan.json", "utf8"));
  for (const page of plan.pages) {
    for (const entity of [0, 1, 2])
      expect(new Set(page.codes.map((code: any) => code.groups[entity])).size).toBe(3);
    expect(new Set(page.codes.map((code: any) => code.group)).size).toBe(3);
    for (const position of [0, 1, 2])
      expect(
        new Set(page.codes.map((code: any) => code.groups[code.rotation[position]])),
      ).toEqual(new Set([0, 1, 2]));
    expect(new Set(page.codes.map((code: any) => code.entity)).size).toBe(1);
    expect(new Set(page.codes.map((code: any) => code.position))).toEqual(
      new Set([1, 2, 3]),
    );
    for (const code of page.codes) expect(code.url).toMatch(/\/[a-f0-9]{16}\.html$/);
  }
});

it("rejects inconsistent choice/argmax heads using the historical validator", () => {
  const offered = { A: "a", B: "b" };
  expect(
    validateChoice(
      { choice: "A", confidence: 1, probabilities: { A: 0.6, B: 0.4 } },
      offered,
    ).choice,
  ).toBe("A");
  for (const head of [
    { choice: "B", confidence: 1, probabilities: { A: 0.6, B: 0.4 } },
    { choice: "A", confidence: 1, probabilities: { A: 1.2, B: -0.2 } },
    { choice: "A", confidence: 1, probabilities: { A: 1 } },
    { choice: "A", probabilities: { A: 0.6, B: 0.4 } },
  ])
    expect(() => validateChoice(head, offered)).toThrow();
});

it("rejects a mock model's inconsistent choice without executing any action", async () => {
  const result = await armDecision({
    cohort: {
      model: "offline-test",
      baseUrl: "http://unused.invalid",
      apiKeyEnv: "UNUSED",
      temperature: 0,
      topP: 1,
      maxTokens: 8192,
      httpRetries: 2,
      timeoutMs: 1000,
    },
    apiKey: "not-a-real-key",
    payload: build("indexed-bound"),
    snapshot,
    signal: new AbortController().signal,
    fetchImpl: async () =>
      Response.json({
        model: "offline-test",
        choices: [
          {
            message: {
              content: JSON.stringify({
                operation: {
                  choice: "CLICK",
                  confidence: 1,
                  probabilities: { CLICK: 1, WAIT: 0, DONE: 0, BLOCKED: 0 },
                },
                target: {
                  choice: "2",
                  confidence: 1,
                  probabilities: { "1": 1, "2": 0, "3": 0 },
                },
                text: null,
              }),
            },
          },
        ],
      }),
  });
  expect(result).toMatchObject({ kind: "output", httpCalls: 1 });
});

it("blocks model dispatch before browser or credentials when preparation is not frozen", async () => {
  await expect(
    runExperiment({
      cohortPath: "evals/cohorts/relation-ablation-v1-glm.json",
      tasksPath: "evals/tasks/relation-ablation-v1.json",
      provider: "model",
      outputDir: "/unused",
      browserUrl: "http://unused.invalid",
    }),
  ).rejects.toThrow(/freeze|Pin browserVersion/);
});

it("pairs identical task cells before averaging a partial page", () => {
  const records = [
    { task_id: "a", arm: "indexed-bound", grounding_success: true },
    { task_id: "a", arm: "indexed-unbound", grounding_success: false },
    { task_id: "b", arm: "indexed-unbound", grounding_success: true },
  ] as never;
  const design = new Map([
    ["a", { page: "p", family: "section", condition: "group" }],
    ["b", { page: "p", family: "section", condition: "group" }],
  ]) as never;
  expect(
    contrast(records, design, "indexed-bound", "indexed-unbound", "group", (r) =>
      Number(r.grounding_success),
    )?.mean,
  ).toBe(1);
});

it("rejects invalid or duplicate task designs", async () => {
  const tasks = JSON.parse(
    await readFile("evals/tasks/relation-ablation-v1.json", "utf8"),
  );
  expect(() => parseExperimentTasks([tasks[0], tasks[0]])).toThrow(
    "Duplicate task ids",
  );
  expect(() =>
    parseExperimentTasks([
      { ...tasks[0], design: { ...tasks[0].design, position: 4 } },
    ]),
  ).toThrow();
  expect(
    armRequestBody(
      {
        model: "test",
        baseUrl: "http://unused",
        apiKeyEnv: "UNUSED",
        temperature: 0,
        topP: 1,
        maxTokens: 8192,
        httpRetries: 2,
        timeoutMs: 1000,
      },
      build("indexed-bound"),
    ),
  ).not.toHaveProperty("apiKey");
});
