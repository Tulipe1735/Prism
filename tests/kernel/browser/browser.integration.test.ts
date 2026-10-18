import type { EngineHandle } from "../../../src/kernel/browser/engine.ts";
import type { BrowserPage } from "../../../src/kernel/browser/session.ts";
import type {
  BrowserToolDependencies,
  ObservationView,
} from "../../../src/kernel/browser/tool.ts";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openEngine } from "../../../src/kernel/browser/engine.ts";
import {
  captureEvidence,
  readTargetEvidence,
} from "../../../src/kernel/browser/evidence.ts";
import { openBrowserSession } from "../../../src/kernel/browser/session.ts";
import { BrowserTool } from "../../../src/kernel/browser/tool.ts";
import { BROWSER_ENGINES } from "../../../src/kernel/types.ts";

const PAGE = `<!doctype html><title>Prism kernel browser test</title>
<section><h2 id="group">Alpha</h2><article><p>Plan</p><button id="choose">Choose</button></article></section>
<section><h2>Form</h2><form>
<label>Name <input id="name"></label>
<label>Region <select id="region"><option value="eu">Europe</option><option value="us">America</option></select></label>
<label>Accept <input id="accept" type="checkbox"></label>
</form>
<p role="status" id="status">Ready</p><p role="alert">Review required</p>
<div style="height:1800px"></div><button id="offscreen">Offscreen</button>
<script>window.clicks=0;document.getElementById('choose').addEventListener('click',()=>{window.clicks++;document.getElementById('status').textContent='Clicks '+window.clicks})</script>`;

let url: string;
const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html" });
  response.end(PAGE);
});
const directories: string[] = [];

beforeAll(async () => {
  await new Promise<void>((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  const address = server.address() as { port: number };
  url = `http://127.0.0.1:${address.port}/`;
});

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

afterAll(async () => {
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
});

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "prism-kernel-browser-"));
  directories.push(path);
  return path;
}

for (const engineName of BROWSER_ENGINES) {
  describe(engineName, () => {
    let engine: EngineHandle | undefined;
    let page: BrowserPage | undefined;
    let unavailable = "";
    let tool: BrowserTool | undefined;

    beforeAll(async () => {
      try {
        engine = await openEngine({ engine: engineName });
      } catch (error) {
        unavailable = error instanceof Error ? error.message : String(error);
        return;
      }
      const dependencies: BrowserToolDependencies = {
        // The suite shares one engine across sessions; sessions close their tab only.
        openEngine: async () => ({ ...engine!, close: async () => undefined }),
        openSession: async ({ engine: handle, url: target }) => {
          page = await openBrowserSession({ context: handle.context, url: target });
          return page;
        },
        capture: captureEvidence,
        read: readTargetEvidence,
      };
      tool = new BrowserTool(
        { directory: await directory(), engine: () => ({ engine: engineName }) },
        dependencies,
      );
    });

    afterAll(async () => {
      await tool?.closeAll().catch(() => undefined);
      await engine?.close().catch(() => undefined);
    });

    it("runs open → observe → act → receipt", async ({ skip }) => {
      if (!engine) skip(unavailable || `${engineName} is unavailable`);
      const { session } = await tool!.open({ url });
      const view = await tool!.observe(session, "relations");
      expect(view.page.title).toBe("Prism kernel browser test");
      expect(view.state.coverage).toMatchObject({
        scope: "viewport",
        truncated: false,
      });
      const choose = view.targets.find(
        (item) => item.description === 'button "Choose"',
      )!;
      expect(choose).toBeDefined();
      const context = await tool!.context(session, {
        observation: view.observation,
        target: choose.ref,
      });
      expect(context.relations!.map((entry) => entry.text)).toContain("Alpha");

      const fill = view.targets.find((item) => item.description === 'textbox "Name"')!;
      const typed = await tool!.act(session, {
        observation: view.observation,
        target: fill.ref,
        evidence: view.evidence,
        operation: "fill",
        value: "Ada",
        request_id: "fill",
      });
      expect(typed.receipt.outcome).toBe("executed");
      expect(typed.post_observation).toMatchObject({ status: "captured" });
      const typedView = (typed.post_observation as { data: ObservationView }).data;
      expect(
        typedView.state.controls.find((control) => control.name === "Name")?.value,
      ).toBe("Ada");

      const clicked = await tool!.act(session, {
        observation: typedView.observation,
        target: typedView.targets.find(
          (item) => item.description === 'button "Choose"',
        )!.ref,
        evidence: typedView.evidence,
        operation: "click",
        request_id: "click",
      });
      expect(clicked.receipt.outcome).toBe("executed");
      const clickedView = (clicked.post_observation as { data: ObservationView }).data;
      expect(clickedView.state.messages).toEqual(
        expect.arrayContaining([{ role: "status", text: "Clicks 1" }]),
      );
      expect(await page!.evaluate("window.clicks")).toBe(1);

      const selected = await tool!.act(session, {
        observation: clickedView.observation,
        target: clickedView.targets.find(
          (item) => item.operation === "select" && item.option_value === "us",
        )!.ref,
        evidence: clickedView.evidence,
        operation: "select",
        request_id: "select",
      });
      expect(selected.receipt.outcome).toBe("executed");
      const selectedView = (selected.post_observation as { data: ObservationView })
        .data;
      expect(
        selectedView.state.controls.find((control) => control.name === "Region")?.value,
      ).toBe("us");

      await tool!.close(session);
      expect(await tool!.receipt(session, "click")).toMatchObject({
        outcome: "executed",
        code: "INPUT_ACKNOWLEDGED",
      });
    });

    it("rejects stale references and single-step waits and scrolls", async ({
      skip,
    }) => {
      if (!engine) skip(unavailable || `${engineName} is unavailable`);
      const { session } = await tool!.open({ url });
      const view = await tool!.observe(session, "local");
      const fill = view.targets.find((item) => item.description === 'textbox "Name"')!;
      await page!.evaluate(
        "document.querySelector('#name').value='Changed behind the scenes'",
      );
      const stale = await tool!.act(session, {
        observation: view.observation,
        target: fill.ref,
        evidence: view.evidence,
        operation: "fill",
        value: "Ada",
        request_id: "stale-target",
      });
      expect(stale.receipt).toMatchObject({
        outcome: "not_executed",
        code: "TARGET_CHANGED",
      });

      const again = await tool!.observe(session, "local");
      expect(
        again.targets.find((item) => item.description === 'textbox "Name"')?.state
          .value,
      ).toBe("Changed behind the scenes");
      await page!.evaluate("location.hash = 'next'");
      const navigated = await tool!.act(session, {
        observation: again.observation,
        target: again.targets.find((item) => item.description === 'textbox "Name"')!
          .ref,
        evidence: again.evidence,
        operation: "fill",
        value: "Ada",
        request_id: "stale-document",
      });
      expect(navigated.receipt).toMatchObject({
        outcome: "not_executed",
        code: "DOCUMENT_CHANGED",
      });

      const scrolled = await tool!.observe(session, "local");
      const down = scrolled.targets.find((item) => item.operation === "scroll")!;
      const scroll = await tool!.act(session, {
        observation: scrolled.observation,
        target: down.ref,
        evidence: scrolled.evidence,
        operation: "scroll",
        request_id: "scroll",
      });
      expect(scroll.receipt.outcome).toBe("executed");
      await expect
        .poll(async () => await page!.evaluate("window.scrollY"))
        .toBeGreaterThan(0);
      const afterScroll = (scroll.post_observation as { data: ObservationView }).data;
      const wait = afterScroll.targets.find((item) => item.operation === "wait")!;
      const waited = await tool!.act(session, {
        observation: afterScroll.observation,
        target: wait.ref,
        evidence: afterScroll.evidence,
        operation: "wait",
        request_id: "wait",
      });
      expect(waited.receipt).toMatchObject({
        outcome: "executed",
        code: "WAIT_COMPLETED",
      });
      await tool!.close(session);
    });
  });
}

