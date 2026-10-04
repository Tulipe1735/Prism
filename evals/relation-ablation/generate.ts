/**
 * Generator for the P0-A/P0-B relation ablation block.
 *
 * Writes:
 *   evals/fixtures/relation-ablation-v1/r<page><code>.html   (24 pages)
 *   evals/relation-ablation/plan.json                       (frozen design table)
 *   evals/tasks/relation-ablation-v1.json                    (48 tasks + oracles)
 *
 * Design rules (audit report §11 P0-A/P0-B; see evals/cohorts/relation-ablation-v1.protocol.md):
 * - Four relation families x two DOM skeletons = eight base pages, opaque `r1`..`r8` names.
 * - Every page has three candidate entities `Item <n>` / `<Group>` in three distinct
 *   group scopes, so the requested pair is identifiable by its own identity only.
 * - Three position codes per page (a/b/c) hold the three pairs in three rotations of the
 *   same cyclic order, with a separate entity-to-group permutation. The requested entity
 *   stays fixed per base page and visits all positions/groups. Every group also visits all
 *   positions. Only opaque hashed filenames, not the internal code, enter model payloads.
 * - Two goal conditions per page: the local goal names the entity (`Edit Item 7.`), the
 *   qualified goal names the group (`Edit the control for Alpha.`). Both request the same
 *   pair, one via the local entity and one via the group relation.
 * - Private oracle attributes exist in the fixture but never enter model payloads.
 *
 * Run: node --experimental-strip-types --disable-warning=ExperimentalWarning \
 *        evals/relation-ablation/generate.ts [--check]
 */
import { createHash } from "node:crypto";
import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
/** Generated pages live with the other eval fixtures; the design table lives here. */
const pagesDir = resolve(repo, "evals/fixtures/relation-ablation-v1");
const planFile = resolve(here, "plan.json");
const taskFile = resolve(repo, "evals/tasks/relation-ablation-v1.json");

type GoalCondition = "local" | "group";
type Family = "section" | "legend" | "nested" | "table";
type Scope = "section" | "article" | "fieldset" | "tr" | "role" | "list";
type Identity = "heading" | "legend" | "caption" | "text";

interface Skeleton {
  family: Family;
  scope: Scope;
  identity: Identity;
  /** Container role the extractor reads as the nearest semantic container. */
  container: "group" | "row";
}

export const ITEMS = ["Item 7", "Item 12", "Item 31"] as const;
export const GROUPS = ["Alpha", "Beta", "Gamma"] as const;

export const POSITION_CODES = ["a", "b", "c"] as const;

/**
 * Candidate position -> entity index for one state and base-page shift.
 * Every position offers all three entities across the three states.
 */
export function rotationFor(code: number, shift = 0): [number, number, number] {
  const base = [
    [0, 1, 2],
    [2, 0, 1],
    [1, 2, 0],
  ][code % 3]!;
  const rotated = base.map((_, index) => base[(index + (shift % 3) + 3) % 3]!) as [
    number,
    number,
    number,
  ];
  return rotated;
}

/**
 * Rotate the entity order across base pages. Internal code letters are design metadata;
 * the model sees opaque URLs. Entity-to-group and group-to-position balance are checked
 * separately, rather than inferred from this permutation.
 */
export function shiftFor(pageIndex: number): number {
  return pageIndex % 3;
}

/** A fixed requested entity per base page; rotate its position and group across states. */
export function targetFor(pageIndex: number): number {
  return pageIndex % 3;
}

const SKELETONS: Skeleton[] = [
  { family: "section", scope: "section", identity: "heading", container: "group" },
  { family: "section", scope: "article", identity: "heading", container: "group" },
  { family: "legend", scope: "fieldset", identity: "legend", container: "group" },
  { family: "legend", scope: "fieldset", identity: "legend", container: "row" },
  { family: "nested", scope: "role", identity: "text", container: "row" },
  { family: "nested", scope: "list", identity: "text", container: "group" },
  { family: "table", scope: "tr", identity: "caption", container: "row" },
  { family: "table", scope: "article", identity: "text", container: "row" },
];

export interface PageDesign {
  page: string;
  family: Family;
  skeleton: Skeleton;
  /** code -> rotation (position -> pair) and the requested pair index. */
  codes: {
    code: string;
    rotation: [number, number, number];
    groups: [number, number, number];
    target: number;
  }[];
}

