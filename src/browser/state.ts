import type { SnapshotAction } from "../shared/types.ts";

export interface ControlState {
  name: string;
  role: string;
  disabled: boolean;
  readonly: boolean;
  value?: string;
  checked?: boolean | "mixed";
  selected?: boolean;
  expanded?: boolean;
  selected_options?: { value: string; label: string }[];
  truncated?: true;
}

export interface ObservedAction extends SnapshotAction {
  control?: ControlState;
  option_label?: string;
}

export interface PublicState {
  source: "dom";
  observed_at: string;
  controls: ControlState[];
  messages: { role: "status" | "alert"; text: string }[];
  coverage: {
    scope: "viewport";
    controls: { total: number; returned: number; omitted: number };
    messages: { total: number; returned: number; omitted: number };
    truncated: boolean;
  };
}

/** One reader per synchronous sample, shared by targets and read-only results. */
export function createStateReaderInPage(): {
  readAction: (action: SnapshotAction) => ObservedAction;
  collect: () => PublicState;
} {
  const page = globalThis as any;
  const doc = page.document;
  const cache = new WeakMap<object, ControlState>();
  let truncated = false;
  let fieldTruncated = false;
  const clip = (value: string, limit: number): string => {
    if (value.length > limit) truncated = fieldTruncated = true;
    return value.slice(0, limit);
  };
  const visible = (el: any): boolean =>
    !el.closest(
      '[hidden],[aria-hidden="true"],[inert],script,style,template,noscript',
    ) && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const inViewport = (el: any): boolean => {
    if (!visible(el)) return false;
    const r = el.getBoundingClientRect();
    return (
      r.width > 0 &&
      r.height > 0 &&
      r.bottom > 0 &&
      r.right > 0 &&
      r.top < page.innerHeight &&
      r.left < page.innerWidth
    );
  };
  const text = (el: any, limit: number): string => {
    const walker = doc.createTreeWalker(el, page.NodeFilter.SHOW_TEXT);
    const words: string[] = [];
    let node;
    let visited = 0;
    while (true) {
      node = walker.nextNode();
      if (!node) break;
      if (++visited > 200) {
        truncated = fieldTruncated = true;
        break;
      }
      if (node.parentElement && visible(node.parentElement)) {
        if (
          el.matches("label") &&
          node.parentElement.closest("input,select,textarea,[contenteditable]")
        )
          continue;
        words.push(node.textContent.replace(/\s+/g, " ").trim());
        if (words.join(" ").length > limit) {
          truncated = fieldTruncated = true;
          break;
        }
      }
    }
    return clip(words.filter(Boolean).join(" "), limit);
  };
  const name = (el: any, seen = new Set<any>()): string => {
    if (!el || seen.has(el) || !visible(el)) return "";
    seen.add(el);
    if (seen.size > 200) {
      truncated = fieldTruncated = true;
      return "";
    }
    const referenced = (el.getAttribute("aria-labelledby") ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .map((id: string) => name(doc.getElementById(id), seen))
      .filter(Boolean)
      .join(" ");
    const labels = Array.from(el.labels ?? [])
      .map((label: any) => name(label, seen))
      .filter(Boolean)
      .join(" ");
    const contents = (): string => {
      const parts: string[] = [];
      for (const child of el.childNodes) {
        if (seen.size > 200) {
          truncated = fieldTruncated = true;
          break;
        }
        if (child.nodeType === page.Node.TEXT_NODE) {
          seen.add(child);
          parts.push(child.textContent);
        } else if (child.nodeType === page.Node.ELEMENT_NODE) {
          if (
            el.matches("label") &&
            child.matches("input,select,textarea,[contenteditable]")
          )
            continue;
          parts.push(name(child, seen));
        }
      }
      return clip(parts.join(" ").replace(/\s+/g, " ").trim(), 160);
    };
    return clip(
      referenced ||
        el.getAttribute("aria-label") ||
        labels ||
        (["button", "submit", "reset"].includes(el.type) ? el.value : "") ||
        el.getAttribute("alt") ||
        (el.tagName === "INPUT" ? "" : contents()) ||
        el.getAttribute("title") ||
        el.getAttribute("placeholder") ||
        "",
      160,
    );
  };
  const roles = [
    "button",
    "link",
    "checkbox",
    "radio",
    "switch",
    "tab",
    "menuitem",
    "menuitemradio",
    "option",
    "gridcell",
    "combobox",
    "textbox",
    "searchbox",
    "spinbutton",
  ];
  const selector = `a[href],button,input,textarea,select,summary,[contenteditable="true"],${roles.map((role) => `[role="${role}"]`).join(",")}`;
  const role = (el: any): string => {
    const explicit = el.getAttribute("role");
    if (roles.includes(explicit)) return explicit;
    if (el.matches("button,summary")) return "button";
    if (el.matches("a")) return "link";
    if (el.matches("select")) return "combobox";
    if (el.matches("textarea") || el.isContentEditable) return "textbox";
    if (["checkbox", "radio"].includes(el.type)) return el.type;
    if (["button", "submit", "reset", "image"].includes(el.type)) return "button";
    if (el.type === "search") return "searchbox";
    if (el.type === "number") return "spinbutton";
    return "textbox";
  };
  const boolean = (value: string | null): boolean | undefined =>
    value === "true" ? true : value === "false" ? false : undefined;
  const readControl = (el: any): ControlState => {
    const saved = cache.get(el);
    if (saved) return saved;
    fieldTruncated = false;
    const state: ControlState = {
      name: name(el) || role(el),
      role: role(el),
      disabled: el.matches(":disabled") || !!el.closest('[aria-disabled="true"]'),
      readonly: el.readOnly === true || el.getAttribute("aria-readonly") === "true",
    };
    for (const key of ["checked", "selected", "expanded"] as const) {
      const raw = el.getAttribute(`aria-${key}`);
      if (key === "checked" && raw === "mixed") state.checked = "mixed";
      else {
        const value = boolean(raw);
        if (value !== undefined) state[key] = value;
      }
    }
    if (["checkbox", "radio"].includes(el.type))
      state.checked = el.indeterminate ? "mixed" : Boolean(el.checked);
    if (el.matches("summary") && el.parentElement?.matches("details"))
      state.expanded = Boolean(el.parentElement.open);
    if (el.matches("input,textarea,select")) state.value = clip(String(el.value), 2000);
    // innerText preserves rendered line breaks while excluding hidden descendants.
    // eslint-disable-next-line unicorn/prefer-dom-node-text-content
    else if (el.isContentEditable) state.value = clip(el.innerText, 2000);
    if (el.matches("select")) {
      const selected = Array.from(el.selectedOptions) as any[];
      if (selected.length > 50) truncated = fieldTruncated = true;
      state.selected_options = selected.slice(0, 50).map((option) => ({
        value: clip(String(option.value), 2000),
        label: clip(String(option.label), 160),
      }));
    }
    if (fieldTruncated) state.truncated = true;
    cache.set(el, state);
    return state;
  };
  const readAction = (action: SnapshotAction): ObservedAction => {
    if (action.node === undefined) return action;
    const element = page.__jevFast?.nodes.get(action.node);
    if (!element?.isConnected)
      throw new Error("Observed control is no longer connected.");
    return {
      ...action,
      control: readControl(element),
      ...(action.kind === "select"
        ? {
            option_label: [...element.options].find(
              (option) => option.value === action.value,
            )?.label,
          }
        : {}),
    };
  };
  const collect = (): PublicState => {
    const controls: ControlState[] = [];
    const messages: PublicState["messages"] = [];
    let totalControls = 0;
    for (const el of doc.querySelectorAll(selector)) {
      if (["password", "file", "hidden"].includes(el.type) || !inViewport(el)) continue;
      totalControls++;
      if (controls.length < 250) controls.push(readControl(el));
    }
    let totalMessages = 0;
    for (const el of doc.querySelectorAll('[role="status"],[role="alert"]')) {
      if (!inViewport(el)) continue;
      totalMessages++;
      if (messages.length === 50) continue;
      messages.push({ role: el.getAttribute("role"), text: text(el, 300) });
    }
    const count = (
      total: number,
      returned: number,
    ): { total: number; returned: number; omitted: number } => ({
      total,
      returned,
      omitted: total - returned,
    });
    return {
      source: "dom",
      observed_at: new Date().toISOString(),
      controls,
      messages,
      coverage: {
        scope: "viewport",
        controls: count(totalControls, controls.length),
        messages: count(totalMessages, messages.length),
        truncated:
          truncated ||
          totalControls > controls.length ||
          totalMessages > messages.length,
      },
    };
  };
  return { readAction, collect };
}
