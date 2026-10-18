import type { Representation } from "../../browser/representation.ts";
import type { ObservedAction, PublicState } from "../../browser/state.ts";
import type { SnapshotAction, SnapshotActionKind } from "../../shared/types.ts";
import type { EngineHandle, EngineOptions } from "./engine.ts";
import type { EvidenceCapture, TargetCapture, TargetEvidence } from "./evidence.ts";
import type { Receipt } from "./receipts.ts";
import type { BrowserPage, Observation } from "./session.ts";
import { randomUUID } from "node:crypto";
import { digest } from "../../shared/digest.ts";
import { openEngine } from "./engine.ts";
import { captureEvidence, readTargetEvidence, targetEvidence } from "./evidence.ts";
import { readReceipt, saveReceipt } from "./receipts.ts";
import { openBrowserSession, StalePageError } from "./session.ts";

export class BrowserToolError extends Error {
  override name = "BrowserToolError";
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface BrowserToolOptions {
  /** Receipts live under <directory>/receipts and outlive the tool process. */
  directory: string;
  engine?: EngineOptions["engine"];
  endpoint?: EngineOptions["endpoint"];
}

export interface BrowserToolDependencies {
  openEngine: (options: EngineOptions) => Promise<EngineHandle>;
  openSession: (options: { engine: EngineHandle; url: string }) => Promise<BrowserPage>;
  capture: (session: BrowserPage, scope: Representation) => Promise<EvidenceCapture>;
  read: (
    session: BrowserPage,
    action: SnapshotAction,
    scope: Representation,
  ) => Promise<TargetCapture>;
}

const defaults: BrowserToolDependencies = {
  openEngine,
  openSession: ({ engine, url }) =>
    openBrowserSession({ context: engine.context, url }),
  capture: captureEvidence,
  read: readTargetEvidence,
};

export interface ObservedTarget extends TargetEvidence {
  ref: string;
  operation: SnapshotActionKind;
  option_value?: string;
  option_label?: string;
}

export interface ObservationView {
  session: string;
  observation: string;
  evidence: string;
  scope: Representation;
  page: { url: string; title: string };
  state: PublicState;
  omitted_actions: number;
  targets: ObservedTarget[];
}

export interface TargetContextView {
  session: string;
  observation: string;
  target: string;
  evidence: string;
  scope: Representation;
  description: string;
  state: TargetEvidence["state"];
  context: TargetEvidence["context"];
  relations?: TargetEvidence["relations"];
}

export interface ActInput {
  observation: string;
  target: string;
  evidence: string;
  operation: SnapshotActionKind;
  value?: string;
  request_id: string;
}

export interface ActResult {
  receipt: Receipt;
  replayed: boolean;
  post_observation?:
    | { status: "captured"; data: ObservationView }
    | { status: "failed"; error: { code: string; message: string } };
}

interface Observed {
  id: string;
  snapshot: Observation;
  targets: Map<string, ObservedAction>;
  views: Map<string, Map<string, TargetEvidence>>;
}

interface OpenSession {
  engine: EngineHandle;
  page: BrowserPage;
  observed?: Observed;
}

/**
 * Owns browser sessions, observation references and action receipts. Planning and
 * task-outcome judgement stay in the kernel; this module only reports evidence.
 */
export class BrowserTool {
  private readonly sessions = new Map<string, OpenSession>();
  private readonly options: BrowserToolOptions;
  private readonly dependencies: BrowserToolDependencies;

  constructor(
    options: BrowserToolOptions,
    dependencies: BrowserToolDependencies = defaults,
  ) {
    this.options = options;
    this.dependencies = dependencies;
  }

  async open(options: { url: string }): Promise<{ session: string; url: string }> {
    const engine = await this.dependencies.openEngine({
      engine: this.options.engine,
      endpoint: this.options.endpoint,
    });
    let page: BrowserPage;
    try {
      page = await this.dependencies.openSession({ engine, url: options.url });
    } catch (error) {
      await engine.close().catch(() => undefined);
      throw error;
    }
    const session = `b_${randomUUID()}`;
    this.sessions.set(session, { engine, page });
    return { session, url: options.url };
  }