export const PLAN: PageDesign[] = SKELETONS.map((skeleton, index) => ({
  page: `r${index + 1}`,
  family: skeleton.family,
  skeleton,
  codes: POSITION_CODES.map((code, codeIndex) => ({
    code,
    rotation: rotationFor(codeIndex, shiftFor(index)),
    groups: [0, 1, 2].map((entity) => (entity + 2 * codeIndex + index) % 3) as [
      number,
      number,
      number,
    ],
    target: targetFor(index),
  })),
}));

function controlMarkup(
  name: string,
  description: string,
  correct: boolean,
  container: Skeleton["container"],
): string {
  const attributes = [
    `type="button"`,
    `data-target="${name}"`,
    `data-description="${description}"`,
    correct ? "data-correct" : null,
  ]
    .filter(Boolean)
    .join(" ");
  // The control's accessible name and the container's own visible text are both the local
  // entity, so the local arm can identify the entity but never the group. The heading is a
  // group scope (`article`/`fieldset`/`div`/`tr`) whose own identity element is the group.
  return `<div role="${container}">
          <h4>${name}</h4>
          <button ${attributes}>${name}</button>
        </div>`;
}

function scopeMarkup(
  skeleton: Skeleton,
  group: string,
  control: { name: string; description: string; correct: boolean },
): string {
  const body = controlMarkup(
    control.name,
    control.description,
    control.correct,
    skeleton.container,
  );
  if (skeleton.scope === "tr")
    return `<tr>
        <th scope="rowgroup">${group}</th>
        <td>${body}</td>
      </tr>`;
  const inner =
    skeleton.identity === "legend"
      ? `<legend>${group}</legend>\n        ${body}`
      : skeleton.identity === "text"
        ? `<p>${group}</p>\n        ${body}`
        : `<h3>${group}</h3>\n        ${body}`;
  if (skeleton.scope === "article")
    return `<article>\n        ${inner}\n      </article>`;
  if (skeleton.scope === "fieldset")
    return `<fieldset>\n        ${inner}\n      </fieldset>`;
  if (skeleton.scope === "role")
    return `<div role="group" aria-label="${group}">\n        <span>${group}</span>\n        <div>${body}</div>\n      </div>`;
  if (skeleton.scope === "list")
    return `<li><strong>${group}</strong><div>${body}</div></li>`;
  return `<section>\n        ${inner}\n      </section>`;
}

function candidates(
  rotation: [number, number, number],
  groups: [number, number, number],
  target: number,
): { name: string; group: string; correct: boolean }[] {
  // Pair `index` carries item `index` and the independently assigned group; rotation places entities
  // at candidate positions, and `target` is the pair the goal requests.
  return rotation.map((pair) => ({
    name: ITEMS[pair]!,
    group: GROUPS[groups[pair]!]!,
    correct: pair === target,
  }));
}

