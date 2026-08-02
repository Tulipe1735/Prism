import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type RepairRequest, runCreationSchema } from "@prism/contracts";
import { FileTrajectoryStore } from "@prism/trajectory-store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createRun,
  executeWorkspaceRequest,
  getRunDossier,
  listRecentRuns,
} from "./run-repository";

const request: RepairRequest = {
  schemaVersion: "prism.repair-request/v1",
  prompt: "  Make the primary Save button clearly rounded instead of square.  ",
  workspace: {
    kind: "local",
    path: "/workspaces/prism-fixture",
    displayName: "prism-fixture",
  },
  viewport: {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
  },
};

let dataDirectory: string;
let previousDataDirectory: string | undefined;

beforeEach(async () => {
  previousDataDirectory = process.env.PRISM_DATA_DIR;
  dataDirectory = await mkdtemp(join(tmpdir(), "prism-web-runs-"));
  process.env.PRISM_DATA_DIR = dataDirectory;
});

afterEach(async () => {
  if (previousDataDirectory === undefined) {
    delete process.env.PRISM_DATA_DIR;
  } else {
    process.env.PRISM_DATA_DIR = previousDataDirectory;
  }
  await rm(dataDirectory, { recursive: true, force: true });
});

describe("Run repository", () => {
  it("creates, lists, and reopens one durable Run without changing its prompt", async () => {
    const creation = runCreationSchema.parse(await createRun(request));

    expect(creation.status).toBe("created");
    expect(await listRecentRuns()).toEqual([
      expect.objectContaining({
        id: creation.runId,
        status: "queued",
        integrity: "verified",
      }),
    ]);
    expect(await getRunDossier(creation.runId)).toMatchObject({
      id: creation.runId,
      prompt: request.prompt,
      status: "queued",
      integrity: "verified",
      lastSequence: 2,
    });

    const reopenedFromDisk = await new FileTrajectoryStore({ dataDirectory }).loadRun(
      creation.runId,
    );
    expect(reopenedFromDisk.manifest.request.prompt).toBe(request.prompt);
  });

  it("returns a visible terminal dossier when an artifact fails integrity", async () => {
    const creation = await createRun(request);
    const store = new FileTrajectoryStore({ dataDirectory });
    const durableRun = await store.loadRun(creation.runId);
    const { hash } = durableRun.manifest.requestArtifact;
    await writeFile(
      join(dataDirectory, "artifacts", "sha256", hash.slice(0, 2), hash),
      "tampered artifact",
      "utf8",
    );

    expect(await getRunDossier(creation.runId)).toMatchObject({
      id: creation.runId,
      status: "terminal_error",
      integrity: "failed",
      terminalError: {
        code: "corrupt_artifact",
      },
    });
  });

  it("returns null for an unknown or unsafe Run ID", async () => {
    expect(await getRunDossier("run_11111111-1111-4111-8111-111111111111")).toBeNull();
    expect(await getRunDossier("../../outside")).toBeNull();
  });

  it("stores confined workspace evidence as a hashed artifact in the dossier", async () => {
    const workspaceDirectory = await mkdtemp(join(tmpdir(), "prism-run-workspace-"));
    await writeFile(join(workspaceDirectory, "package.json"), '{"name":"fixture"}\n');
    const creation = await createRun({
      ...request,
      workspace: {
        kind: "local",
        path: workspaceDirectory,
        displayName: "fixture",
      },
    });

    try {
      const records = await Promise.all(
        [
          "42ee0dfc-a713-49b9-bc60-8c72cced2a24",
          "42ee0dfc-a713-49b9-bc60-8c72cced2a25",
        ].map((requestId) =>
          executeWorkspaceRequest(creation.runId, {
            schemaVersion: "prism.workspace-request/v1",
            requestId,
            runId: creation.runId,
            operation: "inspect",
            paths: ["package.json"],
            patterns: [],
          }),
        ),
      );

      expect(records).toEqual([
        expect.objectContaining({
          evidence: expect.objectContaining({
            status: "succeeded",
            operation: "inspect",
          }),
          artifact: expect.objectContaining({
            mediaType: "application/vnd.prism.workspace-evidence+json",
          }),
        }),
        expect.objectContaining({
          evidence: expect.objectContaining({
            status: "succeeded",
            operation: "inspect",
          }),
          artifact: expect.objectContaining({
            mediaType: "application/vnd.prism.workspace-evidence+json",
          }),
        }),
      ]);
      expect(await getRunDossier(creation.runId)).toMatchObject({
        lastSequence: 4,
        workspaceEvidence: records,
        artifacts: expect.arrayContaining(records.map((record) => record?.artifact)),
      });
    } finally {
      await rm(workspaceDirectory, { recursive: true, force: true });
    }
  });
});
