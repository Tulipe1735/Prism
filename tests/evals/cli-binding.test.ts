import type { CliView } from "../../evals/cli-contract-v1/model-input.ts";
import { describe, expect, it } from "vitest";
import { pages } from "../../evals/cli-contract-v1/design.ts";
import { clusterInterval } from "../../evals/cli-contract-v1/model-analyze.ts";
import {
  modelCells,
  pairedProjection,
  parseChoice,
} from "../../evals/cli-contract-v1/model-input.ts";

const view: CliView = {
  session: "s_a",
  observation: "o_a",
  evidence: "v_a",
  page: { url: "http://127.0.0.1/opaque", title: "Browser controls", status: "" },
  targets: ["Beta", "Alpha", "Gamma"].map((group, i) => ({
    ref: `o_a:e${i + 1}`,
    operation: "click",
    label: "Choose",
    scope: "relations",
    description: "button Choose",
    context: { local: `Item ${i}` },
    relations: [{ text: group, scope: "section" }],
  })),
};
describe("CLI binding experiment controls", () => {
  it("changes only candidate-to-group references while preserving words and byte length", () => {
    const pair = pairedProjection(view, "Click Choose in Alpha.");
    const bound = pair.bound.observation as any;
    const unbound = pair.unbound.observation as any;
    expect(bound.groups).toEqual(unbound.groups);
    expect(bound.groups.map((group: any) => group.text)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
    ]);
    expect(bound.targets.map((target: any) => target.belongs_to)).toEqual([
      "R2",
      "R1",
      "R3",
    ]);
    expect(unbound.targets.map((target: any) => target.belongs_to)).toEqual([
      "??",
      "??",
      "??",
    ]);
    expect(JSON.stringify(pair.bound)).not.toContain('"relations"');
    expect(() =>
      pairedProjection(
        {
          ...view,
          targets: view.targets.map((target) => ({ ...target, relations: [] })),
        },
        "goal",
      ),
    ).toThrow();
  });
  it("does not repair invalid or unoffered model output", () => {
    expect(parseChoice('{"target":"o_a:e2"}', view.targets)).toBe("o_a:e2");
    expect(parseChoice('{"target":null}', view.targets)).toBeNull();
    expect(() => parseChoice('{"target":"other"}', view.targets)).toThrow();
    expect(() =>
      parseChoice('{"target":"o_a:e2","explanation":"text"}', view.targets),
    ).toThrow();
    expect(() =>
      parseChoice('```json\n{"target":"o_a:e2"}\n```', view.targets),
    ).toThrow();
  });
  it("covers every paired model/arm cell exactly once within the authorized budget", () => {
    const jobs = modelCells(pages());
    expect(jobs).toHaveLength(192);
    expect(new Set(jobs.map((job) => job.id)).size).toBe(192);
    for (const page of pages())
      for (const goal of ["group", "entity"])
        expect(
          jobs.filter((job) => job.page.id === page.id && job.goal === goal),
        ).toHaveLength(4);
  });
  it("keeps cluster diagnostics reproducible and refuses an interval from one cluster", () => {
    expect(clusterInterval([1])).toBeNull();
    expect(clusterInterval([0, 1, 0, 1])).toEqual(clusterInterval([0, 1, 0, 1]));
    expect(clusterInterval([1, 1, 1, 1])).toEqual([1, 1]);
  });
});
