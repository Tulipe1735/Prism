import { createHash } from "node:crypto";

export const families = ["section", "fieldset", "role-group", "table"] as const;
export const scopes = ["local", "structural", "relations"] as const;
export const gates = ["identity-only", "evidence-consistency"] as const;
export const changes = [
  "stable",
  "unrelated",
  "swap-groups",
  "local-note",
  "replace-target",
  "post-read-swap",
] as const;
export type Family = (typeof families)[number];
export type Gate = (typeof gates)[number];
export type Change = (typeof changes)[number];
export type Goal = "group" | "entity";
export type Boundary = "ordinary" | "long-heading" | "deep-group";
export interface Page {
  id: string;
  family: Family;
  skeleton: number;
  state: number;
  boundary: Boundary;
  entities: string[];
  groups: string[];
  target: string;
}
export interface Cell {
  id: string;
  page: Page;
  goal: Goal;
  change: Change;
  gate: Gate;
  cohort: "primary" | "truncation";
}
export const LONG_PREFIX = "DepartmentCommonPrefixXX";
export function pages(boundary: Boundary = "ordinary"): Page[] {
  const entities = ["Item 7", "Item 12", "Item 31"];
  const names = ["Alpha", "Beta", "Gamma"].map((name) =>
    boundary === "long-heading" ? `${LONG_PREFIX}-${name}` : name,
  );
  return families.flatMap((family, f) =>
    [0, 1].flatMap((skeleton) =>
      [0, 1, 2].map((state) => {
        const key = `${family}:${skeleton}:${state}:${boundary}`;
        return {
          id: createHash("sha256").update(key).digest("hex").slice(0, 16),
          family,
          skeleton,
          state,
          boundary,
          entities: entities.map((_, i) => entities[(i + state) % 3]!),
          groups: names.map((_, i) => names[(i + 2 * state) % 3]!),
          target: entities[(f * 2 + skeleton) % 3]!,
        };
      }),
    ),
  );
}
export function cells(pageSet = pages()): Cell[] {
  return pageSet.flatMap((page, p) =>
    (["group", "entity"] as const).flatMap((goal) =>
      changes.flatMap((change, c) =>
        // Reverse pairs deterministically to avoid always running the same gate first.
        ((p + c) % 2 ? [...gates].reverse() : [...gates]).map((gate) => ({
          id: `${page.id}:${goal}:${change}:${gate}`,
          page,
          goal,
          change,
          gate,
          cohort: "primary" as const,
        })),
      ),
    ),
  );
}
export function truncationCells(): Cell[] {
  return pages("long-heading")
    .filter((page) => page.state === 0 && page.skeleton === 0)
    .flatMap((page) =>
      (["group", "entity"] as const).flatMap((goal) =>
        gates.map((gate) => ({
          id: `${page.id}:${goal}:swap-groups:${gate}`,
          page,
          goal,
          change: "swap-groups" as const,
          gate,
          cohort: "truncation" as const,
        })),
      ),
    );
}

