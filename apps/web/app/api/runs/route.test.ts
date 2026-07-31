import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  contractErrorSchema,
  type RepairRequest,
  runDossierResponseSchema,
  runListSchema,
} from "@prism/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRun } from "../../../lib/server/run-repository";
import { GET as getRunDossier } from "./[runId]/route";
import { GET as getRunList } from "./route";

const request: RepairRequest = {
  schemaVersion: "prism.repair-request/v1",
  prompt: "Keep this exact prompt while creating a durable Run.",
  workspace: {
    kind: "local",
    path: "/workspaces/prism-fixture",
    displayName: "prism-fixture",
  },
  viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
};

let dataDirectory: string;
let previousDataDirectory: string | undefined;

beforeEach(async () => {
  previousDataDirectory = process.env.PRISM_DATA_DIR;
  dataDirectory = await mkdtemp(join(tmpdir(), "prism-run-api-"));
  process.env.PRISM_DATA_DIR = dataDirectory;
});

afterEach(async () => {
  if (previousDataDirectory === undefined) delete process.env.PRISM_DATA_DIR;
  else process.env.PRISM_DATA_DIR = previousDataDirectory;
  await rm(dataDirectory, { recursive: true, force: true });
});

describe("Run read APIs", () => {
  it("lists committed Runs through a versioned response", async () => {
    const creation = await createRun(request);
    const response = await getRunList();
    const body = runListSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.runs).toEqual([
      expect.objectContaining({ id: creation.runId, status: "queued" }),
    ]);
  });

  it("returns a versioned dossier that preserves the prompt", async () => {
    const creation = await createRun(request);
    const response = await getRunDossier(new Request("http://localhost"), {
      params: Promise.resolve({ runId: creation.runId }),
    });
    const body = runDossierResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.dossier).toMatchObject({
      id: creation.runId,
      prompt: request.prompt,
      integrity: "verified",
    });
  });

  it("returns a structured not-found response", async () => {
    const response = await getRunDossier(new Request("http://localhost"), {
      params: Promise.resolve({
        runId: "run_11111111-1111-4111-8111-111111111111",
      }),
    });
    const body = contractErrorSchema.parse(await response.json());

    expect(response.status).toBe(404);
    expect(body.code).toBe("run_not_found");
  });

  it("returns versioned storage errors when the Run directory cannot be read", async () => {
    const blockedPath = join(dataDirectory, "not-a-directory");
    await writeFile(blockedPath, "blocked", "utf8");
    process.env.PRISM_DATA_DIR = blockedPath;

    const listResponse = await getRunList();
    const listError = contractErrorSchema.parse(await listResponse.json());
    expect(listResponse.status).toBe(500);
    expect(listError.code).toBe("run_storage_error");

    const dossierResponse = await getRunDossier(new Request("http://localhost"), {
      params: Promise.resolve({
        runId: "run_11111111-1111-4111-8111-111111111111",
      }),
    });
    const dossierError = contractErrorSchema.parse(await dossierResponse.json());
    expect(dossierResponse.status).toBe(500);
    expect(dossierError.code).toBe("run_storage_error");
  });
});
