import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const startHybridRun = vi.hoisted(() => vi.fn());

vi.mock("../../../../../lib/server/run-repository", () => ({
  startHybridRun,
}));

const runId = "run_6dbf6f33-69c4-4e5f-9898-3f693735f5f0";

beforeEach(() => {
  startHybridRun.mockReset();
});

describe("POST /api/runs/:runId/orchestration", () => {
  it("starts the live hybrid Run and returns its durable Run identity", async () => {
    startHybridRun.mockResolvedValue(true);

    const response = await POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ runId }),
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      schemaVersion: "prism.orchestration-start-response/v1",
      status: "started",
      runId,
    });
    expect(startHybridRun).toHaveBeenCalledWith(runId);
  });

  it("returns not found when the Run does not exist", async () => {
    startHybridRun.mockResolvedValue(false);

    const response = await POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ runId }),
    });

    expect(response.status).toBe(404);
  });
});