  async observe(
    sessionId: string,
    scope: Representation = "local",
  ): Promise<ObservationView> {
    const session = this.session(sessionId);
    session.observed = undefined;
    const capture = await this.dependencies.capture(session.page, scope);
    const id = `o_${randomUUID()}`;
    const evidenceId = `v_${randomUUID()}`;
    const targets = new Map<string, ObservedAction>();
    const view = new Map<string, TargetEvidence>();
    const data: ObservationView = {
      session: sessionId,
      observation: id,
      evidence: evidenceId,
      scope,
      page: { url: capture.snapshot.url, title: capture.snapshot.title },
      state: capture.state,
      omitted_actions: capture.snapshot.omitted_actions,
      targets: capture.snapshot.actions.map((action) => {
        const ref = `${id}:${action.id}`;
        const evidence = targetEvidence(
          action,
          scope,
          capture.contexts[String(action.node)],
          capture.relations[String(action.node)],
        );
        targets.set(ref, action);
        view.set(ref, evidence);
        return {
          ref,
          operation: action.kind,
          ...(action.kind === "select"
            ? { option_value: action.value, option_label: action.option_label }
            : {}),
          ...evidence,
        };
      }),
    };
    session.observed = {
      id,
      snapshot: capture.snapshot,
      targets,
      views: new Map([[evidenceId, view]]),
    };
    return data;
  }

  async context(
    sessionId: string,
    input: { observation: string; target: string; scope?: Representation },
  ): Promise<TargetContextView> {
    const scope = input.scope ?? "relations";
    const session = this.session(sessionId);
    const observed = this.observed(session, input.observation);
    const action = this.action(observed, input.target);
    await this.assertTarget(session, observed, action);
    const captured = await this.dependencies.read(session.page, action, scope);
    const evidence = targetEvidence(
      captured.current,
      scope,
      captured.contexts[String(action.node)],
      captured.relations[String(action.node)],
    );
    await this.assertTarget(session, observed, action);
    const id = `v_${randomUUID()}`;
    const data: TargetContextView = {
      session: sessionId,
      observation: observed.id,
      target: input.target,
      evidence: id,
      ...evidence,
    };
    observed.views.set(id, new Map([[input.target, evidence]]));
    return data;
  }

  async act(sessionId: string, input: ActInput): Promise<ActResult> {
    // A saved receipt stays authoritative after the session or process is gone.
    const previous = await readReceipt(
      this.options.directory,
      sessionId,
      input.request_id,
    );
    if (previous) return this.replay(input, previous);
    const session = this.session(sessionId);

    let receipt: Receipt = {
      session: sessionId,
      request_id: input.request_id,
      request_hash: digest(hashInput(input)),
      observation: input.observation,
      target: input.target,
      evidence: input.evidence,
      operation: input.operation,
      outcome: "not_executed",
      stage: "validation",
      recorded_at: new Date().toISOString(),
      code: "INVALID_ACTION",
      message: "Action did not pass validation.",
    };
    let dispatchStarted = false;
    try {
      const observed = this.observed(session, input.observation);
      const action = this.action(observed, input.target);
      const expected = observed.views.get(input.evidence)?.get(input.target);
      if (!expected)
        throw new BrowserToolError(
          "EVIDENCE_NOT_OFFERED",
          "Evidence does not describe this target in this observation.",
        );
      if (action.kind !== input.operation)
        throw new BrowserToolError(
          "OPERATION_NOT_OFFERED",
          "Operation does not match the offered target operation.",
        );
      if (action.kind === "select" && expected.state.truncated)
        throw new BrowserToolError(
          "EVIDENCE_TRUNCATED",
          "The selected control state is incomplete. Input cannot be validated.",
        );
      if (action.kind === "fill" && input.value === undefined)
        throw new BrowserToolError(
          "VALUE_REQUIRED",
          "fill requires a value, including an explicit empty string.",
        );
      if (action.kind !== "fill" && input.value !== undefined)
        throw new BrowserToolError(
          "UNEXPECTED_VALUE",
          "Only fill accepts a value. Select the offered option ref for select.",
        );
      await this.assertTarget(session, observed, action);
      const current = await this.dependencies.read(
        session.page,
        action,
        expected.scope,
      );
      const evidence = targetEvidence(
        current.current,
        expected.scope,
        current.contexts[String(action.node)],
        current.relations[String(action.node)],
      );
      if (digest(evidence) !== digest(expected))
        throw new BrowserToolError(
          "EVIDENCE_CHANGED",
          "Displayed state, context or relation fields changed. Observe again before choosing.",
        );
      await this.assertTarget(session, observed, action);
      receipt = {
        ...receipt,
        outcome: "unknown",
        stage: "execution",
        code: "OUTCOME_UNKNOWN",
        message: "Input is pending or its acknowledgement is unknown.",
      };
      // No input before the durable pending marker.
      await saveReceipt(this.options.directory, receipt);
      dispatchStarted = true;
      await session.page.act(action, observed.snapshot, input.value);
      receipt = {
        ...receipt,
        outcome: "executed",
        stage: "receipt",
        code: action.kind === "wait" ? "WAIT_COMPLETED" : "INPUT_ACKNOWLEDGED",
        message:
          action.kind === "wait"
            ? "Requested wait completed. Task success is not verified."
            : "Browser acknowledged the input sequence. Task success is not verified.",
      };
    } catch (error) {
      if (!dispatchStarted || error instanceof StalePageError) {
        receipt = {
          ...receipt,
          outcome: "not_executed",
          stage: "validation",
          code:
            error instanceof BrowserToolError
              ? error.code
              : error instanceof StalePageError
                ? "TARGET_CHANGED"
                : "PRECHECK_FAILED",
          message: error instanceof Error ? error.message : "Precheck failed.",
        };
      } else {
        receipt = {
          ...receipt,
          outcome: "unknown",
          code: "OUTCOME_UNKNOWN",
          message:
            "Input may have reached the browser. Inspect the page before making a new decision.",
        };
      }
    }
    if (
      dispatchStarted ||
      ["DOCUMENT_CHANGED", "TARGET_CHANGED", "EVIDENCE_CHANGED"].includes(receipt.code)
    )
      session.observed = undefined;
    try {
      await saveReceipt(this.options.directory, receipt);
    } catch {
      throw new BrowserToolError(
        "RECEIPT_WRITE_FAILED",
        dispatchStarted
          ? "Input may have reached the browser, but its receipt could not be saved."
          : "The receipt could not be saved; no input was dispatched.",
      );
    }
    let postObservation: ActResult["post_observation"];
    if (receipt.outcome !== "not_executed") {
      try {
        postObservation = {
          status: "captured",
          data: await this.observe(sessionId, "local"),
        };
      } catch (error) {
        session.observed = undefined;
        postObservation = { status: "failed", error: problem(error) };
      }
    }
    return {
      receipt,
      replayed: false,
      ...(postObservation === undefined ? {} : { post_observation: postObservation }),
    };
  }

