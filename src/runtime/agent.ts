import type { BrowserSession, Observation } from "../browser/session.ts";
import type {
  Decision,
  HistoryEntry,
  SnapshotActionKind,
  TaskStatus,
} from "../shared/types.ts";
import type { TextContext, TextHelperResult } from "./text-helper.ts";

import { Buffer } from "node:buffer";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { StalePageError } from "../browser/session.ts";
import { fieldContext } from "./text-helper.ts";

export interface ChooseInput {
  snapshot: Observation;
  goal: string;
  history: HistoryEntry[];
}

export interface AgentDependencies {
  choose: (input: ChooseInput) => Promise<Decision>;
  fieldText: (context: TextContext) => Promise<TextHelperResult>;
}

export type AgentEvent =
  | { type: "started"; url: string; title: string; controls: number }
  | {
      type: "decided";
      step: number;
      operation: string;
      choice: string;
      target: string | null;
      label: string | null;
      confidence: number;
      probability: number;
      latencyMs: number;
    }
  | {
      type: "acted";
      step: number;
      kind: SnapshotActionKind;
      label: string;
      text: string | null;
      pageChanged: boolean;
      elapsedMs: number;
    }
  | {
      type: "finished";
      status: TaskStatus;
      reason: string;
    };

export interface ConfirmContext {
  step: number;
  decision: Decision;
  action: Observation["actions"][number] | null;
}

export interface AgentOptions {
  session: BrowserSession;
  goal: string;
  dependencies: AgentDependencies;
  maxSteps?: number;
  recordDir?: string;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
  confirmDecision?: (context: ConfirmContext) => Promise<boolean>;
}

export interface AgentResult {
  status: TaskStatus;
  reason: string;
  finalUrl: string;
  finalTitle: string;
  finalText: string;
  steps: HistoryEntry[];
  elapsedMs: number;
}

const FINAL_TEXT_LIMIT = 4_000;

const DEFAULT_MAX_STEPS = 60;

