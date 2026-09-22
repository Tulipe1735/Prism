import type { ActionSpace, BrowserElement, SnapshotAction } from "./types.ts";

const OPERATIONS: Record<string, string> = {
  click: "CLICK",
  fill: "TYPE_TEXT",
  select: "SELECT",
};

const ELEMENT_KEYS = ["role", "value", "checked", "selected", "expanded"] as const;

/** One index per observed element; each operation has its own valid target choices. */
export function actionSpace(actions: SnapshotAction[]): ActionSpace {
  const elements: BrowserElement[] = [];
  const indices = new Map<number, string>();
  const targets: Record<string, Record<string, SnapshotAction>> = {};
  const controls: Record<string, SnapshotAction> = {};

  for (const action of actions) {
    const operation = OPERATIONS[action.kind];
    if (operation === undefined) {
      controls[action.id.toUpperCase()] = action;
      continue;
    }
    const node = action.node;
    if (node === undefined) continue;

    let index = indices.get(node);
    if (index === undefined) {
      index = String(elements.length + 1);
      indices.set(node, index);
      const element: BrowserElement = {
        index,
        label: action.label.split(" → ")[0] ?? action.label,
        operations: [],
      };
      for (const key of ELEMENT_KEYS) {
        const value = action[key];
        if (value !== undefined) element[key] = value;
      }
      if (action.kind === "select") {
        element.value = action.current_value ?? "";
        element.options = [];
      }
      elements.push(element);
    }

    const element = elements[Number(index) - 1];
    if (element === undefined) continue;
    if (!element.operations.includes(operation)) element.operations.push(operation);

    const group = (targets[operation] ??= {});
    let target = index;
    if (action.kind === "select") {
      const options = (element.options ??= []);
      target = `${index}:${options.length + 1}`;
      options.push({ index: target, label: action.label, value: action.value ?? "" });
    }
    group[target] = action;
  }

  return { elements, targets, controls };
}
