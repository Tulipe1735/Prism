import type { KernelSettings } from "../../src/kernel/kernel.ts";
import type { SessionSummary } from "../../src/kernel/session.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
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

async function createSession(url: string, workspace: string): Promise<SessionSummary> {
  const response = await api<{ session: SessionSummary }>(url, "/sessions", {
    method: "POST",
    body: { workspace },
  });
  expect(response.status).toBe(201);
  return response.body.session;
}

it("changes the model, the browser engine and the search source over HTTP", async () => {
  const { kernel, dataDir } = await start({
    configFile: { model: { apiKey: "sk-keep-me" } },
  });

  const patched = await api<KernelSettings>(kernel.url, "/settings", {
    method: "PUT",
    body: {
      model: {
        baseUrl: "https://gateway.example.com/v1",
        model: "deepseek-reasoner",
        apiKey: "sk-new",
      },
      browser: { engine: "firefox" },
      search: { provider: "gateway", baseUrl: "https://gateway.example.com" },
    },
  });
  expect(patched.status).toBe(200);
  expect(patched.body).toMatchObject({
    model: {
      baseUrl: "https://gateway.example.com/v1",
      model: "deepseek-reasoner",
      hasApiKey: true,
    },
    browser: { engine: "firefox" },
    search: { provider: "gateway", baseUrl: "https://gateway.example.com" },
  });
  // The key goes in, never out.
  expect(JSON.stringify(patched.body)).not.toContain("sk-new");
  await expect(api<KernelSettings>(kernel.url, "/settings")).resolves.toMatchObject({
    body: {
      model: { model: "deepseek-reasoner", hasApiKey: true },
      browser: { engine: "firefox" },
      search: { provider: "gateway", baseUrl: "https://gateway.example.com" },
    },
  });
  expect(
    JSON.parse(await readFile(join(dataDir, "config.json"), "utf8")),
  ).toMatchObject({
    model: {
      baseUrl: "https://gateway.example.com/v1",
      model: "deepseek-reasoner",
      apiKey: "sk-new",
    },
    browser: { engine: "firefox" },
    search: { provider: "gateway", baseUrl: "https://gateway.example.com" },
  });
});

it("runs the next model request with the changed model", async () => {
  const { kernel, model, workspace, dataDir } = await start({
    answers: [{ text: ["Done."] }],
  });
  const switched = await api<KernelSettings>(kernel.url, "/settings", {
    method: "PUT",
    body: { model: { model: "second-model" } },
  });
  expect(switched.body.model.model).toBe("second-model");

  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);
  await api(kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "hello" },
  });
  await events.waitFor(
    (event) => event.type === "session.updated" && event.session.entryCount === 2,
  );
  expect(model.requests[0]?.model).toBe("second-model");
  // The patch merges: the endpoint of the running kernel is kept in the file.
  expect(
    JSON.parse(await readFile(join(dataDir, "config.json"), "utf8")),
  ).toMatchObject({ model: { model: "second-model" } });
  events.close();
});

it("refuses settings it cannot apply instead of dropping them", async () => {
  const { kernel } = await start();

  const cases: unknown[] = [
    {},
    { compaction: { keepTokens: 1000 } },
    { model: { provider: "other" } },
    { model: { baseUrl: "  " } },
    { browser: { engine: "netscape" } },
    { browser: { endpoints: "http://127.0.0.1:9222" } },
    { search: {} },
    { search: { count: 5 } },
  ];
  for (const body of cases) {
    const refused = await api<{ error: { code: string } }>(kernel.url, "/settings", {
      method: "PUT",
      body,
    });
    expect(refused.status, JSON.stringify(body)).toBe(400);
    expect(refused.body).toMatchObject({ error: { code: "INVALID_REQUEST" } });
  }

  // A refused patch leaves the settings as they were.
  await expect(api<KernelSettings>(kernel.url, "/settings")).resolves.toMatchObject({
    body: {
      model: { model: "scripted-model" },
      browser: { engine: "chromium" },
      search: { provider: "deepseek" },
      permissions: { scope: "workspace-write" },
    },
  });
});
