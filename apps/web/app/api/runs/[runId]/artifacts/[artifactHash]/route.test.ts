import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileTrajectoryStore } from "@prism/trajectory-store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRun } from "../../../../../../lib/server/run-repository";

import { GET } from "./route";

let dataDirectory: string;
let previousDataDirectory: string | undefined;

beforeEach(async () => {
  previousDataDirectory = process.env.PRISM_DATA_DIR;
  dataDirectory = await mkdtemp(join(tmpdir(), "prism-browser-artifact-route-"));
  process.env.PRISM_DATA_DIR = dataDirectory;
});

afterEach(async () => {
  if (previousDataDirectory === undefined) delete process.env.PRISM_DATA_DIR;
  else process.env.PRISM_DATA_DIR = previousDataDirectory;
  await rm(dataDirectory, { recursive: true, force: true });
});

describe("GET /api/runs/:runId/artifacts/:artifactHash", () => {
  it("opens a committed Browser Baseline trace without exposing unlinked artifacts", async () => {
    const creation = await createRun({
      schemaVersion: "prism.repair-request/v1",
      prompt: "Capture the Save button Browser Baseline before mutation.",
      workspace: { kind: "local", path: "/workspace/fixture", displayName: "fixture" },
      viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    });
    const store = new FileTrajectoryStore({ dataDirectory });
    const screenshot = await store.writeArtifact("screenshot", "image/png");
    const evidence = await store.writeArtifact(
      "browser evidence",
      "application/vnd.prism.browser-evidence+json",
    );
    const trace = await store.writeArtifact("trace", "application/zip");
    const unlinked = await store.writeArtifact("private", "text/plain");

    await store.recordBrowserEffect(creation.runId, async () => ({
      schemaVersion: "prism.browser-baseline/v1",
      baselineId: "26a04dcd-0069-45ec-b7ce-c7177e303c5d",
      runId: creation.runId,
      buildIdentity: "fixture@5a6c2ab",
      route: "/settings/profile",
      browserVersion: "Chromium 142.0.0.0",
      viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
      devicePixelRatio: 1,
      target: { kind: "semantic", role: "button", name: "Save", exact: true },
      targetIdentity: "role=button[name=Save]",
      observation: {
        observationId: "d5d02fbb-a7ec-4cad-85d7-0b6b3ac6c10b",
        url: "http://127.0.0.1:4173/settings/profile",
        viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
        pageStateHash: "a".repeat(64),
        screenshotHash: screenshot.hash,
      },
      screenshot,
      dom: evidence,
      accessibility: evidence,
      computed: evidence,
      console: evidence,
      network: evidence,
      trace,
      capturedAt: "2026-08-04T04:00:00.000Z",
      supplementalVisualJudgment: null,
    }));

    const traceResponse = await GET(
      new Request(
        `http://prism.test/api/runs/${creation.runId}/artifacts/${trace.hash}`,
      ),
      { params: Promise.resolve({ runId: creation.runId, artifactHash: trace.hash }) },
    );
    expect(traceResponse.status).toBe(200);
    expect(traceResponse.headers.get("content-type")).toBe("application/zip");
    expect(traceResponse.headers.get("content-disposition")).toContain("attachment");
    await expect(traceResponse.text()).resolves.toBe("trace");

    const hiddenResponse = await GET(
      new Request(
        `http://prism.test/api/runs/${creation.runId}/artifacts/${unlinked.hash}`,
      ),
      {
        params: Promise.resolve({ runId: creation.runId, artifactHash: unlinked.hash }),
      },
    );
    expect(hiddenResponse.status).toBe(404);
  });
});
