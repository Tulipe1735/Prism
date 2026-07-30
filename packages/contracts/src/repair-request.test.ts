import { describe, expect, it } from "vitest";

import {
  contractErrorSchema,
  formatContractIssues,
  repairRequestSchema,
  repairRequestValidationSchema,
} from "./index";

const validRequest = {
  schemaVersion: "prism.repair-request/v1",
  prompt: "  Make the primary Save button clearly rounded instead of square.  ",
  workspace: {
    kind: "local",
    path: "C:\\workspaces\\react-repair",
    displayName: "react-repair",
  },
  viewport: {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
  },
} as const;

describe("repairRequestSchema", () => {
  it("accepts the versioned request while preserving the original prompt", () => {
    const parsed = repairRequestSchema.parse(validRequest);

    expect(parsed.prompt).toBe(validRequest.prompt);
    expect(parsed.schemaVersion).toBe("prism.repair-request/v1");
  });

  it.each([
    [
      "unsupported schema version",
      { ...validRequest, schemaVersion: "prism.repair-request/v2" },
      "schemaVersion",
    ],
    [
      "unsupported workspace kind",
      {
        ...validRequest,
        workspace: { ...validRequest.workspace, kind: "remote" },
      },
      "workspace.kind",
    ],
    [
      "relative workspace path",
      {
        ...validRequest,
        workspace: { ...validRequest.workspace, path: "../react-repair" },
      },
      "workspace.path",
    ],
    ["empty natural-language prompt", { ...validRequest, prompt: "     " }, "prompt"],
  ])("rejects %s with a useful field path", (_name, input, expectedPath) => {
    const result = repairRequestSchema.safeParse(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(formatContractIssues(result.error)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: expectedPath,
            message: expect.any(String),
          }),
        ]),
      );
    }
  });
});

describe("repair request boundary responses", () => {
  it("accepts a versioned validation receipt", () => {
    expect(
      repairRequestValidationSchema.parse({
        schemaVersion: "prism.repair-request-validation/v1",
        status: "accepted",
        request: validRequest,
      }),
    ).toMatchObject({ status: "accepted" });
  });

  it("accepts structured boundary errors", () => {
    expect(
      contractErrorSchema.parse({
        schemaVersion: "prism.contract-error/v1",
        code: "invalid_repair_request",
        message: "The repair request is invalid.",
        issues: [
          {
            path: "prompt",
            code: "custom",
            message: "Describe one visible frontend problem.",
          },
        ],
      }),
    ).toMatchObject({ code: "invalid_repair_request" });
  });
});
