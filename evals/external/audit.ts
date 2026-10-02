import type { CdpClient } from "../../src/browser/connect.ts";
import type { Observation } from "../../src/browser/session.ts";
import type { StepRecord } from "../schema.ts";
import { normalizeDescription } from "../runners/adaptive.ts";
import { extractInPage, formatTarget } from "../runners/representation.ts";

export interface TaskMetadata {
  page_type: string;
  source_family: string;
  planned_minimum_steps: number;
  goal_characters: number;
  correct_selector: string;
  candidate_selector: string;
  browser_check: Array<{
    kind: string;
    selector?: string;
    text?: string;
    value?: string;
    ms?: number;
  }>;
}

export const EXTERNAL_FAILURES = [
  "DYNAMIC_STATE_MISMATCH",
  "STALE_BROWSER_STATE",
  "PAGE_STRUCTURE_CHANGE",
  "HIDDEN_ELEMENT",
  "MODAL_INTERFERENCE",
  "NETWORK_DEPENDENCY",
  "AUTHENTICATION_BLOCK",
  "TASK_UNDEFINED",
] as const;

/** Passive evaluation adapter. Never modifies DOM, agent inputs, guards, or action dispatch. */
export function externalAudit(
  client: CdpClient,
  metadata: TaskMetadata,
): { client: CdpClient; observations: any[]; labels: string[]; wrong: () => number } {
  let wrong = 0;
  let selected: string | null = null;
  const observations: any[] = [];
  const labels: string[] = [];
  const adapted: CdpClient = {
    async send(method, params, sessionId) {
      const expression = (params as { expression?: string } | undefined)?.expression;
      if (
        method === "Runtime.evaluate" &&
        expression?.includes("if(el.hasAttribute('data-correct'))")
      ) {
        const node = expression.match(/nodes\.get\((\d+)\)/)?.[1];
        if (!node) throw new Error("Unrecognized frozen target-audit expression");
        const result = await client.send(
          method,
          {
            expression: `(() => { const el=window.__jevFast.nodes.get(${node});
            if (!el) return null;
            if (el.matches(${JSON.stringify(metadata.correct_selector)})) return 'correct';
            if (el.matches(${JSON.stringify(metadata.candidate_selector)})) return 'wrong';
            return 'neutral'; })()`,
            returnByValue: true,
          },
          sessionId,
        );
        selected = result.result?.value ?? null;
        return result;
      }
      const result = await client.send(method, params, sessionId);
      if (method === "Page.navigate" && result.errorText)
        labels.push(`NETWORK_DEPENDENCY: ${result.errorText}`);
      if (
        method === "Input.dispatchMouseEvent" &&
        (params as any)?.type === "mouseReleased"
      ) {
        if (selected === "wrong") wrong++;
        selected = null;
      }
      if (
        method === "Runtime.evaluate" &&
        expression?.includes("Dropdown execution") === false &&
        expression?.includes("e.dispatchEvent(new Event('change'")
      ) {
        // Native SELECT executes inside the frozen executor's evaluation, without mouse events.
        if (result.result?.value && expression.includes('"kind":"select"')) {
          if (selected === "wrong") wrong++;
          selected = null;
        }
      }
      if (
        method === "Runtime.evaluate" &&
        Array.isArray(result.result?.value?.checks)
      ) {
        result.result.value.wrong_targets = wrong;
      }
      const snapshot = result.result?.value;
      if (
        method === "Runtime.evaluate" &&
        Array.isArray(snapshot?.actions) &&
        snapshot?.guards
      ) {
        observations.push(await properties(client, sessionId, snapshot, metadata));
      }
      return result;
    },
  };
  return { client: adapted, observations, labels, wrong: () => wrong };
}

