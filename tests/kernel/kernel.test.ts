import type { SessionSummary } from "../../src/kernel/session.ts";
import { afterEach, expect, it } from "vitest";
import { VERSION } from "../../src/shared/version.ts";
import { api, connectEvents, type KernelHarness, startTestKernel } from "./harness.ts";

let harness: KernelHarness | undefined;

afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
});

async function start(
  options: Parameters<typeof startTestKernel>[0] = {},
): Promise<KernelHarness> {
  harness = await startTestKernel(options);
  return harness;
}

it("reports kernel status over HTTP and pushes it to new event subscribers", async () => {
  const { kernel, dataDir } = await start();

  const status = await api<{ status: string; version: string; dataDir: string }>(
    kernel.url,
    "/status",
  );
  expect(status.body).toEqual({ status: "ready", version: VERSION, dataDir });

  const events = await connectEvents(`${kernel.url}/events`);
  await expect(
    events.waitFor((event) => event.type === "kernel.status"),
  ).resolves.toMatchObject({ status: "ready", version: VERSION, dataDir });
  events.close();
});

it("reads the settings in effect without handing back the model key", async () => {
  const { kernel, dataDir, workspace } = await start({ scope: "workspace-write" });

  const settings = await api<Record<string, unknown>>(kernel.url, "/settings");
  expect(settings.status).toBe(200);
  expect(settings.body).toEqual({
    dataDir,
    model: {
      baseUrl: expect.stringContaining("http://127.0.0.1:"),
      model: "scripted-model",
      hasApiKey: true,
    },
    browser: { engine: "chromium" },
    search: { provider: "deepseek" },
    permissions: { scope: "workspace-write" },
  });
  expect(JSON.stringify(settings.body)).not.toContain("test-key");
  expect(workspace).not.toBe("");
});

it("creates, lists, continues and deletes sessions over HTTP", async () => {
  const { kernel, workspace } = await start();
  const events = await connectEvents(`${kernel.url}/events`);

  const created = await api<{ session: SessionSummary }>(kernel.url, "/sessions", {
    method: "POST",
    body: { workspace, title: "Fix the login" },
  });
  expect(created.status).toBe(201);
  expect(created.body.session).toMatchObject({
    workspace,
    title: "Fix the login",
    entryCount: 0,
    leafId: null,
  });
  await expect(
    events.waitFor((event) => event.type === "session.updated"),
  ).resolves.toMatchObject({ session: { id: created.body.session.id } });

  const listed = await api<{ sessions: SessionSummary[] }>(
    kernel.url,
    `/sessions?workspace=${encodeURIComponent(workspace)}`,
  );
  expect(listed.body.sessions.map((session) => session.id)).toEqual([
    created.body.session.id,
  ]);
  const elsewhere = await api<{ sessions: SessionSummary[] }>(
    kernel.url,
    "/sessions?workspace=/somewhere/else",
  );
  expect(elsewhere.body.sessions).toEqual([]);

  const continued = await api<{ session: SessionSummary; entries: unknown[] }>(
    kernel.url,
    `/sessions/${created.body.session.id}`,
  );
  expect(continued.status).toBe(200);
  expect(continued.body.entries).toEqual([]);

  const deleted = await api<{ deleted: boolean }>(
    kernel.url,
    `/sessions/${created.body.session.id}`,
    { method: "DELETE" },
  );
  expect(deleted.body).toEqual({ deleted: true });
  const gone = await api<{ error: { code: string } }>(
    kernel.url,
    `/sessions/${created.body.session.id}`,
  );
  expect(gone.status).toBe(404);
  expect(gone.body).toMatchObject({ error: { code: "SESSION_NOT_FOUND" } });
  events.close();
});

it("answers unknown routes and malformed requests with coded errors", async () => {
  const { kernel, dataDir } = await start();

  const unknown = await api<{ error: { code: string } }>(kernel.url, "/nope");
  expect(unknown.status).toBe(400);
  expect(unknown.body).toMatchObject({ error: { code: "INVALID_REQUEST" } });

  const noWorkspace = await api<{ error: { code: string } }>(kernel.url, "/sessions", {
    method: "POST",
    body: { title: "no workspace" },
  });
  expect(noWorkspace.status).toBe(400);

  const missingSession = await api<{ error: { code: string } }>(
    kernel.url,
    "/sessions/11111111-2222-3333-4444-555555555555/messages",
    { method: "POST", body: { text: "hello" } },
  );
  expect(missingSession.status).toBe(404);
  expect(missingSession.body).toMatchObject({ error: { code: "SESSION_NOT_FOUND" } });

  const unknownApproval = await api<{ error: { code: string } }>(
    kernel.url,
    "/sessions/11111111-2222-3333-4444-555555555555/approvals/not-a-request",
    { method: "POST", body: { approved: true } },
  );
  expect(unknownApproval.status).toBe(404);
  expect(unknownApproval.body).toMatchObject({ error: { code: "APPROVAL_NOT_FOUND" } });

  const badApproval = await api<{ error: { message: string } }>(
    kernel.url,
    "/sessions/11111111-2222-3333-4444-555555555555/approvals/not-a-request",
    { method: "POST", body: { approved: "yes" } },
  );
  expect(badApproval.status).toBe(400);
  expect(badApproval.body.error.message).toContain("approved");

  const brokenJson = await fetch(`${kernel.url}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
  expect(brokenJson.status).toBe(400);

  // The kernel keeps serving after a rejected request.
  const status = await api<{ status: string }>(kernel.url, "/status");
  expect(status.body.status).toBe("ready");
  expect(dataDir).toContain("data");
});

it("keeps serving after a workbench closes its event stream", async () => {
  const { kernel, workspace } = await start();
  const events = await connectEvents(`${kernel.url}/events`);
  await events.waitFor((event) => event.type === "kernel.status");
  events.close();
  await new Promise((resolve) => setTimeout(resolve, 50));

  const created = await api<{ session: SessionSummary }>(kernel.url, "/sessions", {
    method: "POST",
    body: { workspace },
  });
  expect(created.status).toBe(201);
});

it("shuts down cleanly on request and stops accepting connections", async () => {
  const { kernel } = await start();
  const events = await connectEvents(`${kernel.url}/events`);

  const stopping = events.waitFor(
    (event) => event.type === "kernel.status" && event.status === "stopping",
  );
  const shutdown = await api<{ stopping: boolean }>(kernel.url, "/shutdown", {
    method: "POST",
  });
  expect(shutdown.status).toBe(202);
  expect(shutdown.body).toEqual({ stopping: true });
  await expect(stopping).resolves.toMatchObject({ status: "stopping" });

  await expect(fetch(`${kernel.url}/status`)).rejects.toThrow();
  events.close();
});
