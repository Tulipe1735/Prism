import type { BrowserConnection } from "../browser/connect.ts";
import type { TargetEvidence } from "../browser/evidence.ts";
import type { BrowserSession, Observation } from "../browser/session.ts";
import type { SnapshotAction } from "../shared/types.ts";
import type { ActCommand, Command, Receipt, Reply } from "./protocol.ts";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { connectBrowser, parseBrowserUrl } from "../browser/connect.ts";
import {
  captureEvidence,
  digest,
  readTargetEvidence,
  targetEvidence,
} from "../browser/evidence.ts";
import { openBrowserSession, StalePageError } from "../browser/session.ts";
import { ContractError, failure, success } from "./protocol.ts";
import { readReceipt, saveReceipt } from "./receipts.ts";

interface Observed {
  id: string;
  snapshot: Observation;
  targets: Map<string, SnapshotAction>;
  views: Map<string, Map<string, TargetEvidence>>;
}
interface Session {
  connection: BrowserConnection;
  browser: BrowserSession;
  observed?: Observed;
  queue: Promise<void>;
  closed: boolean;
}
export interface SessionDependencies {
  connect: typeof connectBrowser;
  open: typeof openBrowserSession;
  capture: typeof captureEvidence;
  read: typeof readTargetEvidence;
}
const defaults: SessionDependencies = {
  connect: connectBrowser,
  open: openBrowserSession,
  capture: captureEvidence,
  read: readTargetEvidence,
};

/** Owns tabs and observations, not an agent policy. Operations serialize within a session. */
export class Sessions {
  private readonly sessions = new Map<string, Session>();
  readonly directory: string;
  private readonly dependencies: SessionDependencies;
  constructor(directory: string, dependencies: SessionDependencies = defaults) {
    this.directory = directory;
    this.dependencies = dependencies;
  }

  async handle(command: Command): Promise<Reply> {
    try {
      if (command.command === "ping")
        return success({ service: "prism-browser-cli", sessions: this.sessions.size });
      if (command.command === "shutdown") {
        await this.closeAll();
        return success({ status: "stopped" });
      }
      if (command.command === "open") return await this.open(command);
      if (command.command === "receipt") {
        const receipt = await readReceipt(
          this.directory,
          command.session,
          command.request_id,
        );
        if (!receipt)
          throw new ContractError(
            "RECEIPT_NOT_FOUND",
            "No durable receipt exists. This does not prove the action was never requested.",
          );
        return success({ receipt });
      }
      // A saved receipt remains queryable after its session or broker has closed.
      if (command.command === "act" && !this.sessions.has(command.session)) {
        const previous = await readReceipt(
          this.directory,
          command.session,
          command.request_id,
        );
        if (previous) return this.replay(command, previous);
      }
      return await this.serialized(command.session, async (session) => {
        switch (command.command) {
          case "close":
            session.closed = true;
            try {
              await session.browser.close();
            } finally {
              await session.connection.close();
              this.sessions.delete(command.session);
            }
            return success({ session: command.session, status: "closed" });
          case "observe":
            return await this.observe(command, session);
          case "context":
            return await this.context(command, session);
          case "act":
            return await this.act(command, session);
        }
      });
    } catch (error) {
      return failure(error);
    }
  }

  async closeAll(): Promise<void> {
    const entries = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(
      entries.map(async (session) => {
        session.closed = true;
        try {
          await session.browser.close();
        } finally {
          await session.connection.close();
        }
      }),
    );
  }

  private async open(command: Extract<Command, { command: "open" }>): Promise<Reply> {
    const connection = await this.dependencies.connect(
      parseBrowserUrl(command.browser_url),
    );
    let browser: BrowserSession;
    try {
      browser = await this.dependencies.open({
        client: connection.client,
        url: command.url,
      });
    } catch (error) {
      await connection.close();
      throw error;
    }
    const id = `s_${randomUUID()}`;
    const session: Session = {
      connection,
      browser,
      closed: false,
      queue: Promise.resolve(),
    };
    this.sessions.set(id, session);
    try {
      await this.event(id, {
        type: "opened",
        url: command.url,
        browser_url: command.browser_url,
      });
    } catch (error) {
      this.sessions.delete(id);
      await browser.close();
      await connection.close();
      throw error;
    }
    return success({
      session: id,
      url: command.url,
      event_log: join(this.directory, "events", `${id}.jsonl`),
    });
  }