async function properties(
  client: CdpClient,
  sessionId: string | undefined,
  snapshot: Observation,
  metadata: TaskMetadata,
): Promise<any> {
  const nodes = [
    ...new Set(snapshot.actions.flatMap((a) => (a.node === undefined ? [] : [a.node]))),
  ];
  const response = await client.send(
    "Runtime.evaluate",
    {
      expression: `(() => { const publicContext=(${extractInPage.toString()})(${JSON.stringify(nodes)});
      const elements=[...document.querySelectorAll('*')];
      const dialogs=[...document.querySelectorAll('dialog,[role="dialog"],.ui-dialog,.modal')];
      const visible=e=>e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});
      return { publicContext, dom_elements:elements.length,
        dom_depth:Math.max(0,...elements.map(e=>{let n=0;while(e.parentElement){n++;e=e.parentElement}return n})),
        dialogs:dialogs.length, visible_dialogs:dialogs.filter(visible).length,
        hidden_elements:elements.filter(e=>!visible(e)).length,
        url:location.href,title:document.title,
        focal_controls:[...document.querySelectorAll(${JSON.stringify(metadata.correct_selector)})].map(e=>({
          tag:e.tagName, id:e.id, visible:visible(e), disabled:e.matches(':disabled'),
          offered:[...window.__jevFast.nodes.entries()].some(([n,node])=>node===e && ${JSON.stringify(nodes)}.includes(n)) })),
        public_structure:elements.map(e=>e.tagName+':'+(e.getAttribute('role')||'')).join('|') }; })()`,
      returnByValue: true,
    },
    sessionId,
  );
  if (response.exceptionDetails || !response.result?.value)
    return { audit_error: "DOM properties unavailable" };
  const p = response.result.value;
  const duplicate = (keys: string[]): Array<{ key: string; count: number }> => {
    const groups = new Map<string, number>();
    for (const k of keys) groups.set(k, (groups.get(k) ?? 0) + 1);
    return [...groups]
      .filter(([, count]) => count > 1)
      .map(([key, count]) => ({ key, count }));
  };
  const candidates = snapshot.actions.filter((a) => a.node !== undefined);
  const collisions = (
    level: "compact" | "role" | "local" | "structural",
  ): Array<{ key: string; count: number }> =>
    duplicate(
      candidates.map(
        (a) =>
          `${a.kind}/${normalizeDescription(formatTarget("", a, level, p.publicContext.contexts[String(a.node)]))}`,
      ),
    );
  return {
    dom_elements: p.dom_elements,
    dom_depth: p.dom_depth,
    candidate_actions: candidates.length,
    dialogs: p.dialogs,
    visible_dialogs: p.visible_dialogs,
    hidden_elements: p.hidden_elements,
    url: p.url,
    title: p.title,
    focal_controls: p.focal_controls,
    public_structure: p.public_structure,
    duplicate_labels: duplicate(candidates.map((a) => a.label)),
    duplicate_role_name_pairs: collisions("role"),
    local_text_collisions: collisions("local"),
    ancestor_section_collisions: collisions("structural"),
  };
}

/** Conservative labels: absent evidence remains unknown, rather than inferred from failure alone. */
export function externalFailure(
  rows: StepRecord[],
  result: { success: boolean; reason: string; failure_type: string | null },
  observations: any[],
  events: string[] = [],
): { domain: string | null; category: string | null } {
  if (result.success) return { domain: null, category: null };
  if (events.some((event) => event.startsWith("NETWORK_DEPENDENCY")))
    return { domain: "environment", category: "NETWORK_DEPENDENCY" };
  if (
    observations.some(
      (o) =>
        o.url?.startsWith("chrome-error:") ||
        /privacy error|site can.t be reached/i.test(o.title ?? ""),
    )
  )
    return { domain: "environment", category: "NETWORK_DEPENDENCY" };
  if (/HTTP|connection failed|PROVIDER/.test(`${result.reason} ${result.failure_type}`))
    return { domain: "environment", category: result.failure_type };
  if (rows.some((r) => r.target_assessment === "wrong" || r.selector_valid === false))
    return {
      domain: "grounding",
      category: rows.some((r) => r.selector_valid === false)
        ? "SELECTOR_FAILURE"
        : "ACTION_GROUNDING_ERROR",
    };
  if (rows.some((r) => r.stale_detected))
    return {
      domain: "environment",
      category: observations.some((o) => o.visible_dialogs > 0)
        ? "MODAL_INTERFERENCE"
        : "STALE_BROWSER_STATE",
    };
  if (
    rows.some((r) => r.validation_valid === false) ||
    result.failure_type === "MODEL_OUTPUT_ERROR"
  )
    return { domain: "model_behavior", category: "MODEL_OUTPUT_ERROR" };
  return { domain: "unresolved", category: result.failure_type ?? "UNKNOWN" };
}

export function adaptiveTrace(row: StepRecord): Record<string, unknown> | null {
  const adaptive = row.adaptive;
  if (!adaptive) return null;
  const levels = ["compact", "role", "local", "structural"];
  const path = levels.slice(0, levels.indexOf(adaptive.final_level) + 1);
  return {
    final_level: adaptive.final_level,
    escalation_path: path,
    expansions: path.length - 1,
    reasons: [
      ...(adaptive.compact_collided ? ["compact descriptor collision"] : []),
      ...(adaptive.role_collided ? ["role/name collision"] : []),
      ...(adaptive.local_collided ? ["local context collision"] : []),
    ],
    candidate_levels: adaptive.candidate_levels,
    collision_groups: adaptive.collision_groups,
    unresolved_groups: adaptive.unresolved_groups,
  };
}
