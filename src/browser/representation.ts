import type { SnapshotAction } from "../shared/types.ts";

/** CLI method v1 starts from the archived research extractors. Historical files stay independent. */
export type Representation = "local" | "structural" | "relations";
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
  layout?: "horizontal" | "vertical";
}
export type ActionRelations = Record<string, RelationEntry[]>;
export const CONTEXT_LIMITS = { local: 80, nearby: 120, section: 48, ancestors: 6 };
export function formatTarget(
  id: string,
  action: Pick<SnapshotAction, "label" | "role" | "value" | "current_value">,
  representation: Representation,
  context?: TargetContext,
): string {
  const name = action.label.replace(/\s+/g, " ").trim().slice(0, 160);
  let line = `[${id}] ${`${action.role ?? "control"} ${JSON.stringify(name)}`}`;
  if (action.current_value || action.value)
    line += ` value=${JSON.stringify(action.current_value ?? action.value)}`;
  if (representation === "local" && context?.context)
    line += `\n  context: ${context.context.slice(0, CONTEXT_LIMITS.local)}`;
  if (representation === "structural" && context) {
    if (context.container) line += `\n  container: ${context.container.slice(0, 24)}`;
    if (context.nearby_text)
      line += `\n  nearby_text: ${context.nearby_text.slice(0, CONTEXT_LIMITS.nearby)}`;
    if (context.section && !context.nearby_text.includes(context.section))
      line += `\n  section: ${context.section.slice(0, CONTEXT_LIMITS.section)}`;
  }
  return line;
}

export function extractInPage(nodes: number[]): {
  contexts: Record<string, TargetContext>;
  status: string;
} {
  const page = globalThis as any;
  const doc = page.document;
  const visible = (el: any): boolean =>
    !el.closest(
      '[hidden],[aria-hidden="true"],[inert],script,style,template,noscript',
    ) && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const words = (root: any, excludeControls: boolean): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    if (!root) return out;
    const walker = doc.createTreeWalker(root, page.NodeFilter.SHOW_TEXT);
    let node;
    // Bound traversal as well as output; no entire ancestor tree is emitted.
    let visited = 0;
    while (visited++ < 200) {
      node = walker.nextNode();
      if (!node) break;
      const parent = node.parentElement;
      if (
        !parent ||
        !visible(parent) ||
        (excludeControls &&
          parent.closest(
            'button,a,input,select,textarea,[role="button"],[role="link"]',
          ))
      )
        continue;
      const text = node.textContent.replace(/\s+/g, " ").trim();
      if (text && !seen.has(text)) {
        seen.add(text);
        out.push(text);
      }
    }
    return out;
  };
  const contexts: Record<string, TargetContext> = {};
  for (const node of nodes) {
    const element = page.__jevFast.nodes.get(node);
    if (!element) continue;
    let container = element.parentElement;
    let ancestor = container;
    for (
      let depth = 0;
      ancestor && depth < 6;
      depth++, ancestor = ancestor.parentElement
    ) {
      if (
        ancestor.matches(
          'tr,[role="row"],article,li,form,fieldset,section,[role="group"],.card,.row,.item,.panel',
        )
      ) {
        container = ancestor;
        break;
      }
    }
    const text = words(container, true);
    const headingScope = element.closest("section,fieldset,main");
    const heading = headingScope?.querySelector("h1,h2,h3,legend");
    const section =
      heading && visible(heading) ? words(heading, false).join(" ").slice(0, 48) : "";
    const labels = Array.from(element.labels ?? []).flatMap((label: any) =>
      words(label, true),
    );
    const distinct = [...new Set([...labels, ...text])];
    contexts[node] = {
      context: distinct.join(" | ").slice(0, 80),
      container:
        container?.getAttribute("role") ??
        (
          {
            TR: "row",
            ARTICLE: "card",
            LI: "list-item",
            FORM: "form",
            FIELDSET: "fieldset",
            SECTION: "section",
          } as Record<string, string>
        )[container?.tagName] ??
        "group",
      nearby_text: distinct.join(" | ").slice(0, 120),
      section,
    };
  }
  const status = [...doc.querySelectorAll('[role="status"]')]
    .filter(visible)
    .flatMap((el: any) => words(el, false))
    .join(" | ")
    .slice(0, 300);
  return { contexts, status };
}