  /** Durable receipt lookup; a missing receipt never proves an action was not requested. */
  async receipt(sessionId: string, requestId: string): Promise<Receipt | null> {
    return readReceipt(this.options.directory, sessionId, requestId);
  }

  async close(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session)
      throw new BrowserToolError(
        "SESSION_NOT_FOUND",
        "Browser session is closed. Open a new browser session.",
      );
    this.sessions.delete(sessionId);
    try {
      await session.page.close();
    } finally {
      await session.engine.close();
    }
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled(
      [...this.sessions.keys()].map((session) => this.close(session)),
    );
  }

  private session(sessionId: string): OpenSession {
    const session = this.sessions.get(sessionId);
    if (!session)
      throw new BrowserToolError(
        "SESSION_NOT_FOUND",
        "Browser session is closed. Open a new browser session.",
      );
    return session;
  }

  private observed(session: OpenSession, observation: string): Observed {
    if (!session.observed || session.observed.id !== observation)
      throw new BrowserToolError(
        "OBSERVATION_EXPIRED",
        "Use the latest observation. Executed or uncertain actions invalidate its references.",
      );
    return session.observed;
  }

  private action(observed: Observed, ref: string): ObservedAction {
    const action = observed.targets.get(ref);
    if (!action)
      throw new BrowserToolError(
        "TARGET_NOT_OFFERED",
        "Target is not offered by this observation. Copy a ref from observe.",
      );
    return action;
  }

  private async assertTarget(
    session: OpenSession,
    observed: Observed,
    action: ObservedAction,
  ): Promise<void> {
    if (!(await session.page.samePage(observed.snapshot)))
      throw new BrowserToolError(
        "DOCUMENT_CHANGED",
        "Document or URL changed. Observe again.",
      );
    if (!(await session.page.fresh(observed.snapshot, action)))
      throw new BrowserToolError(
        "TARGET_CHANGED",
        "Target identity, label or state changed. Observe again.",
      );
  }

  private replay(input: ActInput, receipt: Receipt): ActResult {
    if (receipt.request_hash !== digest(hashInput(input)))
      throw new BrowserToolError(
        "REQUEST_ID_CONFLICT",
        "This request-id belongs to a different action. Use a new request-id for a new decision.",
      );
    return { receipt, replayed: true };
  }
}

/** Hash only decision fields in a fixed order so replays compare stable values. */
function hashInput(input: ActInput): Record<string, unknown> {
  return {
    observation: input.observation,
    target: input.target,
    evidence: input.evidence,
    operation: input.operation,
    value: input.value ?? null,
    request_id: input.request_id,
  };
}

function problem(error: unknown): { code: string; message: string } {
  if (error instanceof BrowserToolError)
    return { code: error.code, message: error.message };
  return {
    code: "OBSERVATION_FAILED",
    message: error instanceof Error ? error.message : "Post-action observation failed.",
  };
}