export async function runAgent(options: AgentOptions): Promise<AgentResult> {
  const { session, goal, dependencies } = options;
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const recordDir = options.recordDir;
  if (recordDir !== undefined) mkdirSync(recordDir, { recursive: true });

  const startedAt = Date.now();
  const elapsed = (): number => Date.now() - startedAt;
  const emit = (event: AgentEvent): void => options.onEvent?.(event);
  const observe = (): Promise<Observation> =>
    session.observe({ screenshot: recordDir !== undefined });

  let snapshot = await observe();
  emit({
    type: "started",
    url: snapshot.url,
    title: snapshot.title,
    controls: snapshot.actions.length,
  });
  if (recordDir !== undefined && snapshot.screenshot !== undefined) {
    writeScreenshot(recordDir, 0, snapshot.screenshot);
  }

  const history: HistoryEntry[] = [];
  let status: TaskStatus = "blocked";
  let reason = "No supported operation can progress.";
  let pendingContext: string | null = null;
  let pendingText: string | null = null;
  let pendingHelper: string | null = null;
  let pendingTextLatency = 0;
  let decisions = 0;
  let staleAborts = 0;

  while (true) {
    if (options.signal?.aborted === true) {
      status = "blocked";
      reason = "Interrupted.";
      break;
    }
    if (history.length >= maxSteps) {
      status = "blocked";
      reason = `Stopped at the ${maxSteps}-action budget.`;
      break;
    }
    if (decisions >= maxSteps * 2) {
      status = "blocked";
      reason = "Model-call budget reached.";
      break;
    }

    try {
      if (!(await session.samePage(snapshot))) {
        snapshot = await observe();
        continue;
      }

      decisions += 1;
      const decision = await dependencies.choose({ snapshot, goal, history });
      const terminal = decision.choice === "DONE" || decision.choice === "BLOCKED";
      const action = terminal
        ? null
        : (snapshot.actions.find((candidate) => candidate.id === decision.choice) ??
          null);
      emit({
        type: "decided",
        step: history.length + 1,
        operation: decision.operation,
        choice: decision.choice,
        target: decision.target,
        label: action?.label ?? null,
        confidence: decision.confidence,
        probability: decision.probabilities[decision.choice] ?? 0,
        latencyMs: decision.latencyMs,
      });

      if (terminal) {
        if (!(await session.samePage(snapshot))) {
          snapshot = await observe();
          continue;
        }
        if (decision.choice === "BLOCKED") {
          status = "blocked";
          reason = "The model reported BLOCKED.";
          break;
        }
        status = "done";
        reason = "The model reported DONE.";
        emit({ type: "finished", status, reason });
        break;
      }

      if (action === null) {
        throw new Error(`Decision references unknown action "${decision.choice}".`);
      }
      if (options.confirmDecision !== undefined) {
        const confirmed = await options.confirmDecision({
          step: history.length + 1,
          decision,
          action,
        });
        if (!confirmed) {
          status = "blocked";
          reason = "Aborted by the operator.";
          break;
        }
      }

      let text: string | null = null;
      let textHelper: string | null = null;
      let textLatencyMs = 0;
      if (action.kind === "fill") {
        if (!(await session.fresh(snapshot, action))) {
          snapshot = await observe();
          continue;
        }
        const context = fieldContext(goal, action, snapshot, history);
        const contextKey = JSON.stringify(context);
        if (pendingContext === contextKey && pendingText !== null) {
          text = pendingText;
          textHelper = pendingHelper;
          textLatencyMs = pendingTextLatency;
        } else {
          const helper = await dependencies.fieldText(context);
          if (helper.text === null) {
            status = "blocked";
            reason = `No value is available for "${action.label}".`;
            break;
          }
          pendingContext = contextKey;
          pendingText = helper.text;
          pendingHelper = helper.model;
          pendingTextLatency = helper.latencyMs;
          text = helper.text;
          textHelper = helper.model;
          textLatencyMs = helper.latencyMs;
        }
      }

      // BrowserSession.act rechecks freshness immediately before input.
      await session.act(action, snapshot, text);
      staleAborts = 0;
      pendingContext = null;
      pendingText = null;

      const before = snapshot;
      const entry: HistoryEntry = {
        step: history.length + 1,
        action: action.label,
        kind: action.kind,
        choice: decision.choice,
        probability: decision.probabilities[decision.choice] ?? 0,
        confidence: decision.confidence,
        latency_ms: decision.latencyMs,
        text,
        text_helper: textHelper,
        text_latency_ms: textLatencyMs,
        operation: decision.operation,
        target: decision.target,
        page_changed: null,
        url: before.url,
        usage: decision.usage,
        executed_ms: elapsed(),
        elapsed_ms: elapsed(),
      };
      // Record execution before observing. A stale post-action observation must not erase it.
      history.push(entry);

      snapshot = await observe();
      entry.page_changed = snapshot.fingerprint !== before.fingerprint;
      entry.url = snapshot.url;
      entry.elapsed_ms = elapsed();
      emit({
        type: "acted",
        step: entry.step,
        kind: entry.kind,
        label: entry.action,
        text: entry.text,
        pageChanged: entry.page_changed,
        elapsedMs: entry.elapsed_ms,
      });
      if (recordDir !== undefined) {
        if (snapshot.screenshot !== undefined) {
          writeScreenshot(recordDir, entry.elapsed_ms, snapshot.screenshot);
        }
        appendStep(recordDir, entry);
      }

      const repeated = history.slice(-3);
      if (
        repeated.length === 3 &&
        repeated.every((item) => item.page_changed === false && item.kind !== "wait")
      ) {
        status = "blocked";
        reason = "Three consecutive actions produced no page change.";
        break;
      }
    } catch (error) {
      if (error instanceof StalePageError) {
        staleAborts += 1;
        if (staleAborts > 5) {
          status = "blocked";
          reason = "The page kept changing before the action could run.";
          break;
        }
        snapshot = await observe();
        continue;
      }
      throw error;
    }
  }

  if (recordDir !== undefined) {
    writeFinalRecord(recordDir, {
      goal,
      status,
      reason,
      steps: history.length,
      elapsedMs: elapsed(),
      url: snapshot.url,
    });
  }
  return {
    status,
    reason,
    finalUrl: snapshot.url,
    finalTitle: snapshot.title,
    finalText: snapshot.text.slice(0, FINAL_TEXT_LIMIT),
    steps: history,
    elapsedMs: elapsed(),
  };
}

function writeScreenshot(recordDir: string, ms: number, base64: string): void {
  const name = `${String(ms).padStart(6, "0")}.jpg`;
  writeFileSync(join(recordDir, name), Buffer.from(base64, "base64"));
}

function appendStep(recordDir: string, entry: HistoryEntry): void {
  writeFileSync(join(recordDir, "steps.jsonl"), `${JSON.stringify(entry)}\n`, {
    flag: "a",
  });
}

function writeFinalRecord(recordDir: string, record: Record<string, unknown>): void {
  writeFileSync(join(recordDir, "final.json"), `${JSON.stringify(record, null, 2)}\n`);
}
