import type { BrowserSession, Observation } from "../../src/browser/session.ts";
import type { SnapshotAction } from "../../src/shared/types.ts";
import type { ModelInput, RepresentationCost, Variant } from "../schema.ts";
import { Buffer } from "node:buffer";

export interface TargetContext {
  context: string;
  container: string;
  nearby_text: string;
  section: string;
}
export type Representation = ModelInput["representation"];
export const CONTEXT_LIMITS = { local: 80, nearby: 120, section: 48, ancestors: 6 };

export function representationFor(variant: Variant): Representation {
  if (variant === "raw-selector") return "selector-dom";
  if (variant.startsWith("indexed-")) return variant.slice(8) as Representation;
  return "role";
}

export function formatTarget(
  id: string,
  action: Pick<SnapshotAction, "label" | "role" | "value" | "current_value">,
  representation: Representation,
  context?: TargetContext,
): string {
  const name = action.label.replace(/\s+/g, " ").trim().slice(0, 160);
  let line = `[${id}] ${representation === "compact" ? name : `${action.role ?? "control"} ${JSON.stringify(name)}`}`;
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

export function representationCost(
  input: Pick<ModelInput, "targets" | "dom">,
): RepresentationCost {
  // Includes the actual target map's keys/formatting; the locator reference also needs DOM.
  const text = JSON.stringify(input.targets) + (input.dom ?? "");
  const candidates = Object.values(input.targets).reduce(
    (n, group) => n + Object.keys(group).length,
    0,
  );
  const characters = Array.from(text).length;
  const estimated_tokens = Math.ceil(Buffer.byteLength(text, "utf8") / 4);
  return {
    candidates,
    characters,
    estimated_tokens,
    estimator: "utf8-bytes-div-4",
    chars_per_candidate: candidates ? characters / candidates : 0,
    estimated_tokens_per_candidate: candidates ? estimated_tokens / candidates : 0,
  };
}

/** Serialized into the page; reads public visible text, never private fixture attributes. */
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

export async function actionEvidence(
  session: BrowserSession,
  snapshot: Observation,
): Promise<ReturnType<typeof extractInPage>> {
  const nodes = [
    ...new Set(snapshot.actions.flatMap((a) => (a.node === undefined ? [] : [a.node]))),
  ];
  const result = await session.call("Runtime.evaluate", {
    expression: `(${extractInPage.toString()})(${JSON.stringify(nodes)})`,
    returnByValue: true,
  });
  if (result.exceptionDetails || !result.result?.value?.contexts)
    throw new Error("Action context observation failed.");
  return result.result.value;
}

/** Diagnostic treatment only. Does not alter the vendored snapshot or production sessions. */
export async function filterModalObservation(
  session: BrowserSession,
  snapshot: Observation,
): Promise<Observation> {
  const result = await session.call("Runtime.evaluate", {
    expression: `(() => { const dialogs=[...document.querySelectorAll('dialog:modal')]; const modal=dialogs.at(-1); return modal ? [...window.__jevFast.nodes.entries()].filter(([,el])=>modal.contains(el)).map(([id])=>id) : null; })()`,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error("Modal eligibility observation failed.");
  const nodes: number[] | null = result.result?.value ?? null;
  return nodes === null
    ? snapshot
    : {
        ...snapshot,
        actions: snapshot.actions.filter(
          (a) => a.node === undefined || nodes.includes(a.node),
        ),
      };
}
