import type { SessionSummary } from "../../src/kernel/session.ts";
import { afterEach, expect, it } from "vitest";
import type { RunningUiServer } from "../../src/workbench/ui-server.ts";
import { startUiServer } from "../../src/workbench/ui-server.ts";
import { api, connectEvents, type KernelHarness, startTestKernel } from "../kernel/harness.ts";

const UI_ROOT = new URL("../../src/workbench/ui/", import.meta.url).pathname;

let kernel: KernelHarness | undefined;
let ui: RunningUiServer | undefined;

afterEach(async () => {
  await ui?.close();
  ui = undefined;
  await kernel?.cleanup();
  kernel = undefined;
});

async function start(): Promise<{ kernel: KernelHarness; ui: RunningUiServer }> {
  kernel = await startTestKernel();
  ui = await startUiServer({ kernelUrl: kernel.kernel.url, uiRoot: UI_ROOT });
  return { kernel, ui };
}

it("serves the workbench shell and refuses files outside the UI root", async () => {
  const { ui: server } = await start();

  const shell = await fetch(`${server.url}/`);
  expect(shell.status).toBe(200);
  expect(shell.headers.get("content-type")).toContain("text/html");
  const html = await shell.text();
  expect(html).toContain('id="session-list"');
  expect(html).toContain('id="chat"');
  expect(html).toContain("app.js");

  const styles = await fetch(`${server.url}/app.css`);
  expect(styles.status).toBe(200);
  expect(styles.headers.get("content-type")).toContain("text/css");

  const unknown = await fetch(`${server.url}/missing.js`);
  expect(unknown.status).toBe(404);
  const escape = await fetch(`${server.url}/..%2f..%2fpackage.json`);
  expect(escape.status).toBe(404);
});

it("proxies kernel requests so the browser stays same-origin", async () => {
  const { kernel: harness, ui: server } = await start();

  const status = await fetch(`${server.url}/kernel/status`);
  expect(status.status).toBe(200);
  expect(status.headers.get("content-type")).toContain("application/json");
  expect(await status.json()).toMatchObject({ status: "ready" });

  const created = await fetch(`${server.url}/kernel/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspace: harness.workspace, title: "through the proxy" }),
  });
  expect(created.status).toBe(201);
  const session = ((await created.json()) as { session: SessionSummary }).session;
  expect(session).toMatchObject({ workspace: harness.workspace });

  const listed = await api<{ sessions: SessionSummary[] }>(
    harness.kernel.url,
    "/sessions",
  );
  expect(listed.body.sessions.map((entry) => entry.id)).toEqual([session.id]);

  const missing = await fetch(`${server.url}/kernel/sessions/${session.id}/nope`);
  expect(missing.status).toBe(400);
  expect(await missing.json()).toMatchObject({
    error: { code: "INVALID_REQUEST" },
  });
});

it("streams kernel events through the proxy as they happen", async () => {
  const { kernel: harness, ui: server } = await start();

  const events = await connectEvents(`${server.url}/kernel/events`);
  await expect(
    events.waitFor((event) => event.type === "kernel.status"),
  ).resolves.toMatchObject({ status: "ready" });

  const created = await api<{ session: SessionSummary }>(harness.kernel.url, "/sessions", {
    method: "POST",
    body: { workspace: harness.workspace },
  });
  await expect(
    events.waitFor((event) => event.type === "session.updated"),
  ).resolves.toMatchObject({ session: { id: created.body.session.id } });
  events.close();
});

it("answers with a coded error when the kernel is gone", async () => {
  kernel = await startTestKernel();
  const kernelUrl = kernel.kernel.url;
  ui = await startUiServer({ kernelUrl, uiRoot: UI_ROOT });
  await kernel.kernel.close();
  kernel = undefined;

  const response = await fetch(`${ui.url}/kernel/status`);
  expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({
    error: { code: "KERNEL_UNREACHABLE" },
  });
});
