import type { TargetEvidence } from "../../src/browser/evidence.ts";
import type { Goal, Page } from "./design.ts";
import { Buffer } from "node:buffer";
import { z } from "zod";

export interface CliTarget extends TargetEvidence {
  ref: string;
  operation: string;
  label: string;
  role?: string;
}
export interface CliView {
  session: string;
  observation: string;
  evidence: string;
  page: { url: string; title: string; status: string };
  targets: CliTarget[];
}
export type BindingArm = "bound" | "unbound";
export const MODELS = ["glm-5.3-flash", "deepseek-v4.1-flash"] as const;
export const SYSTEM = `You are an external caller of a browser CLI. Choose one offered click target to satisfy the goal. Use only the observation supplied. A group list lists group names; belongs_to links a target to a group ID, and ?? means the binding is unknown. Do not assume group-list order matches target order. Return only a JSON object with exactly one key: {"target":"<exact offered ref>"}. If the supplied information is insufficient, you may return {"target":null}. Do not invent a ref or output explanations.`;

export function goalText(page: Page, goal: Goal): string {
  const slot = page.entities.indexOf(page.target);
  return goal === "entity"
    ? `Click Choose for ${page.target}.`
    : `Click Choose in the ${page.groups[slot]} group.`;
}
export function projection(
  view: CliView,
  goal: string,
  arm: BindingArm,
): Record<string, unknown> {
  const candidates = view.targets.filter(
    (target) => target.operation === "click" && target.label === "Choose",
  );
  if (candidates.length !== 3)
    throw new Error("Expected three offered click candidates");
  const texts = [
    ...new Set(
      candidates.flatMap((target) =>
        (target.relations ?? []).map((relation) => relation.text),
      ),
    ),
  ].sort();
  if (texts.length !== 3 || candidates.some((target) => target.relations?.length !== 1))
    throw new Error(
      "Ordinary model study requires one distinct public group per candidate",
    );
  return {
    goal,
    observation: {
      session: view.session,
      observation: view.observation,
      evidence: view.evidence,
      page: view.page,
      groups: texts.map((text, i) => ({ id: `R${i + 1}`, text })),
      targets: candidates.map((target) => ({
        ref: target.ref,
        operation: target.operation,
        label: target.label,
        ...(target.role ? { role: target.role } : {}),
        description: target.description,
        context: target.context,
        belongs_to:
          arm === "bound" ? `R${texts.indexOf(target.relations![0]!.text) + 1}` : "??",
      })),
    },
  };
}
export function pairedProjection(
  view: CliView,
  goal: string,
): { bound: Record<string, unknown>; unbound: Record<string, unknown>; bytes: number } {
  const bound = projection(view, goal, "bound");
  const unbound = projection(view, goal, "unbound");
  const a = JSON.stringify(bound);
  const b = JSON.stringify(unbound);
  if (Buffer.byteLength(a) !== Buffer.byteLength(b))
    throw new Error("Projection lengths differ");
  const withoutBinding = (payload: Record<string, unknown>): string =>
    JSON.stringify(payload, (key, value) =>
      key === "belongs_to" ? "__binding__" : value,
    );
  if (withoutBinding(bound) !== withoutBinding(unbound))
    throw new Error("Projection changes more than bindings");
  if (/prismStudy|data-entity|data-heading|correct_target|oracle/.test(a + b))
    throw new Error("Private metadata in model payload");
  return { bound, unbound, bytes: Buffer.byteLength(a) };
}
export function parseChoice(content: string, candidates: CliTarget[]): string | null {
  const choice = z
    .object({ target: z.string().nullable() })
    .strict()
    .parse(JSON.parse(content)).target;
  if (
    choice !== null &&
    !candidates.some(
      (target) =>
        target.operation === "click" &&
        target.label === "Choose" &&
        target.ref === choice,
    )
  )
    throw new Error("Choice is not an offered click reference");
  return choice;
}
export interface ModelCell {
  index: number;
  page: Page;
  goal: Goal;
  arm: BindingArm;
  model: string;
  id: string;
}
export function modelCells(pageSet: Page[]): ModelCell[] {
  const jobs: ModelCell[] = [];
  for (const [p, page] of pageSet.entries())
    for (const goal of ["group", "entity"] as const) {
      const arms: BindingArm[] = p % 2 ? ["unbound", "bound"] : ["bound", "unbound"];
      const models = p % 2 ? [...MODELS].reverse() : [...MODELS];
      for (const model of models)
        for (const arm of arms)
          jobs.push({
            index: jobs.length,
            page,
            goal,
            arm,
            model,
            id: `${page.id}:${goal}:${arm}:${model}`,
          });
    }
  return jobs;
}
