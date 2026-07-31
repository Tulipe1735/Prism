import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { contractErrorSchema, runCreationSchema } from "@prism/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getRunDossier } from "../../../lib/server/run-repository";

import { POST } from "./route";

const configuredWorkspacePath = "/workspaces/prism-fixture";
let dataDirectory: string;
let previousDataDirectory: string | undefined;
let previousWorkspacePath: string | undefined;

const validRequest = {
  schemaVersion: "prism.repair-request/v1",
  prompt: "Make the primary Save button clearly rounded instead of square.",
  workspace: {
    kind: "local",
    path: configuredWorkspacePath,
    displayName: "prism-fixture",
  },
  viewport: {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
  },
} as const;

function jsonRequest(body: unknown, contentType = "application/json") {
  return new Request("http://localhost/api/repair-requests", {
    method: "POST",
    headers: { "content-type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/repair-requests", () => {
  beforeEach(async () => {
    previousDataDirectory = process.env.PRISM_DATA_DIR;
    previousWorkspacePath = process.env.PRISM_WORKSPACE_PATH;
    dataDirectory = await mkdtemp(join(tmpdir(), "prism-route-runs-"));
    process.env.PRISM_DATA_DIR = dataDirectory;
    process.env.PRISM_WORKSPACE_PATH = configuredWorkspacePath;
  });

  afterEach(async () => {
    if (previousDataDirectory === undefined) delete process.env.PRISM_DATA_DIR;
    else process.env.PRISM_DATA_DIR = previousDataDirectory;
    if (previousWorkspacePath === undefined) delete process.env.PRISM_WORKSPACE_PATH;
    else process.env.PRISM_WORKSPACE_PATH = previousWorkspacePath;
    await rm(dataDirectory, { recursive: true, force: true });
  });

  it("creates a durable Run from an accepted request", async () => {
    const response = await POST(jsonRequest(validRequest));
    const body: unknown = await response.json();

    expect(response.status).toBe(201);
    const creation = runCreationSchema.parse(body);
    expect(creation).toMatchObject({ status: "created" });
    expect(await getRunDossier(creation.runId)).toMatchObject({
      prompt: validRequest.prompt,
      status: "queued",
      lastSequence: 2,
    });
  });

  it("still rejects invalid input when browser validation is bypassed", async () => {
    const response = await POST(jsonRequest({ ...validRequest, prompt: " " }));
    const body = contractErrorSchema.parse(await response.json());

    expect(response.status).toBe(422);
    expect(body.code).toBe("invalid_repair_request");
    expect(body.issues).toEqual([expect.objectContaining({ path: "prompt" })]);
  });

  it("rejects a workspace outside the configured local boundary", async () => {
    const response = await POST(
      jsonRequest({
        ...validRequest,
        workspace: { ...validRequest.workspace, path: "/workspaces/other" },
      }),
    );
    const body = contractErrorSchema.parse(await response.json());

    expect(response.status).toBe(422);
    expect(body.code).toBe("unsupported_workspace");
    expect(body.issues).toEqual([expect.objectContaining({ path: "workspace.path" })]);
  });

  it("rejects malformed JSON", async () => {
    const response = await POST(jsonRequest("{"));
    const body = contractErrorSchema.parse(await response.json());

    expect(response.status).toBe(400);
    expect(body.code).toBe("invalid_json");
  });

  it("rejects unsupported media types", async () => {
    const response = await POST(jsonRequest(validRequest, "text/plain"));
    const body = contractErrorSchema.parse(await response.json());

    expect(response.status).toBe(415);
    expect(body.code).toBe("unsupported_media_type");
  });

  it("rejects an oversized body before schema validation", async () => {
    const response = await POST(
      jsonRequest({ ...validRequest, prompt: "x".repeat(17_000) }),
    );
    const body = contractErrorSchema.parse(await response.json());

    expect(response.status).toBe(413);
    expect(body.code).toBe("payload_too_large");
  });
});
