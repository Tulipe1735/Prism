import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { contractErrorSchema } from "@prism/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRun } from "../../../../../lib/server/run-repository";

import { POST } from "./route";

let dataDirectory: string;
let previousDataDirectory: string | undefined;
let previousBrowserBaseUrl: string | undefined;

beforeEach(async () => {
  previousDataDirectory = process.env.PRISM_DATA_DIR;
  previousBrowserBaseUrl = process.env.PRISM_BROWSER_BASE_URL;
  dataDirectory = await mkdtemp(join(tmpdir(), "prism-browser-route-"));
  process.env.PRISM_DATA_DIR = dataDirectory;
  delete process.env.PRISM_BROWSER_BASE_URL;
});

afterEach(async () => {
  if (previousDataDirectory === undefined) delete process.env.PRISM_DATA_DIR;
  else process.env.PRISM_DATA_DIR = previousDataDirectory;
  if (previousBrowserBaseUrl === undefined) delete process.env.PRISM_BROWSER_BASE_URL;
  else process.env.PRISM_BROWSER_BASE_URL = previousBrowserBaseUrl;
  await rm(dataDirectory, { recursive: true, force: true });
});

describe("POST /api/runs/:runId/browser-baseline", () => {
  it("refuses baseline capture until a local BrowserExecutor origin is explicitly configured", async () => {
    const creation = await createRun({
      schemaVersion: "prism.repair-request/v1",
      prompt: "Capture a browser baseline for the visible Save button.",
      workspace: { kind: "local", path: "/workspace/fixture", displayName: "fixture" },
      viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    });
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: "prism.browser-baseline-request/v1",
          requestId: "42ee0dfc-a713-49b9-bc60-8c72cced2a24",
          runId: creation.runId,
          route: "/settings/profile",
          target: { kind: "semantic", role: "button", name: "Save", exact: true },
        }),
      }),
      { params: Promise.resolve({ runId: creation.runId }) },
    );

    expect(response.status).toBe(409);
    expect(contractErrorSchema.parse(await response.json())).toMatchObject({
      code: "browser_baseline_not_configured",
    });
  });
});
