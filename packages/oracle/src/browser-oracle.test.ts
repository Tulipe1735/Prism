import type { FrontendRepairSpec } from "@prism/contracts";

import type { Browser, BrowserContext, BrowserType, Page } from "playwright-core";
import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import { BrowserOracle, type RenderedTargetObservation } from "./browser-oracle";

const viewport = { width: 1280, height: 720, deviceScaleFactor: 1 } as const;

const target = { kind: "semantic", role: "button", name: "Save", exact: true } as const;

const spec: FrontendRepairSpec = {
  schemaVersion: "prism.frontend-repair-spec/v1",
  prompt: "Make the primary Save button clearly rounded instead of square.",
  target,
  predicates: [
    { kind: "metric-increase", metric: "borderRadius", minDeltaPx: 8, minAfterPx: 8 },
    { kind: "region-clip-differs" },
    { kind: "label-preserved" },
    { kind: "clickable" },
    { kind: "size-within", tolerancePx: 4 },
    { kind: "layout-within", tolerancePx: 4 },
  ],
};

function observation(
  overrides: Partial<RenderedTargetObservation> = {},
): RenderedTargetObservation {
  return {
    observationId: "c9e5d8f4-6a1b-4e2c-9d3f-8a0b1c2d3e4f",
    url: "http://127.0.0.1:4173/round-button",
    viewport,
    target,
    borderRadiusPx: 0,
    boxShadow: "none",
    widthPx: 96,
    heightPx: 44,
    xPx: 100,
    yPx: 200,
    surroundings: {
      parent: { x: 0, y: 0, width: 1280, height: 720 },
      siblings: [],
    },
    text: "Save",
    enabled: true,
    visible: true,
    pointerEvents: "auto",
    regionClipHash: "a".repeat(64),
    screenshotHash: "b".repeat(64),
    ...overrides,
  };
}

/** 已知缺陷态：方形按钮（radius 0）。 */
const knownBad = observation();
/** 合理修复态：明显圆角（radius 12px）。 */
const repaired = observation({ borderRadiusPx: 12, regionClipHash: "c".repeat(64) });

describe("BrowserOracle.evaluateSpec", () => {
  it("fails on the known-bad state (before equals after)", () => {
    const evaluation = BrowserOracle.evaluateSpec(spec, knownBad, knownBad);

    expect(evaluation.verdict).toBe("failed");
    const radiusAssertion = evaluation.assertions.find(
      (assertion) => assertion.predicate.kind === "metric-increase",
    );
    expect(radiusAssertion?.status).toBe("failed");
  });

  it("passes on a reasonable repair that rounds the button", () => {
    const evaluation = BrowserOracle.evaluateSpec(spec, knownBad, repaired);

    expect(evaluation.verdict).toBe("passed");
    expect(evaluation.assertions.every((a) => a.status === "passed")).toBe(true);
  });

  it("fails when the label is changed by the repair", () => {
    const evaluation = BrowserOracle.evaluateSpec(
      spec,
      knownBad,
      observation({ borderRadiusPx: 12, text: "Save now" }),
    );

    expect(evaluation.verdict).toBe("failed");
    const labelAssertion = evaluation.assertions.find(
      (assertion) => assertion.predicate.kind === "label-preserved",
    );
    expect(labelAssertion?.status).toBe("failed");
  });

  it("fails when the repair makes the control unclickable", () => {
    const evaluation = BrowserOracle.evaluateSpec(
      spec,
      knownBad,
      observation({ borderRadiusPx: 12, enabled: false }),
    );

    expect(evaluation.verdict).toBe("failed");
    const clickableAssertion = evaluation.assertions.find(
      (assertion) => assertion.predicate.kind === "clickable",
    );
    expect(clickableAssertion?.status).toBe("failed");
  });

  it("fails when the control size shifts beyond tolerance", () => {
    const evaluation = BrowserOracle.evaluateSpec(
      spec,
      knownBad,
      observation({ borderRadiusPx: 12, widthPx: 120 }),
    );

    expect(evaluation.verdict).toBe("failed");
    const sizeAssertion = evaluation.assertions.find(
      (assertion) => assertion.predicate.kind === "size-within",
    );
    expect(sizeAssertion?.status).toBe("failed");
  });

  it("fails when the declared layout invariant is broken", () => {
    const evaluation = BrowserOracle.evaluateSpec(
      spec,
      knownBad,
      observation({ borderRadiusPx: 12, xPx: 260 }),
    );

    expect(evaluation.verdict).toBe("failed");
    const layoutAssertion = evaluation.assertions.find(
      (assertion) => assertion.predicate.kind === "layout-within",
    );
    expect(layoutAssertion?.status).toBe("failed");
  });
});

describe("BrowserOracle.observe", () => {
  it("observes the rendered target and captures a localized region clip", async () => {
    const locator = {
      evaluate: async () => ({
        borderRadius: "12px",
        boxShadow: "none",
        rectangle: { x: 100, y: 200, width: 96, height: 44 },
        surroundings: {
          parent: { x: 0, y: 0, width: 1280, height: 720 },
          siblings: [],
        },
        text: "Save",
        disabled: false,
        visible: true,
        pointerEvents: "auto",
      }),
      screenshot: async () => Buffer.from("region-clip", "utf8"),
      waitFor: async () => undefined,
    };
    const page = {
      getByRole: () => locator,
      goto: async () => null,
      on: () => page,
      screenshot: async () => Buffer.from("page", "utf8"),
      url: () => "http://127.0.0.1:4173/round-button",
    } as unknown as Page;
    const context = {
      close: async () => undefined,
      newPage: async () => page,
      route: async () => undefined,
    } as unknown as BrowserContext;
    const browser = {
      close: async () => undefined,
      newContext: async () => context,
    } as unknown as Browser;
    const browserType = {
      launch: async () => browser,
    } as Pick<BrowserType<Browser>, "launch">;

    const oracle = new BrowserOracle({
      baseUrl: "http://127.0.0.1:4173",
      route: "/round-button",
      viewport,
      target,
      browserType,
    });

    const observed = await oracle.observe();

    expect(observed.borderRadiusPx).toBe(12);
    expect(observed.widthPx).toBe(96);
    expect(observed.xPx).toBe(100);
    expect(observed.text).toBe("Save");
    expect(observed.enabled).toBe(true);
    expect(observed.regionClipHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a non-local base URL at construction", () => {
    expect(
      () =>
        new BrowserOracle({
          baseUrl: "https://example.com",
          route: "/round-button",
          viewport,
          target,
          browserType: { launch: async () => ({}) as Browser },
        }),
    ).toThrow(TypeError);
  });
});