/** App state is an independent oracle; the production extractors never receive it. */
export function html(page: Page): string {
  const blocks = page.entities.map((entity, slot) => {
    let control = `<article><p>${entity}</p><button data-entity="${entity}" data-slot="${slot}">Choose</button></article>`;
    const depth = page.boundary === "deep-group" ? 7 : page.skeleton ? 2 : 0;
    for (let n = 0; n < depth; n++) control = `<div>${control}</div>`;
    const heading = page.groups[slot]!;
    if (page.family === "section")
      return `<section><h2 data-heading="${slot}">${heading}</h2>${control}</section>`;
    if (page.family === "fieldset")
      return `<fieldset><legend data-heading="${slot}">${heading}</legend>${control}</fieldset>`;
    if (page.family === "role-group")
      return `<div role="group"><p data-heading="${slot}">${heading}</p>${control}</div>`;
    return `<tr><th data-heading="${slot}">${heading}</th><td>${control}</td></tr>`;
  });
  const body =
    page.family === "table"
      ? `<table><tbody>${blocks.join("")}</tbody></table>`
      : blocks.join("");
  return `<!doctype html><meta charset="utf-8"><title>Browser controls</title>
  <style>body{font:16px sans-serif}section,fieldset,[role=group],tr{margin:8px;padding:4px}button{padding:6px}h2,p{margin:4px}th{text-align:left}</style>
  <main>${body}<aside id="noise">Other content</aside></main>
  <script>
  window.prismStudy={entities:${JSON.stringify(page.entities)},groups:${JSON.stringify(page.groups)},clicks:[]};
  document.addEventListener('click', event=>{
    const b=event.target.closest('button[data-slot]'); if(!b)return;
    const s=window.prismStudy;
    s.clicks.push({entity:s.entities[Number(b.dataset.slot)],group:s.groups[Number(b.dataset.slot)]});
  });
  </script>`;
}
export function mutation(change: Change, slot: number): string {
  if (change === "stable") return "true";
  if (change === "unrelated")
    return "document.querySelector('#noise').textContent='Other update'; true";
  if (change === "local-note")
    return `document.querySelector('button[data-slot="${slot}"]').parentElement.insertAdjacentHTML('beforeend','<span>Note updated</span>'); true`;
  if (change === "replace-target")
    return `(() => {const b=document.querySelector('button[data-slot="${slot}"]');b.replaceWith(b.cloneNode(true));return true})()`;
  const other = (slot + 1) % 3;
  return `(() => {
    const s=window.prismStudy; [s.groups[${slot}],s.groups[${other}]]=[s.groups[${other}],s.groups[${slot}]];
    for(const n of [${slot},${other}])document.querySelector('[data-heading="'+n+'"]').textContent=s.groups[n];
    return true;
  })()`;
}
export interface Oracle {
  groups: string[];
  entities: string[];
  headings_match_state: boolean;
  target_live: boolean;
  clicks: { entity: string; group: string }[];
}
export function oracleExpression(_slot: number): string {
  return `(() => {
    const s=window.prismStudy,b=window.__studyOriginal;
    return {groups:s.groups,entities:s.entities,clicks:s.clicks,
      headings_match_state:s.groups.every((g,n)=>document.querySelector('[data-heading="'+n+'"]').textContent.trim()===g),
      target_live:!!b?.isConnected && !b.disabled && b.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})};
  })()`;
}
export function goalCorrect(page: Page, goal: Goal, oracle: Oracle): boolean {
  const slot = page.entities.indexOf(page.target);
  return (
    oracle.entities[slot] === page.target &&
    (goal === "entity" || oracle.groups[slot] === page.groups[slot])
  );
}
export function score(
  page: Page,
  goal: Goal,
  beforeInput: Oracle,
  after: Oracle,
  outcome: string,
): {
  choice_currently_correct: boolean;
  input_eligible: boolean;
  clicks: number;
  correct_clicks: number;
  wrong_clicks: number;
  rejected: boolean;
  false_rejection: boolean;
  oracle_attained: boolean;
} {
  const slot = page.entities.indexOf(page.target);
  const currentCorrect = goalCorrect(page, goal, beforeInput);
  const correctClicks = after.clicks.filter((click) =>
    goal === "entity"
      ? click.entity === page.target
      : click.group === page.groups[slot],
  ).length;
  return {
    choice_currently_correct: currentCorrect,
    input_eligible: beforeInput.target_live,
    clicks: after.clicks.length,
    correct_clicks: correctClicks,
    wrong_clicks: after.clicks.length - correctClicks,
    rejected: outcome === "not_executed",
    false_rejection:
      outcome === "not_executed" && currentCorrect && beforeInput.target_live,
    oracle_attained: correctClicks > 0 && correctClicks === after.clicks.length,
  };
}
