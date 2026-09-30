import type { Decision, HistoryEntry, Snapshot } from "../shared/types.ts";
import process from "node:process";
import { ModelOutputError } from "../shared/errors.ts";
import { postJson } from "../shared/http.ts";
import { actionSpace } from "./action-space.ts";
import { NEXT_ACTION, TARGET } from "./prompts.ts";

const SYSTEMONE_URL = "https://api.typesafe.ai/v1/systemone";
const DEFAULT_MODEL = "jev-latest";

const OPERATION_LABELS: Record<string, string> = {
  CLICK:
    "Click an element, button, menu option, autocomplete suggestion, or calendar day.",
  TYPE_TEXT:
    "Enter or replace text in an editable field. A small LLM will supply the value from the goal.",
  SELECT: "Select an observed dropdown value.",
};

export interface ChooseOptions {
  snapshot: Snapshot;
  goal: string;
  history: HistoryEntry[];
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
  /** Disable distribution/argmax checks only. Observed-target mapping is retained. */
  validation?: boolean;
}

interface ValidatedChoice {
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export async function choose(options: ChooseOptions): Promise<Decision> {
  const { snapshot, goal, history } = options;
  const { elements, targets, controls } = actionSpace(snapshot.actions);

  const operations: Record<string, string> = {};
  for (const operation of Object.keys(targets))
    operations[operation] = OPERATION_LABELS[operation]!;
  for (const [name, action] of Object.entries(controls))
    operations[name] = action.label;
  operations.DONE = "Every requirement is visibly satisfied.";
  operations.BLOCKED = "No supported operation can progress.";

  const questions: Record<string, unknown> = {
    operation: {
      type: "choice",
      criteria: operations,
      instructions: { goal, rules: NEXT_ACTION },
    },
  };
  for (const [operation, candidates] of Object.entries(targets)) {
    const criteria: Record<string, unknown> = {};
    for (const [index, action] of Object.entries(candidates)) {
      criteria[index] = {
        element: `[${index}] ${action.label}`,
        current_value: action.current_value ?? action.value ?? "",
        ...(action.role !== undefined ? { role: action.role } : {}),
        ...(action.checked !== undefined ? { checked: action.checked } : {}),
        ...(action.selected !== undefined ? { selected: action.selected } : {}),
        ...(action.expanded !== undefined ? { expanded: action.expanded } : {}),
      };
    }
    questions[`${operation.toLowerCase()}_target`] = {
      type: "choice",
      criteria,
      instructions: { goal, operation, rules: [NEXT_ACTION, TARGET] },
    };
  }

  const body = {
    model: options.model ?? process.env.TYPESAFE_MODEL ?? DEFAULT_MODEL,
    state: {
      page: { url: snapshot.url, title: snapshot.title, text: snapshot.text },
      elements,
      recent_actions: history.slice(-10).map((entry) => ({
        action: entry.action,
        kind: entry.kind,
        text: entry.text,
        page_changed: entry.page_changed,
      })),
    },
    questions,
  };

  const started = Date.now();
  const result = await postJson({
    url: SYSTEMONE_URL,
    apiKey: options.apiKey,
    body,
    fetchImpl: options.fetchImpl,
    label: "TypeSafe decision model",
  });
  const latencyMs = Date.now() - started;

  return parseDecisionResponse(result, {
    snapshot,
    latencyMs,
    request: body,
    validation: options.validation,
  });
}

/** Parse a decision from any model transport using Prism's production validation. */
export function parseDecisionResponse(
  result: unknown,
  options: {
    snapshot: Snapshot;
    latencyMs: number;
    request: unknown;
    validation?: boolean;
  },
): Decision {
  const { targets, controls } = actionSpace(options.snapshot.actions);
  const operations = decisionOperations(options.snapshot);

  const answers = readAnswers(result);
  const validate = options.validation === false ? readChoice : validateChoice;
  const operationAnswer = validate(answers.operation, operations);
  const operation = operationAnswer.choice;

  let target: string | null = null;
  let targetAnswer: ValidatedChoice | null = null;
  const probabilities: Record<string, number> = {};
  let choice: string;

  const operationTargets = targets[operation];
  if (operationTargets !== undefined) {
    // Unused target heads cannot cause an action. Validate only the head the operation selects.
    targetAnswer = validate(
      answers[`${operation.toLowerCase()}_target`],
      operationTargets,
    );
    target = targetAnswer.choice;
    const action = operationTargets[target];
    if (action === undefined) throw invalidResponse();
    choice = action.id;
    for (const [index, candidate] of Object.entries(operationTargets)) {
      probabilities[candidate.id] = targetAnswer.probabilities[index]!;
    }
  } else {
    const control = controls[operation];
    choice = control?.id ?? operation;
    probabilities[choice] = operationAnswer.probabilities[operation]!;
  }

  return {
    choice,
    operation,
    target,
    confidence: operationAnswer.confidence,
    probabilities,
    operationProbabilities: operationAnswer.probabilities,
    targetProbabilities: targetAnswer?.probabilities ?? {},
    targetConfidence: targetAnswer?.confidence ?? null,
    rawAnswers: answers,
    model: readModel(result),
    usage: readUsage(result),
    latencyMs: options.latencyMs,
    request: options.request,
  };
}

export function decisionOperations(snapshot: Snapshot): Record<string, string> {
  const { targets, controls } = actionSpace(snapshot.actions);
  return {
    ...Object.fromEntries(
      Object.keys(targets).map((key) => [key, OPERATION_LABELS[key]!]),
    ),
    ...Object.fromEntries(
      Object.entries(controls).map(([key, action]) => [key, action.label]),
    ),
    DONE: "Every requirement is visibly satisfied.",
    BLOCKED: "No supported operation can progress.",
  };
}

function readAnswers(result: unknown): Record<string, unknown> {
  if (!isRecord(result) || !isRecord(result.answers)) throw invalidResponse();
  return result.answers;
}

function readModel(result: unknown): string {
  if (!isRecord(result) || typeof result.model !== "string") throw invalidResponse();
  return result.model;
}

function readUsage(result: unknown): Record<string, unknown> {
  if (!isRecord(result) || !isRecord(result.usage)) return {};
  return result.usage;
}

export function validateChoice(
  answer: unknown,
  ids: Record<string, unknown>,
): ValidatedChoice {
  if (!isRecord(answer)) throw invalidResponse();
  const { choice, probabilities, confidence } = answer;
  if (typeof choice !== "string" || !Object.hasOwn(ids, choice))
    throw invalidResponse();
  if (!isRecord(probabilities)) throw invalidResponse();
  if (typeof confidence !== "number" || !Number.isFinite(confidence))
    throw invalidResponse();

  const expected = Object.keys(ids).sort();
  const actual = Object.keys(probabilities).sort();
  if (
    expected.length !== actual.length ||
    expected.some((key, i) => key !== actual[i])
  ) {
    throw invalidResponse();
  }

  let sum = 0;
  let max = -Infinity;
  for (const key of expected) {
    const value = probabilities[key];
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 1
    ) {
      throw invalidResponse();
    }
    sum += value;
    if (value > max) max = value;
  }
  if (Math.abs(sum - 1) >= 0.02) throw invalidResponse();
  if (probabilities[choice]! < max - 1e-6) throw invalidResponse();

  return {
    choice,
    probabilities: probabilities as Record<string, number>,
    confidence,
  };
}

function readChoice(answer: unknown, ids: Record<string, unknown>): ValidatedChoice {
  if (
    !isRecord(answer) ||
    typeof answer.choice !== "string" ||
    !Object.hasOwn(ids, answer.choice)
  )
    throw invalidResponse();
  const probabilities: Record<string, number> = {};
  for (const id of Object.keys(ids)) {
    const value = isRecord(answer.probabilities) ? answer.probabilities[id] : undefined;
    probabilities[id] = typeof value === "number" && Number.isFinite(value) ? value : 0;
  }
  return {
    choice: answer.choice,
    probabilities,
    confidence:
      typeof answer.confidence === "number" && Number.isFinite(answer.confidence)
        ? answer.confidence
        : 0,
  };
}

function invalidResponse(): Error {
  return new ModelOutputError("Invalid TypeSafe response; no action executed.");
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
