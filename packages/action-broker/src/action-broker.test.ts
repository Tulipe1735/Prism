import type { BrowserObservationReference } from "@prism/contracts";
import { describe, expect, it } from "vitest";

import { ActionBroker, type BrowserPort } from "./index";

const viewport = { width: 1280, height: 720, deviceScaleFactor: 1 } as const;
const before: BrowserObservationReference = {
  observationId: "d5d02fbb-a7ec-4cad-85d7-0b6b3ac6c10b",
  url: "http://127.0.0.1:4173/settings/profile",
  viewport,
  pageStateHash: "a".repeat(64),
  screenshotHash: "b".repeat(64),
};

class TestBrowserPort implements BrowserPort {
  clicked = false;

  constructor(private readonly observations: BrowserObservationReference[]) {}

  async observe(): Promise<BrowserObservationReference> {
    return this.observations.shift() ?? before;
  }

  async click(): Promise<void> {
    this.clicked = true;
  }
}

describe("ActionBroker", () => {
  it("executes a semantic click only after recording matching observations", async () => {
    const after = { ...before, observationId: "6b3d5ed9-03ba-49e8-a15e-57ac91ef8ef8" };
    const port = new TestBrowserPort([before, after]);
    const broker = new ActionBroker({
      port,
      clock: () => new Date("2026-08-04T04:00:00.000Z"),
    });

    await expect(
      broker.execute({
        schemaVersion: "prism.browser-action-proposal/v1",
        proposalId: "f374f1ae-8ce2-432f-af52-c8973588bb0a",
        runId: "run_6dbf6f33-69c4-4e5f-9898-3f693735f5f0",
        origin: "browser-model",
        action: { kind: "click" },
        target: { kind: "semantic", role: "button", name: "Save", exact: true },
      }),
    ).resolves.toMatchObject({
      policy: { decision: "allowed" },
      execution: { status: "executed" },
      before,
      after,
    });
    expect(port.clicked).toBe(true);
  });

  it("fails a coordinate proposal closed after page state drift without clicking", async () => {
    const port = new TestBrowserPort([
      {
        ...before,
        pageStateHash: "c".repeat(64),
        observationId: "6b3d5ed9-03ba-49e8-a15e-57ac91ef8ef8",
      },
    ]);
    const broker = new ActionBroker({
      port,
      clock: () => new Date("2026-08-04T04:00:00.000Z"),
    });

    await expect(
      broker.execute({
        schemaVersion: "prism.browser-action-proposal/v1",
        proposalId: "f374f1ae-8ce2-432f-af52-c8973588bb0a",
        runId: "run_6dbf6f33-69c4-4e5f-9898-3f693735f5f0",
        origin: "browser-model",
        action: { kind: "click" },
        target: {
          kind: "coordinate",
          x: 240,
          y: 160,
          observationId: before.observationId,
          screenshotHash: before.screenshotHash,
          pageStateHash: before.pageStateHash,
          viewport,
        },
      }),
    ).resolves.toMatchObject({
      policy: { decision: "stale" },
      execution: { status: "stale" },
      after: null,
    });
    expect(port.clicked).toBe(false);
  });
});
