import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createRun,
  getRunDossier,
  waitForMockHybridRun,
} from "../../../../../lib/server/run-repository";

import { POST } from "./route";

let dataDirectory: string;
let previousDataDirectory: string | undefined;

beforeEach(async () => {
  previousDataDirectory = process.env.PRISM_DATA_DIR;
  dataDirectory = await mkdtemp(join(tmpdir(), "prism-orchestration-route-"));
  process.env.PRISM_DATA_DIR = dataDirectory;
});

afterEach(async () => {
  if (previousDataDirectory === undefined) delete process.env.PRISM_DATA_DIR;
  else process.env.PRISM_DATA_DIR = previousDataDirectory;
  await rm(dataDirectory, { recursive: true, force: true });
});

describe("POST /api/runs/:runId/orchestration", () => {
  it("starts a mock hybrid Run and leaves its durable progress available to the dossier", async () => {
    const creation = await createRun({
      schemaVersion: "prism.repair-request/v1",
      prompt: "Make the Save button visibly rounded and prove the rendered control.",
      workspace: { kind: "local", path: "/tmp/prism-fixture", displayName: "fixture" },
      viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    });

    const response = await POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ runId: creation.runId }),
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      schemaVersion: "prism.orchestration-start-response/v1",
      status: "started",
      runId: creation.runId,
    });
    await expect(getRunDossier(creation.runId)).resolves.toMatchObject({
      dagRevisions: expect.arrayContaining([expect.objectContaining({ revision: 1 })]),
    });
    await expect(waitForMockHybridRun(creation.runId)).resolves.toMatchObject({
      dagRevisions: expect.arrayContaining([expect.objectContaining({ revision: 4 })]),
    });
  });
});
