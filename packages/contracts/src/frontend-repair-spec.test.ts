import { describe, expect, it } from "vitest";

import { formatContractIssues, frontendRepairSpecSchema } from "./index";

const validSpec = {
  schemaVersion: "prism.frontend-repair-spec/v1",
  prompt: "Make the primary Save button clearly rounded instead of square.",
  target: { kind: "semantic", role: "button", name: "Save", exact: true },
  predicates: [
    { kind: "metric-increase", metric: "borderRadius", minDeltaPx: 8, minAfterPx: 8 },
    { kind: "region-clip-differs" },
    { kind: "label-preserved" },
    { kind: "clickable" },
    { kind: "size-within", tolerancePx: 4 },
    { kind: "layout-within", tolerancePx: 4 },
  ],
} as const;

describe("frontendRepairSpecSchema", () => {
  it("accepts the normalized spec while preserving the original prompt", () => {
    const parsed = frontendRepairSpecSchema.parse(validSpec);

    expect(parsed.prompt).toBe(validSpec.prompt);
    expect(parsed.schemaVersion).toBe("prism.frontend-repair-spec/v1");
    expect(parsed.target).toEqual({
      kind: "semantic",
      role: "button",
      name: "Save",
      exact: true,
    });
  });

  it("expresses a material corner-radius increase without an exact CSS value", () => {
    const parsed = frontendRepairSpecSchema.parse(validSpec);

    const increase = parsed.predicates.find(
      (predicate) => predicate.kind === "metric-increase",
    );
    expect(increase).toMatchObject({
      kind: "metric-increase",
      metric: "borderRadius",
      minDeltaPx: 8,
      minAfterPx: 8,
    });
    expect(validSpec.prompt).not.toMatch(/\d+px|\d+rem|border-radius\s*:/);
  });

  it.each([
    [
      "unsupported schema version",
      { ...validSpec, schemaVersion: "prism.frontend-repair-spec/v2" },
      "schemaVersion",
    ],
    [
      "coordinate target",
      {
        ...validSpec,
        target: {
          kind: "coordinate",
          x: 10,
          y: 20,
          observationId: "b0c1d2e3-f4a5-4b6c-8d7e-9f0a1b2c3d4e",
          screenshotHash:
            "1111111111111111111111111111111111111111111111111111111111111111",
          pageStateHash:
            "2222222222222222222222222222222222222222222222222222222222222222",
          viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
        },
      },
      "target",
    ],
    ["no predicates", { ...validSpec, predicates: [] }, "predicates"],
    [
      "metric increase without material thresholds",
      {
        ...validSpec,
        predicates: [
          {
            kind: "metric-increase",
            metric: "borderRadius",
            minDeltaPx: 0,
            minAfterPx: 8,
          },
        ],
      },
      "predicates.0.minDeltaPx",
    ],
  ])("rejects %s with a useful field path", (_name, input, expectedPath) => {
    const result = frontendRepairSpecSchema.safeParse(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(formatContractIssues(result.error)).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: expectedPath })]),
      );
    }
  });
});
