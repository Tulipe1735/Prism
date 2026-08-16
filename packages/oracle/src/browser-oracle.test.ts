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

  it("passes only when valid keyboard input enables the form target", () => {
    const formSpec: FrontendRepairSpec = {
      schemaVersion: "prism.frontend-repair-spec/v1",
      prompt: "Submit remains disabled after I enter a valid email.",
      target: { ...target, name: "Submit" },
      predicates: [
        {
          kind: "form-enablement",
          inputName: "Email",
          invalidValue: "not-an-email",
          validValue: "ada@example.test",
        },
      ],
    };
    const state = (value: string, inputValid: boolean, enabled: boolean) => ({
      value,
      inputValid,
      enabled,
      accessibilityDisabled: !enabled,
    });
    const before = observation({
      target: formSpec.target,
      form: {
        inputName: "Email",
        empty: state("", false, false),
        invalid: state("not-an-email", false, false),
        valid: state("ada@example.test", true, false),
        keyboardFocusReachedTarget: true,
        consoleErrors: [],
      },
    });
    const after = observation({
      target: formSpec.target,
      enabled: true,
      form: {
        ...before.form!,
        valid: state("ada@example.test", true, true),
      },
    });

    expect(BrowserOracle.evaluateSpec(formSpec, before, after).verdict).toBe("passed");
    expect(BrowserOracle.evaluateSpec(formSpec, before, before).verdict).toBe("failed");
  });

  it("passes when mobile overflow is removed without moving the desktop target", () => {
    const responsiveSpec: FrontendRepairSpec = {
      schemaVersion: "prism.frontend-repair-spec/v1",
      prompt: "Checkout actions overflow off-screen on mobile.",
      target: {
        kind: "semantic",
        role: "region",
        name: "Checkout actions",
        exact: true,
      },
      predicates: [
        {
          kind: "responsive-layout",
          desktopViewport: viewport,
          tolerancePx: 2,
        },
      ],
    };
    const healthyLayout = {
      documentWidthPx: 390,
      horizontalOverflowPx: 0,
      targetInsideViewport: true,
      targetClipped: false,
      actionRectangles: [
        { x: 57, y: 220, width: 157, height: 44 },
        { x: 226, y: 220, width: 157, height: 44 },
      ],
      actionsInsideViewport: true,
      actionsOverlap: false,
    };
    const desktop = {
      viewport,
      target: { x: 57, y: 220, width: 440, height: 44 },
      layout: { ...healthyLayout, documentWidthPx: 1280 },
    };
    const before = observation({
      viewport: { width: 390, height: 844, deviceScaleFactor: 1 },
      target: responsiveSpec.target,
      layout: {
        ...healthyLayout,
        documentWidthPx: 497,
        horizontalOverflowPx: 107,
        targetInsideViewport: false,
        targetClipped: true,
        actionsInsideViewport: false,
      },
      desktop,
    });
    const after = observation({
      viewport: before.viewport,
      target: responsiveSpec.target,
      layout: healthyLayout,
      desktop,
    });

    expect(BrowserOracle.evaluateSpec(responsiveSpec, before, after).verdict).toBe(
      "passed",
    );
    expect(BrowserOracle.evaluateSpec(responsiveSpec, before, before).verdict).toBe(
      "failed",
    );
  });

  it("passes only when the menu item becomes the pointer hit target", () => {
    const menuTarget = {
      kind: "semantic" as const,
      role: "menuitem",
      name: "Profile",
      exact: true,
    };
    const menuSpec: FrontendRepairSpec = {
      schemaVersion: "prism.frontend-repair-spec/v1",
      prompt: "The account menu opens behind the header and cannot be clicked.",
      target: menuTarget,
      predicates: [
        {
          kind: "menu-behavior",
          triggerName: "Account menu",
          successText: "Profile selected",
        },
      ],
    };
    const menu = {
      triggerName: "Account menu",
      trigger: { x: 1120, y: 26, width: 136, height: 44 },
      menu: { x: 1036, y: 56, width: 220, height: 106 },
      item: { x: 1044, y: 64, width: 204, height: 44 },
      hitPoint: { x: 1146, y: 86 },
      clipped: false,
      unoccluded: false,
      menuZIndex: "1",
      hitTargetName: "Prism account Account menu",
      clickReceived: false,
      successText: "Profile selected",
      consoleErrors: [],
    };
    const before = observation({ target: menuTarget, text: "Profile", menu });
    const after = observation({
      target: menuTarget,
      text: "Profile",
      menu: {
        ...menu,
        unoccluded: true,
        menuZIndex: "3",
        hitTargetName: "Profile",
        clickReceived: true,
      },
    });

    expect(BrowserOracle.evaluateSpec(menuSpec, before, after).verdict).toBe("passed");
    expect(BrowserOracle.evaluateSpec(menuSpec, before, before).verdict).toBe("failed");
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