function pageHtml(
  skeleton: Skeleton,
  rotation: [number, number, number],
  groups: [number, number, number],
  target: number,
  condition: GoalCondition,
): string {
  const pairs = candidates(rotation, groups, target);
  // The group goal names the group of the requested pair; each page has exactly one
  // control per group, so both conditions accept the same element.
  const correctGroup = GROUPS[groups[target]!];
  const listed = pairs.map((pair) =>
    scopeMarkup(skeleton, pair.group, {
      name: pair.name,
      description: `${pair.name} in ${pair.group}`,
      correct: condition === "group" ? pair.group === correctGroup : pair.correct,
    }),
  );
  const scopes = listed.join("\n      ");
  const table =
    skeleton.scope === "tr"
      ? `<table>\n        <tbody>\n      ${scopes}\n        </tbody>\n      </table>`
      : skeleton.scope === "list"
        ? `<ul>${scopes}</ul>`
        : scopes;
  const heading = skeleton.family === "table" ? "" : `<h1>Manage entries</h1>\n    `;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Manage entries</title>
    <style>
      body {
        font: 16px sans-serif;
        margin: 20px;
      }
      article,
      section,
      fieldset,
      li,
      tr,
      [role="group"],
      [role="row"] {
        margin: 6px;
        padding: 4px;
      }
      button {
        display: inline-block;
        padding: 8px;
        margin: 4px;
      }
      h1,
      h3 {
        font-size: 16px;
        margin: 4px;
      }
    </style>
    <script src="/relation-ablation-v1/support.js" defer></script>
  </head>
  <body>
    ${heading}<main id="controls">
      ${table}
    </main>
    <p id="result" role="status">Pending</p>
    <div
      id="eval-state"
      hidden
      data-wrong-targets="0"
      data-correct-actions="0"
      data-mutations="0"
    ></div>
  </body>
</html>
`;
}

export interface GeneratedTask {
  id: string;
  url: string;
  goal: string;
  category: "grounding";
  preregistered: {
    ambiguity_class: "unique" | "structural";
    minimum_level: "compact" | "structural";
  };
  /** Frozen design row for this task; the experiment schema validates it. */
  design: {
    page: string;
    family: Family;
    condition: GoalCondition;
    position: number;
    entity: string;
    group: string;
  };
  success: unknown;
}

/** Frozen design row for one task; lives in plan.json, never in the task definition. */
export interface DesignRow {
  id: string;
  page: string;
  family: Family;
  condition: GoalCondition;
  position: number;
  entity: string;
  group: string;
  targetPair: number;
}

export function pageUrl(page: string, code: string): string {
  const name = createHash("sha256")
    .update(`relation-ablation-v1/${page}/${code}`)
    .digest("hex")
    .slice(0, 16);
  return `/relation-ablation-v1/${name}.html`;
}

export function positionOf(rotation: [number, number, number], target: number): number {
  return rotation.indexOf(target) + 1;
}

export function designRowsForPage(page: PageDesign): DesignRow[] {
  const rows: DesignRow[] = [];
  for (const { code, rotation, groups, target } of page.codes) {
    for (const condition of ["local", "group"] as GoalCondition[]) {
      rows.push({
        id: `${page.page}${code}-${condition === "group" ? "g" : "l"}`,
        page: page.page,
        family: page.family,
        condition,
        position: positionOf(rotation, target),
        entity: ITEMS[target]!,
        group: GROUPS[groups[target]!]!,
        targetPair: target,
      });
    }
  }
  return rows;
}

export function tasksForPage(page: PageDesign): GeneratedTask[] {
  const tasks: GeneratedTask[] = [];
  for (const { code, rotation, groups, target } of page.codes) {
    for (const condition of ["local", "group"] as GoalCondition[]) {
      const entity = ITEMS[target]!;
      const group = GROUPS[groups[target]!]!;
      tasks.push({
        id: `${page.page}${code}-${condition === "group" ? "g" : "l"}`,
        url: pageUrl(page.page, code),
        goal:
          condition === "group" ? `Edit the control for ${group}.` : `Edit ${entity}.`,
        category: "grounding",
        preregistered: {
          ambiguity_class: condition === "group" ? "structural" : "unique",
          minimum_level: condition === "group" ? "structural" : "compact",
        },
        design: {
          page: page.page,
          family: page.family,
          condition,
          position: positionOf(rotation, target),
          entity,
          group,
        },
        success: {
          checks: [
            {
              kind: "text",
              selector: "#result",
              equals: `Completed: ${entity} in ${group}`,
            },
            {
              kind: "attribute",
              selector: "#eval-state",
              attribute: "data-correct-actions",
              equals: "1",
            },
          ],
          wrongTargetCounter: {
            selector: "#eval-state",
            attribute: "data-wrong-targets",
          },
        },
      });
    }
  }
  return tasks;
}

/** Design assertions: the block must not admit an index, URL or group-position shortcut. */
export function checkDesign(plan: PageDesign[]): void {
  if (new Set(plan.map((page) => JSON.stringify(page.skeleton))).size !== plan.length)
    throw new Error("Duplicate DOM skeletons are not distinct base pages.");
  for (const page of plan) {
    const targetPositions = page.codes.map(({ rotation, target }) =>
      positionOf(rotation, target),
    );
    if (new Set(targetPositions).size !== page.codes.length)
      throw new Error(`${page.page}: a position code repeats the requested position.`);
    for (const position of [1, 2, 3]) {
      if (targetPositions.filter((value) => value === position).length !== 1)
        throw new Error(
          `${page.page}: position ${position} is not requested exactly once.`,
        );
    }
    // Position must not encode identity: at any fixed position the three codes must offer
    // all three candidate pairs (which carry the three entities and the three groups).
    for (let position = 0; position < 3; position += 1) {
      const pairs = page.codes.map(({ rotation }) => rotation[position]!);
      if (new Set(pairs).size !== 3)
        throw new Error(
          `${page.page}: position ${position + 1} does not cover all candidates.`,
        );
    }
    for (const entity of [0, 1, 2]) {
      const assigned = page.codes.map(({ groups }) => groups[entity]);
      if (new Set(assigned).size !== 3)
        throw new Error(`${page.page}: entity ${entity} does not visit every group.`);
    }
    if (new Set(page.codes.map(({ groups, target }) => groups[target])).size !== 3)
      throw new Error(`${page.page}: not every group is requested.`);
    for (let position = 0; position < 3; position++) {
      const assigned = page.codes.map(
        ({ groups, rotation }) => groups[rotation[position]!]!,
      );
      if (new Set(assigned).size !== 3)
        throw new Error(
          `${page.page}: group identity stays at position ${position + 1}.`,
        );
    }
    // Fixed requested entity per base page; its position and group move across states.
    for (const { code, rotation, target } of page.codes) {
      if (
        new Set(rotation).size !== 3 ||
        rotation.some((value) => ![0, 1, 2].includes(value))
      )
        throw new Error(`${page.page}${code}: invalid candidate permutation.`);
      if (![0, 1, 2].includes(target))
        throw new Error(`${page.page}${code}: invalid target identity.`);
    }
  }
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  checkDesign(PLAN);
  const files = new Map<string, string>();
  const tasks: GeneratedTask[] = [];
  for (const page of PLAN) {
    for (const { code, rotation, groups, target } of page.codes) {
      for (const condition of ["local", "group"] as GoalCondition[])
        files.set(
          pageUrl(page.page, code).split("/").pop()!,
          pageHtml(page.skeleton, rotation, groups, target, condition),
        );
    }
    tasks.push(...tasksForPage(page));
  }
  const inventory = {
    design: "relation-ablation-v1",
    note: "Generated by generate.ts; edit the design table there, never a page by hand.",
    pages: PLAN.map((page) => ({
      page: page.page,
      family: page.family,
      skeleton: page.skeleton,
      codes: page.codes.map(({ code, rotation, groups, target }) => ({
        rotation,
        groups,
        code,
        url: pageUrl(page.page, code),
        entity: ITEMS[target]!,
        group: GROUPS[groups[target]!]!,
        position: positionOf(rotation, target),
        targetPair: target,
        // One page file is shared by the local and the group task of the same state.
        tasks: (["local", "group"] as GoalCondition[]).map((condition) => ({
          condition,
          id: `${page.page}${code}-${condition === "group" ? "g" : "l"}`,
        })),
      })),
    })),
    tasks: PLAN.flatMap(designRowsForPage),
    // Position held by the requested candidate pair for each page code.
    positionsByCode: Object.fromEntries(
      POSITION_CODES.map((code, codeIndex) => [
        code,
        PLAN.map((page) => ({
          page: page.page,
          position: positionOf(
            page.codes[codeIndex]!.rotation,
            page.codes[codeIndex]!.target,
          ),
        })),
      ]),
    ),
  };
  if (check) {
    let drift = 0;
    for (const [name, content] of files) {
      const existing = await readFile(resolve(pagesDir, name), "utf8").catch(
        () => null,
      );
      if (existing !== content) {
        drift += 1;
        console.error(`stale: ${name}`);
      }
    }
    for (const [path, content] of [
      [taskFile, `${JSON.stringify(tasks, null, 2)}\n`],
      [planFile, `${JSON.stringify(inventory, null, 2)}\n`],
    ] as const) {
      const existing = await readFile(path, "utf8").catch(() => null);
      if (existing !== content) {
        drift += 1;
        console.error(`stale: ${path}`);
      }
    }
    if (drift)
      throw new Error(`${drift} generated artifact(s) differ from the design table.`);
    console.log(
      `relation-ablation-v1: ${files.size} pages and ${tasks.length} tasks match the design table.`,
    );
    return;
  }
  for (const name of await readdir(pagesDir))
    if (name.endsWith(".html") && !files.has(name))
      await unlink(resolve(pagesDir, name));
  for (const [name, content] of files)
    await writeFile(resolve(pagesDir, name), content);
  await writeFile(planFile, `${JSON.stringify(inventory, null, 2)}\n`);
  await writeFile(taskFile, `${JSON.stringify(tasks, null, 2)}\n`);
  console.log(`Wrote ${files.size} pages, plan.json and ${tasks.length} tasks.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