export function extractRelationsInPage(nodes: number[]): ActionRelations {
  const page = globalThis as any;
  const depthLimit = 6;
  const groupLimit = 24;
  const scopes = "section,tr,article,fieldset,li,[role='group'],[role='row']";
  const visible = (el: any): boolean =>
    !el.closest(
      '[hidden],[aria-hidden="true"],[inert],script,style,template,noscript',
    ) && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const collapsed = (el: any): string => {
    // Read rendered text so hidden descendants cannot supply a public group label.
    // eslint-disable-next-line unicorn/prefer-dom-node-text-content
    return (el.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, groupLimit);
  };
  // A group's identity element must be its direct child, so a nested candidate container's
  // own text can never be reported as the group identity.
  const identity = (el: any, control: any): string => {
    const labels = (el.getAttribute("aria-labelledby") ?? "")
      .split(/\s+/)
      .map((id: string) => page.document.getElementById(id))
      .filter((label: any) => label && visible(label))
      .map(collapsed)
      .join(" ")
      .slice(0, groupLimit);
    if (labels) return labels;
    const direct = [...el.children];
    for (const tag of ["legend", "caption", "h1", "h2", "h3", "h4"]) {
      const found = direct.find((child: any) => child.tagName === tag.toUpperCase());
      if (found && visible(found)) {
        const text = collapsed(found);
        if (text) return text;
      }
    }
    // Column headers do not name the row. Only an explicit, unique row header
    // can name controls in that same row, excluding controls in nested rows.
    if (el.matches("tr") && control.closest("tr") === el) {
      const headers = direct.filter(
        (child: any) => child.matches('th[scope="row"]') && visible(child),
      );
      if (headers.length === 1) return collapsed(headers[0]);
    }
    return "";
  };
  const tableIdentity = (el: any, control: any): string => {
    if (el.matches("body,html,main")) return "";
    const tables = el.matches("table") ? [el] : [...el.querySelectorAll("table")];
    if (tables.length !== 1 || !visible(tables[0])) return "";
    const table = tables[0];
    const controlled = (control.getAttribute("aria-controls") ?? "")
      .split(/\s+/)
      .filter(Boolean);
    // A shared layout wrapper does not make a control a table member.
    if (
      !table.contains(control) &&
      !(controlled.length === 1 && table.id && controlled[0] === table.id)
    )
      return "";
    const caption = table.caption;
    if (caption && visible(caption) && collapsed(caption))
      return collapsed(caption);
    const heading = el.previousElementSibling;
    if (
      heading &&
      visible(heading) &&
      (heading.matches("h1,h2,h3,h4,h5,h6,[role='heading']") ||
        (heading.tagName === "P" &&
          Number(page.getComputedStyle(heading).fontWeight) >= 600))
    )
      return collapsed(heading);
    return "";
  };
  // Describe only clearly aligned groups. A grid or mixed layout has no orientation.
  const layout = (el: any): "horizontal" | "vertical" | undefined => {
    if (!el.matches("fieldset,[role='group']")) return;
    const children = (root: any): any[] =>
      [...root.children].filter(
        (child: any) =>
          !child.matches("legend,h1,h2,h3,h4,h5,h6,[role='heading']") && visible(child),
      );
    let items = children(el);
    for (let depth = 0; items.length === 1 && depth < 3; depth++) {
      const nested = children(items[0]);
      if (!nested.length) break;
      items = nested;
    }
    const rects = items
      .map((item: any) => item.getBoundingClientRect())
      .filter((rect: any) => rect.width > 0 && rect.height > 0);
    if (rects.length < 2) return;
    const spread = (values: number[]): number =>
      Math.max(...values) - Math.min(...values);
    if (
      spread(rects.map((r: any) => r.y + r.height / 2)) <= 2 &&
      spread(rects.map((r: any) => r.x)) > 2
    )
      return "horizontal";
    if (
      spread(rects.map((r: any) => r.y)) > 2 &&
      ["left", "right"].some((edge) => spread(rects.map((r: any) => r[edge])) <= 2)
    )
      return "vertical";
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
      if (!visible(ancestor)) {
        ancestor = ancestor.parentElement;
        continue;
      }
      const tableText = tableIdentity(ancestor, element);
      const text = ancestor.matches(scopes)
        ? identity(ancestor, element) || tableText
        : tableText;
      const scope =
        tableText && text === tableText ? "table-region" : scopeName(ancestor);
      const orientation = text ? layout(ancestor) : undefined;
      ancestor = ancestor.parentElement;
      if (!text || seen.has(text)) continue;
      if (own.has(text) && !orientation) continue;
      seen.add(text);
      // Nearest group first; deeper groups describe the candidate more specifically.
      found.unshift({
        tag: next(text),
        text,
        scope,
        ...(orientation ? { layout: orientation } : {}),
      });
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
