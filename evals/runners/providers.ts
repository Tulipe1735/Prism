import type { BrowserSession } from "../../src/browser/session.ts";
import type { AgentDependencies, ChooseInput } from "../runtime/agent.ts";
import type { Decision } from "../../src/shared/types.ts";
import type { Cohort, EvalTask, Provider, Variant } from "../schema.ts";
import type { Collector } from "./collector.ts";
import process from "node:process";
import { choose } from "../runtime/decision.ts";
import { ConfigError } from "../../src/shared/errors.ts";
import { assessTarget, chatDecision } from "./model.ts";
import { representationFor } from "./representation.ts";

/** Feed scripted TypeSafe responses through the real chooser/parser, never a second loop. */
function scriptedResponse(task: EvalTask, input: ChooseInput, body: any): unknown {
  const space = input.snapshot.actions;
  const dismiss = space.find((action) => action.label === "Dismiss update notice");
  const history = input.history.filter(
    (entry) => entry.action !== "Dismiss update notice",
  );
  const plan = task.script?.[history.length];
  if (task.script === undefined)
    throw new Error(`Task ${task.id} has no scripted driver.`);
  const action =
    dismiss ??
    (plan === undefined
      ? undefined
      : space.find(
          (candidate) => candidate.kind === plan.kind && candidate.label === plan.label,
        ));
  if (plan !== undefined && action === undefined)
    throw new Error(`Observed action not found: ${plan.kind} ${plan.label}`);
  const operation =
    action === undefined
      ? "DONE"
      : ({ click: "CLICK", fill: "TYPE_TEXT", select: "SELECT" }[
          action.kind as "click" | "fill" | "select"
        ] ?? action.id.toUpperCase());
  const answers: Record<string, unknown> = {};
  function answer(choice: string, criteria: Record<string, unknown>): unknown {
    return {
      choice,
      confidence: 1,
      probabilities: Object.fromEntries(
        Object.keys(criteria).map((id) => [id, id === choice ? 1 : 0]),
      ),
    };
  }
  answers.operation = answer(operation, body.questions.operation.criteria);
  const question = body.questions[`${operation.toLowerCase()}_target`];
  if (question !== undefined && action !== undefined) {
    const target = Object.keys(question.criteria).find(
      (index) => question.criteria[index].element === `[${index}] ${action.label}`,
    );
    if (target === undefined)
      throw new Error("Scripted target was not offered by Prism.");
    const selected = task.fault
      ? Object.keys(question.criteria).find((index) => index !== target)
      : target;
    if (selected === undefined)
      throw new Error("Validation fault requires a distractor.");
    answers[`${operation.toLowerCase()}_target`] = {
      ...(answer(target, question.criteria) as object),
      choice: selected,
    };
  }
  return { model: "scripted-typesafe", usage: {}, answers };
}

export function createDependencies(options: {
  task: EvalTask;
  provider: Provider;
  variant: Variant;
  collector: Collector;
  afterDecision: () => Promise<void>;
  setStage: (stage: "decision") => void;
  signal: AbortSignal;
  session?: BrowserSession;
  cohort?: Cohort;
  beforeCall?: () => void;
}): AgentDependencies {
  const { task, provider, variant, collector } = options;
  const decisionKey = options.cohort
    ? process.env[options.cohort.apiKeyEnv]?.trim()
    : undefined;
  if (provider === "model" && (!decisionKey || !options.cohort || !options.session))
    throw new ConfigError(
      "A cohort, browser session and configured model key are required for real-model evals.",
    );
  if (provider === "scripted" && variant.startsWith("raw-selector"))
    throw new ConfigError("raw-selector requires the real-model cohort runner.");
  let modelText: string | null = null;
  return {
    choose: async (input) => {
      options.signal.throwIfAborted();
      options.setStage("decision");
      collector.begin(input.history.length + 1);
      if (provider === "model") {
        const result = await chatDecision({
          input,
          session: options.session!,
          cohort: options.cohort!,
          apiKey: decisionKey!,
          collector,
          signal: options.signal,
          selector: variant.startsWith("raw-selector"),
          representation: representationFor(variant),
          validation: variant !== "prism-no-validation",
          beforeCall: options.beforeCall,
        });
        modelText = result.text;
        const action = input.snapshot.actions.find(
          (a) => a.id === result.decision.choice,
        );
        collector.decision(
          result.decision,
          action
            ? { action_id: action.id, node: action.node ?? null, label: action.label }
            : null,
        );
        if (action) collector.assessment(await assessTarget(options.session!, action));
        if (action?.node !== undefined) await options.afterDecision();
        return result.decision;
      }
      let scriptError: unknown;
      const fetchImpl: typeof fetch = async (url, init) => {
        options.signal.throwIfAborted();
        const body = JSON.parse(String(init?.body));
        let response: Response;
        try {
          response = new Response(JSON.stringify(scriptedResponse(task, input, body)));
        } catch (error) {
          scriptError = error;
          response = new Response("Scripted driver error", { status: 400 });
        }
        if (response.ok) {
          try {
            collector.response(body, await response.clone().json());
          } catch {
            /* The production parser reports malformed JSON. */
          }
        }
        return response;
      };
      let decision: Decision;
      try {
        decision = await choose({
          ...input,
          apiKey: decisionKey ?? "scripted",
          fetchImpl,
          validation: variant !== "prism-no-validation",
        });
      } catch (error) {
        throw scriptError ?? error;
      }
      options.signal.throwIfAborted();
      const action = input.snapshot.actions.find(
        (candidate) => candidate.id === decision.choice,
      );
      collector.decision(
        decision,
        action === undefined
          ? null
          : { action_id: action.id, node: action.node ?? null, label: action.label },
      );
      if (decision.choice !== "DONE" && decision.choice !== "BLOCKED")
        await options.afterDecision();
      return decision;
    },
    fieldText: async (context) => {
      options.signal.throwIfAborted();
      options.setStage("decision");
      if (provider === "scripted") {
        const plan = task.script?.find(
          (entry) => entry.kind === "fill" && entry.label === context.field.label,
        );
        return {
          text: plan?.text ?? null,
          model: "scripted-text",
          usage: {},
          latencyMs: 0,
        };
      }
      return { text: modelText, model: options.cohort!.model, usage: {}, latencyMs: 0 };
    },
  };
}
