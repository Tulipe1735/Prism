import {
  BROWSER_ACTION_RECORD_SCHEMA_VERSION,
  type BrowserActionProposal,
  type BrowserActionRecord,
  browserActionProposalSchema,
  browserActionRecordSchema,
  type BrowserObservationReference,
  type BrowserTarget,
} from "@prism/contracts";

export { BrowserExecutor, type BrowserBaselineCapture, type BrowserExecutorOptions } from "./browser-executor";

export interface BrowserPort {
  observe(): Promise<BrowserObservationReference>;
  click(target: BrowserTarget): Promise<void>;
}

export interface ActionBrokerOptions {
  port: BrowserPort;
  clock?: () => Date;
}

function coordinateTargetIsFresh(
  proposal: BrowserActionProposal,
  observation: BrowserObservationReference,
): boolean {
  if (proposal.target.kind !== "coordinate") return true;

  const target = proposal.target;
  return (
    target.observationId === observation.observationId &&
    target.screenshotHash === observation.screenshotHash &&
    target.pageStateHash === observation.pageStateHash &&
    target.viewport.width === observation.viewport.width &&
    target.viewport.height === observation.viewport.height &&
    target.viewport.deviceScaleFactor === observation.viewport.deviceScaleFactor
  );
}

export class ActionBroker {
  private readonly clock: () => Date;

  constructor(private readonly options: ActionBrokerOptions) {
    this.clock = options.clock ?? (() => new Date());
  }

  async execute(input: unknown): Promise<BrowserActionRecord> {
    const proposal = browserActionProposalSchema.parse(input);
    const before = await this.options.port.observe();

    if (!coordinateTargetIsFresh(proposal, before)) {
      return browserActionRecordSchema.parse({
        schemaVersion: BROWSER_ACTION_RECORD_SCHEMA_VERSION,
        proposal,
        policy: {
          decision: "stale",
          reason: "The coordinate target no longer matches its grounded observation.",
        },
        execution: {
          status: "stale",
          message: "Prism did not send browser input for a stale coordinate target.",
        },
        before,
        after: null,
        recordedAt: this.clock().toISOString(),
      });
    }

    try {
      await this.options.port.click(proposal.target);
      const after = await this.options.port.observe();
      return browserActionRecordSchema.parse({
        schemaVersion: BROWSER_ACTION_RECORD_SCHEMA_VERSION,
        proposal,
        policy: {
          decision: "allowed",
          reason: "The typed proposal passed the broker freshness policy.",
        },
        execution: { status: "executed", message: "Browser input completed." },
        before,
        after,
        recordedAt: this.clock().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Browser input failed.";
      return browserActionRecordSchema.parse({
        schemaVersion: BROWSER_ACTION_RECORD_SCHEMA_VERSION,
        proposal,
        policy: {
          decision: "allowed",
          reason: "The typed proposal passed the broker freshness policy.",
        },
        execution: { status: "failed", message },
        before,
        after: null,
        recordedAt: this.clock().toISOString(),
      });
    }
  }
}
