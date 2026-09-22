import type { SnapshotAction } from "../../src/shared/types.ts";

import { describe, expect, it } from "vitest";
import { actionSpace } from "../../src/runtime/action-space.ts";

const actions: SnapshotAction[] = [
  { id: "e1", kind: "click", node: 1, role: "button", label: "Save" },
  { id: "e2", kind: "fill", node: 2, role: "textbox", label: "Email", value: "" },
  { id: "e3", kind: "click", node: 2, role: "textbox", label: "Open Email", value: "" },
  {
    id: "e4",
    kind: "select",
    node: 3,
    role: "combobox",
    label: "Country → China",
    value: "cn",
    current_value: "China",
  },
  {
    id: "e5",
    kind: "select",
    node: 3,
    role: "combobox",
    label: "Country → France",
    value: "fr",
    current_value: "China",
  },
  { id: "scroll_down", kind: "scroll", label: "Scroll down", delta: 560 },
  { id: "wait", kind: "wait", label: "Wait for the page to update" },
];

describe("actionSpace", () => {
  it("indexes one element per node and groups operations by target", () => {
    const space = actionSpace(actions);

    expect(space.elements).toHaveLength(3);
    expect(space.elements[0]).toMatchObject({
      index: "1",
      label: "Save",
      role: "button",
      operations: ["CLICK"],
    });
    expect(space.elements[1]).toMatchObject({
      index: "2",
      label: "Email",
      operations: ["TYPE_TEXT", "CLICK"],
      value: "",
    });
  });

  it("keeps dropdown options as indexed targets on the shared element", () => {
    const space = actionSpace(actions);
    const country = space.elements[2]!;

    expect(country.label).toBe("Country");
    expect(country.value).toBe("China");
    expect(country.operations).toEqual(["SELECT"]);
    expect(country.options).toEqual([
      { index: "3:1", label: "Country → China", value: "cn" },
      { index: "3:2", label: "Country → France", value: "fr" },
    ]);
    expect(Object.keys(space.targets.SELECT!)).toEqual(["3:1", "3:2"]);
  });

  it("routes controls and terminal operations outside the element table", () => {
    const space = actionSpace(actions);

    expect(Object.keys(space.controls).sort()).toEqual(["SCROLL_DOWN", "WAIT"]);
    expect(space.controls.WAIT!.id).toBe("wait");
    expect(space.targets.CLICK).toHaveProperty("1");
    expect(space.targets.CLICK).toHaveProperty("2");
    expect(space.targets.TYPE_TEXT).toHaveProperty("2");
  });

  it("ignores indexed actions without a node", () => {
    const space = actionSpace([{ id: "e9", kind: "click", label: "Broken" }]);
    expect(space.elements).toEqual([]);
  });
});