describe("chromium takeover", () => {
  let child: ReturnType<typeof spawn> | undefined;
  let profile = "";
  let endpoint = "";
  let logs = "";

  beforeAll(async () => {
    profile = await mkdtemp(join(tmpdir(), "prism-takeover-"));
    const port = await freePort();
    endpoint = `http://127.0.0.1:${port}`;
    child = spawn(
      chromium.executablePath(),
      [
        "--headless=new",
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "--no-default-browser-check",
        url,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    child.stderr!.on("data", (chunk) => (logs += chunk.toString()));
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${endpoint}/json/version`);
        if (response.ok) return;
      } catch {
        // Chrome is still starting.
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
  });

  afterAll(async () => {
    if (child && child.exitCode === null) {
      const exited = new Promise<void>((resolveExit) =>
        child!.once("exit", () => resolveExit()),
      );
      child.kill("SIGTERM");
      await Promise.race([
        exited,
        new Promise((resolveWait) => setTimeout(resolveWait, 3_000)),
      ]);
    }
    endpoint = "";
    if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5 });
  });

  it("takes over a running Chromium and manages its own tab", async ({ skip }) => {
    if (!endpoint)
      skip(
        `Could not start Chromium for takeover. Install it with npx playwright install chromium. ${logs.slice(0, 200)}`,
      );
    const engines: EngineHandle[] = [];
    const tool = new BrowserTool(
      { directory: await directory(), engine: () => ({ endpoint }) },
      {
        openEngine: async (options) => {
          const handle = await openEngine(options);
          engines.push(handle);
          return handle;
        },
        openSession: ({ engine, url: target }) =>
          openBrowserSession({ context: engine.context, url: target }),
        capture: captureEvidence,
        read: readTargetEvidence,
      },
    );
    const { session } = await tool.open({ url });
    const handle = engines[0]!;
    expect(handle.context.pages().length).toBe(2);
    const view = await tool.observe(session, "local");
    const choose = view.targets.find((item) => item.description === 'button "Choose"')!;
    const clicked = await tool.act(session, {
      observation: view.observation,
      target: choose.ref,
      evidence: view.evidence,
      operation: "click",
      request_id: "takeover-click",
    });
    expect(clicked.receipt.outcome).toBe("executed");
    await tool.close(session);
    // The owned tab is gone; the user's browser and tab survive the detach.
    const list = (await (await fetch(`${endpoint}/json/list`)).json()) as Array<{
      type: string;
      url: string;
    }>;
    const tabs = list.filter((target) => target.type === "page");
    expect(tabs.map((target) => target.url)).toEqual([url]);
    await expect(fetch(`${endpoint}/json/version`)).resolves.toMatchObject({
      ok: true,
    });
  });
});

async function freePort(): Promise<number> {
  const { createServer: create } = await import("node:net");
  return new Promise((resolvePort) => {
    const probe = create();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address() as { port: number };
      probe.close(() => resolvePort(address.port));
    });
  });
}
