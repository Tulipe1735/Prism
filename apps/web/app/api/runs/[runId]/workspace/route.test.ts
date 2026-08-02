import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { workspaceEvidenceResponseSchema } from "@prism/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRun, getRunDossier } from "../../../../../lib/server/run-repository";

import { POST } from "./route";

let dataDirectory: string;
let workspaceDirectory: string;
let previousDataDirectory: string | undefined;

beforeEach(async () => {
  previousDataDirectory = process.env.PRISM_DATA_DIR;
  dataDirectory = await mkdtemp(join(tmpdir(), "prism-workspace-route-"));
  workspaceDirectory = await mkdtemp(join(tmpdir(), "prism-workspace-root-"));
  process.env.PRISM_DATA_DIR = dataDirectory;
  await writeFile(join(workspaceDirectory, "package.json"), '{"name":"fixture"}\n');
});

afterEach(async () => {
  if (previousDataDirectory === undefined) delete process.env.PRISM_DATA_DIR;
  else process.env.PRISM_DATA_DIR = previousDataDirectory;
  await Promise.all([
    rm(dataDirectory, { recursive: true, force: true }),
    rm(workspaceDirectory, { recursive: true, force: true }),
  ]);
});

describe("POST /api/runs/:runId/workspace", () => {
  it("executes a typed inspection and returns the durable evidence record", async () => {
    const creation = await createRun({
      schemaVersion: "prism.repair-request/v1",
      prompt: "Inspect this fixture before planning the visible repair.",
      workspace: { kind: "local", path: workspaceDirectory, displayName: "fixture" },
      viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    });
    const body = {
      schemaVersion: "prism.workspace-request/v1",
      requestId: "42ee0dfc-a713-49b9-bc60-8c72cced2a24",
      runId: creation.runId,
      operation: "inspect",
      paths: ["package.json"],
      patterns: [],
    } as const;

    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ runId: creation.runId }) },
    );
    const result = workspaceEvidenceResponseSchema.parse(await response.json());

    expect(response.status).toBe(201);
    expect(result.record.evidence).toMatchObject({
      status: "succeeded",
      details: { operation: "inspect", reads: [{ path: "package.json" }] },
    });
    expect(await getRunDossier(creation.runId)).toMatchObject({
      workspaceEvidence: [result.record],
    });
  });
});