  private async serialized(
    id: string,
    run: (session: Session) => Promise<Reply>,
  ): Promise<Reply> {
    const session = this.sessions.get(id);
    if (!session)
      throw new ContractError(
        "SESSION_NOT_FOUND",
        "Session is closed or belongs to another broker. Open a new session.",
        "prism session open --url <url>",
      );
    const result = session.queue.then(() => {
      if (session.closed)
        throw new ContractError("SESSION_CLOSED", "The session has closed.");
      return run(session);
    });
    session.queue = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  private async observe(
    command: Extract<Command, { command: "observe" }>,
    session: Session,
  ): Promise<Reply> {
    const capture = await this.dependencies.capture(session.browser);
    const id = `o_${randomUUID()}`;
    const evidenceId = `v_${randomUUID()}`;
    const targets = new Map<string, SnapshotAction>();
    const view = new Map<string, TargetEvidence>();
    const data = {
      session: command.session,
      observation: id,
      evidence: evidenceId,
      scope: command.scope,
      page: {
        url: capture.snapshot.url,
        title: capture.snapshot.title,
        status: capture.status,
      },
      omitted_actions: capture.snapshot.omitted_actions,
      targets: capture.snapshot.actions.map((action) => {
        const ref = `${id}:${action.id}`;
        const evidence = targetEvidence(
          action,
          command.scope,
          capture.contexts[String(action.node)],
          capture.relations[String(action.node)],
        );
        targets.set(ref, action);
        view.set(ref, evidence);
        return {
          ref,
          operation: action.kind,
          label: action.label,
          ...(action.role ? { role: action.role } : {}),
          ...(action.kind === "select" ? { option_value: action.value } : {}),
          ...evidence,
        };
      }),
    };
    await this.event(command.session, { type: "observed", data });
    session.observed = {
      id,
      snapshot: capture.snapshot,
      targets,
      views: new Map([[evidenceId, view]]),
    };
    return success(data);
  }

  private observed(session: Session, observation: string): Observed {
    if (!session.observed || session.observed.id !== observation)
      throw new ContractError(
        "OBSERVATION_EXPIRED",
        "Use the latest observation. Executed or uncertain actions invalidate its references.",
      );
    return session.observed;
  }
  private action(observed: Observed, ref: string): SnapshotAction {
    const action = observed.targets.get(ref);
    if (!action)
      throw new ContractError(
        "TARGET_NOT_OFFERED",
        "Target is not offered by this observation. Copy a ref from observe.",
      );
    return action;
  }
  private async assertTarget(
    session: Session,
    observed: Observed,
    action: SnapshotAction,
  ): Promise<void> {
    if (!(await session.browser.samePage(observed.snapshot)))
      throw new ContractError(
        "DOCUMENT_CHANGED",
        "Document or URL changed. Observe again.",
      );
    if (!(await session.browser.fresh(observed.snapshot, action)))
      throw new ContractError(
        "TARGET_CHANGED",
        "Target identity, label or state changed. Observe again.",
      );
  }

  private async context(
    command: Extract<Command, { command: "context" }>,
    session: Session,
  ): Promise<Reply> {
    const observed = this.observed(session, command.observation);
    const action = this.action(observed, command.target);
    if (observed.views.size >= 32)
      throw new ContractError(
        "CONTEXT_BUDGET",
        "Observe again to start a new context budget.",
      );
    await this.assertTarget(session, observed, action);
    const captured = await this.dependencies.read(session.browser, action);
    const evidence = targetEvidence(
      action,
      command.scope,
      captured.contexts[String(action.node)],
      captured.relations[String(action.node)],
    );
    await this.assertTarget(session, observed, action);
    const id = `v_${randomUUID()}`;
    const data = {
      session: command.session,
      observation: observed.id,
      target: command.target,
      evidence: id,
      ...evidence,
    };
    await this.event(command.session, { type: "context", data });
    observed.views.set(id, new Map([[command.target, evidence]]));
    return success(data);
  }

  private replay(command: ActCommand, receipt: Receipt): Reply {
    if (receipt.request_hash !== digest(command))
      throw new ContractError(
        "REQUEST_ID_CONFLICT",
        "This request-id belongs to a different action. Use a new request-id for a new decision.",
      );
    return this.receiptReply(receipt, true);
  }
  private receiptReply(receipt: Receipt, replayed: boolean): Reply {
    const data = { receipt, replayed };
    return receipt.outcome === "executed"
      ? success(data)
      : failure(
          new ContractError(receipt.code, receipt.message, receipt.next_command),
          data,
        );
  }

  private async act(command: ActCommand, session: Session): Promise<Reply> {
    const previous = await readReceipt(
      this.directory,
      command.session,
      command.request_id,
    );
    if (previous) return this.replay(command, previous);
    let receipt: Receipt = {
      session: command.session,
      request_id: command.request_id,
      request_hash: digest(command),
      observation: command.observation,
      target: command.target,
      evidence: command.evidence,
      operation: command.operation,
      outcome: "not_executed",
      stage: "validation",
      recorded_at: new Date().toISOString(),
      code: "INVALID_ACTION",
      message: "Action did not pass validation.",
      next_command: `prism observe --session ${command.session}`,
    };
    let dispatchStarted = false;
    try {
      const observed = this.observed(session, command.observation);
      const action = this.action(observed, command.target);
      const expected = observed.views.get(command.evidence)?.get(command.target);
      if (!expected)
        throw new ContractError(
          "EVIDENCE_NOT_OFFERED",
          "Evidence does not describe this target in this observation.",
        );
      if (action.kind !== command.operation)
        throw new ContractError(
          "OPERATION_NOT_OFFERED",
          "Operation does not match the offered target operation.",
        );
      if (action.kind === "fill" && command.value === undefined)
        throw new ContractError(
          "VALUE_REQUIRED",
          "fill requires --value or a stdin value, including an explicit empty string.",
        );
      if (action.kind !== "fill" && command.value !== undefined)
        throw new ContractError(
          "UNEXPECTED_VALUE",
          "Only fill accepts value. Select the offered option ref for select.",
        );
      await this.assertTarget(session, observed, action);
      const current = await this.dependencies.read(session.browser, action);
      const evidence = targetEvidence(
        action,
        expected.scope,
        current.contexts[String(action.node)],
        current.relations[String(action.node)],
      );
      if (digest(evidence) !== digest(expected))
        throw new ContractError(
          "EVIDENCE_CHANGED",
          "Displayed context or relation fields changed. Observe again before choosing.",
        );
      await this.assertTarget(session, observed, action);
      receipt = {
        ...receipt,
        outcome: "unknown",
        stage: "execution",
        code: "OUTCOME_UNKNOWN",
        message: "Input is pending or its acknowledgement is unknown.",
        next_command: `prism receipt --session ${command.session} --request-id ${command.request_id}`,
      };
      await saveReceipt(this.directory, receipt); // No input before the durable pending marker.
      dispatchStarted = true;
      await session.browser.act(action, observed.snapshot, command.value);
      receipt = {
        ...receipt,
        outcome: "executed",
        stage: "receipt",
        code: action.kind === "wait" ? "WAIT_COMPLETED" : "INPUT_ACKNOWLEDGED",
        message:
          action.kind === "wait"
            ? "Requested wait completed. Task success is not verified."
            : "Browser acknowledged the input sequence. Task success is not verified.",
        next_command: `prism observe --session ${command.session}`,
      };
    } catch (error) {
      if (!dispatchStarted || error instanceof StalePageError) {
        receipt = {
          ...receipt,
          outcome: "not_executed",
          stage: "validation",
          code:
            error instanceof ContractError
              ? error.code
              : error instanceof StalePageError
                ? "TARGET_CHANGED"
                : "PRECHECK_FAILED",
          message: error instanceof Error ? error.message : "Precheck failed.",
          next_command: `prism observe --session ${command.session}`,
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
      await saveReceipt(this.directory, receipt);
    } catch {
      return failure(
        new ContractError(
          "RECEIPT_WRITE_FAILED",
          "Could not save the final receipt. Do not replay an uncertain action.",
        ),
        {
          receipt: {
            ...receipt,
            outcome: dispatchStarted ? "unknown" : "not_executed",
          },
          replayed: false,
        },
      );
    }
    await this.event(command.session, { type: "action", receipt }).catch((error) =>
      console.error(`Prism event log: ${String(error)}`),
    );
    return this.receiptReply(receipt, false);
  }

  private async event(session: string, data: unknown): Promise<void> {
    const directory = join(this.directory, "events");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await appendFile(
      join(directory, `${session}.jsonl`),
      `${JSON.stringify({ schema_version: 1, at: new Date().toISOString(), ...(data as object) })}\n`,
      { mode: 0o600 },
    );
  }
}
