import type { ArtifactRef, BrowserRuntimeTaskEnvelope } from "@prism/contracts";
import type { AddressInfo } from "node:net";
import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";

import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import {
  type BrowserModelAction,
  type BrowserPort,
  BrowserRuntime,
  type BrowserSessionFactory,
  AgentPlanBrowserSessionFactory,
} from "./index";

const runId = "run_6dbf6f33-69c4-4e5f-9898-3f693735f5f0";
const viewport = { width: 1280, height: 720, deviceScaleFactor: 1 } as const;
/** 1x1 透明 PNG（供脚本化端口返回合法的 base64 截图）。 */
const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const roots: string[] = [];
const servers: Server[] = [];

function sha256(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("BrowserRuntime", () => {
  it("routes one model click through the ActionBroker and returns browser evidence", async () => {
    const artifacts = new Map<string, string>();
    const sessionFactory = scriptedSessionFactory([
      { action: "click", x: 640, y: 324 },
      { action: "finished", judgment: "The button was clicked." },
    ]);
    const runtime = new BrowserRuntime({
      baseUrl: "http://127.0.0.1:4173",
      viewport,
      browserPortFactory: { create: async () => scriptedPort() },
      sessionFactory,
      artifacts: {
        commit: async (content, mediaType) => {
          const hash = sha256(content);
          artifacts.set(hash, content.toString());
          return artifactRef(hash, content.toString(), mediaType);
        },
      },
      verifier: {
        verify: async () => ({
          assertion: "The Save button rendered within the intent-linked predicate.",
          status: "passed",
        }),
      },
      clock: () => new Date("2026-08-05T09:00:00.000Z"),
    });

    const result = await runtime.execute(
      verifyEnvelope({ intent: "The Save button is visibly present and clickable." }),
    );

    expect(result.outcome).toMatchObject({
      state: "succeeded",
      failure: null,
      request: { kind: "successor", nodeType: "task.complete" },
    });
    expect(result.browserActions).toHaveLength(1);
    expect(result.browserActions[0]!.policy.decision).toBe("allowed");
    expect(result.browserActions[0]!.execution.status).toBe("executed");
    expect(result.browserActions[0]!.proposal.origin).toBe("browser-model");
    expect(result.browserActions[0]!.proposal.target).toMatchObject({
      kind: "coordinate",
      observationId: expect.any(String),
      screenshotHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      pageStateHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(result.verificationReport).toMatchObject({
      verdict: "passed",
      intent: "The Save button is visibly present and clickable.",
    });
    expect(result.verificationReport?.assertions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "deterministic",
          intentLinked: true,
          status: "passed",
        }),
        expect.objectContaining({ kind: "supplemental", intentLinked: false }),
      ]),
    );
    expect(result.usage).toMatchObject({
      model: { provider: "scripted-browser-model", id: "scripted-1" },
      modelCalls: 2,
      actionsProposed: 1,
      actionsExecuted: 1,
    });
    const trajectory = result.artifacts.find(
      (artifact) =>
        artifact.mediaType === "application/vnd.prism.browser-trajectory+json",
    );
    expect(trajectory).toBeDefined();
    expect(artifacts.get(trajectory!.hash)).toContain("browser.session");
  });

  it("rejects an unsupported Kimi function call without sending browser input", async () => {
    const sessionFactory = new AgentPlanBrowserSessionFactory({
      apiKey: "fixture",
      fetchImpl: responsesFetch([{ name: "type", arguments: { content: "rm -rf /" } }]),
    });
    let clicked = false;
    const runtime = new BrowserRuntime({
      baseUrl: "http://127.0.0.1:4173",
      viewport,
      browserPortFactory: {
        create: async () => ({
          observe: async () => observation(),
          screenshot: async () => ({
            base64: pngBase64,
            scaleFactor: 1,
            observation: observation(),
          }),
          click: async () => {
            clicked = true;
          },
          dispose: async () => undefined,
        }),
      },
      sessionFactory,
      artifacts: { commit: commitArtifact },
      clock: () => new Date("2026-08-05T09:00:00.000Z"),
    });

    const result = await runtime.execute(verifyEnvelope());

    expect(clicked).toBe(false);
    expect(result.browserActions).toHaveLength(0);
    expect(result.outcome.state).toBe("blocked");
    expect(result.outcome.failure).toMatchObject({
      code: "browser_execution_failed",
    });
  });

  it("returns a typed verification_failed outcome when a deterministic predicate fails", async () => {
    const sessionFactory = scriptedSessionFactory([
      { action: "finished", judgment: "The button appears fine to me." },
    ]);
    const runtime = new BrowserRuntime({
      baseUrl: "http://127.0.0.1:4173",
      viewport,
      browserPortFactory: { create: async () => scriptedPort() },
      sessionFactory,
      artifacts: { commit: commitArtifact },
      verifier: {
        verify: async () => ({
          assertion: "The Save button radius is at least 8px.",
          status: "failed",
        }),
      },
      clock: () => new Date("2026-08-05T09:00:00.000Z"),
    });

    const result = await runtime.execute(
      verifyEnvelope({ intent: "The Save button is materially rounded." }),
    );

    expect(result.verificationReport?.verdict).toBe("failed");
    expect(result.outcome).toMatchObject({
      state: "failed",
      failure: { code: "verification_failed" },
    });
  });

  it("cannot create a passing verification report from model judgment alone", async () => {
    const sessionFactory = scriptedSessionFactory([
      { action: "finished", judgment: "The button definitely looks rounded." },
    ]);
    const runtime = new BrowserRuntime({
      baseUrl: "http://127.0.0.1:4173",
      viewport,
      browserPortFactory: { create: async () => scriptedPort() },
      sessionFactory,
      artifacts: { commit: commitArtifact },
      clock: () => new Date("2026-08-05T09:00:00.000Z"),
    });

    const result = await runtime.execute(
      verifyEnvelope({ intent: "The Save button is materially rounded." }),
    );

    expect(result.verificationReport?.verdict).toBe("inconclusive");
    expect(result.verificationReport?.assertions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "deterministic",
          status: "inconclusive",
          assertion: "No intent-linked deterministic predicate was provided.",
        }),
      ]),
    );
    expect(result.outcome).toMatchObject({
      state: "failed",
      failure: { code: "verification_failed" },
    });
  });

  it("maps external cancellation to a blocked typed outcome", async () => {
    const controller = new AbortController();
    const sessionFactory: BrowserSessionFactory = {
      model: { provider: "scripted-browser-model", id: "scripted-1" },
      create: async ({ signal }) => ({
        run: async () => {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 50);
            signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                resolve();
              },
              { once: true },
            );
          });
        },
        abort: async () => undefined,
        dispose: () => undefined,
        getUsage: () => usage(),
      }),
    };
    const runtime = new BrowserRuntime({
      baseUrl: "http://127.0.0.1:4173",
      viewport,
      browserPortFactory: { create: async () => scriptedPort() },
      sessionFactory,
      artifacts: { commit: commitArtifact },
      clock: () => new Date("2026-08-05T09:00:00.000Z"),
    });
    setTimeout(() => controller.abort(), 10);

    const result = await runtime.execute(observeEnvelope(), {
      signal: controller.signal,
    });

    expect(result.outcome).toMatchObject({
      state: "blocked",
      failure: { code: "cancelled" },
    });
  });
});

describe("PlaywrightBrowserPortFactory integration smoke", () => {
  it("captures a baseline, performs an allowlisted local interaction, rejects a stale proposal, and cannot write source", async () => {
    const server = await serveFixture();
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const factory = new (await import("./index")).PlaywrightBrowserPortFactory();
    const port = await factory.create({
      baseUrl,
      route: "/settings/profile",
      viewport,
    });

    // 1. observe the allowlisted page and record the grounded observation
    const observation = await port.observe();
    expect(observation.url).toBe(`${baseUrl}/settings/profile`);
    expect(observation.viewport).toEqual(viewport);

    // 2. execute a fresh semantic click through the ActionBroker
    const before = await port.observe();
    const broker = new (await import("@prism/action-broker")).ActionBroker({
      port,
    });
    const record = await broker.execute({
      schemaVersion: "prism.browser-action-proposal/v1",
      proposalId: randomUUID(),
      runId,
      origin: "browser-model",
      action: { kind: "click" },
      target: { kind: "semantic", role: "button", name: "Save", exact: true },
    });
    expect(record.policy.decision).toBe("allowed");
    expect(record.execution.status).toBe("executed");
    expect(record.after).not.toBeNull();
    expect(record.after?.pageStateHash).not.toBe(before.pageStateHash);

    // 3. a coordinate proposal bound to the pre-click observation is stale now
    const stale = await broker.execute({
      schemaVersion: "prism.browser-action-proposal/v1",
      proposalId: randomUUID(),
      runId,
      origin: "browser-model",
      action: { kind: "click" },
      target: {
        kind: "coordinate",
        x: 400,
        y: 300,
        observationId: observation.observationId,
        screenshotHash: observation.screenshotHash,
        pageStateHash: observation.pageStateHash,
        viewport,
      },
    });
    expect(stale.policy.decision).toBe("stale");
    expect(stale.execution.status).toBe("stale");

    // 4. the port exposes no source-write capability
    expect(Object.keys(port).sort()).toEqual([
      "click",
      "dispose",
      "observe",
      "screenshot",
    ]);
    expect(port).not.toHaveProperty("writeSource");

    await port.dispose();
  });

  it("drives a real browser with Agent Plan Responses tool calls", async () => {
    const server = await serveFixture();
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const artifacts = new Map<string, string>();
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const sessionFactory = new AgentPlanBrowserSessionFactory({
      apiKey: "fixture",
      fetchImpl: responsesFetch(
        [
          { name: "click", arguments: { x: 45, y: 70 } },
          {
            name: "finished",
            arguments: { judgment: "The page responded to the interaction." },
          },
        ],
        requests,
      ),
    });
    const runtime = new (await import("./index")).BrowserRuntime({
      baseUrl,
      viewport,
      browserPortFactory: new (await import("./index")).PlaywrightBrowserPortFactory(),
      sessionFactory,
      artifacts: {
        commit: async (content, mediaType) => {
          const hash = sha256(content);
          artifacts.set(hash, content.toString());
          return {
            schemaVersion: "prism.artifact-ref/v1",
            algorithm: "sha256",
            hash,
            byteLength: Buffer.byteLength(content),
            mediaType,
          };
        },
      },
      verifier: {
        verify: async () => ({
          assertion: "The Save button is clickable within the intent-linked predicate.",
          status: "passed",
        }),
      },
      clock: () => new Date("2026-08-05T09:00:00.000Z"),
    });

    const result = await runtime.execute(
      verifyEnvelope({ intent: "The Save button is visibly clickable." }),
    );

    expect(result.outcome).toMatchObject({
      state: "succeeded",
      failure: null,
      request: { kind: "successor", nodeType: "task.complete" },
    });
    expect(result.browserActions).toHaveLength(1);
    expect(result.browserActions[0]!.execution.status).toBe("executed");
    expect(result.verificationReport?.verdict).toBe("passed");
    expect(result.usage.modelCalls).toBe(2);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      url: "https://ark.cn-beijing.volces.com/api/plan/v3/responses",
      body: { model: "doubao-seed-2.0-pro", tool_choice: "required" },
    });
  });
});

function fixturePage(title: string): string {
  return `<!doctype html><html><head><title>${title}</title></head><body><h1>Settings</h1><button id="save" onclick="document.getElementById('status').textContent='clicked'">Save</button><div id="status">idle</div></body></html>`;
}

async function serveFixture(): Promise<Server> {
  const html = fixturePage("Settings profile");
  const server = createServer((request, response) => {
    if (request.url?.includes("..")) {
      response.writeHead(403).end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return server;
}

const stableObservation = {
  observationId: "d5d02fbb-a7ec-4cad-85d7-0b6b3ac6c10b",
  url: "http://127.0.0.1:4173/settings/profile",
  viewport,
  pageStateHash: "a".repeat(64),
  screenshotHash: "b".repeat(64),
};

function observation() {
  return { ...stableObservation };
}

function scriptedPort(): BrowserPort {
  let current = observation();
  return {
    observe: async () => current,
    screenshot: async () => ({
      base64: pngBase64,
      scaleFactor: 1,
      observation: current,
    }),
    click: async () => {
      current = { ...current, pageStateHash: "c".repeat(64) };
    },
    dispose: async () => undefined,
  };
}

function usage() {
  return {
    model: { provider: "scripted-browser-model", id: "scripted-1" },
    modelCalls: 0,
    loopCount: 0,
    actionsProposed: 0,
    actionsExecuted: 0,
    costUsd: 0,
    durationMs: 0,
  };
}

function artifactRef(hash: string, _content: string, mediaType: string): ArtifactRef {
  return {
    schemaVersion: "prism.artifact-ref/v1",
    algorithm: "sha256",
    hash,
    byteLength: 1,
    mediaType,
  };
}

function commitArtifact(
  content: string | Uint8Array,
  mediaType: string,
): Promise<ArtifactRef> {
  const bytes =
    typeof content === "string" ? Buffer.from(content) : Buffer.from(content);
  return Promise.resolve(artifactRef(sha256(bytes), bytes.toString(), mediaType));
}

function observeEnvelope(intent: string | null = null): BrowserRuntimeTaskEnvelope {
  return {
    schemaVersion: "prism.browser-task-envelope/v1",
    runId,
    dagRevision: 1,
    nodeId: "node-1-browser-observe",
    nodeType: "browser.observe",
    attempt: 1,
    maxAttempts: 2,
    runtime: "browser",
    prompt: "Observe the settings page and note the Save button.",
    inputArtifacts: [],
    authority: {
      route: "/settings/profile",
      target: { kind: "semantic", role: "button", name: "Save", exact: true },
      intent,
      maxActions: 8,
    },
    budget: { maxActions: 8, maxDurationMs: 30_000, maxCostUsd: 1 },
    deadline: "2026-08-05T09:05:00.000Z",
    cancellationId: "cancel-browser-smoke",
    correlationId: runId,
    causationEventId: null,
    idempotencyKey: `${runId}:1:node-1-browser-observe:1`,
  };
}

function verifyEnvelope(options: { intent?: string } = {}): BrowserRuntimeTaskEnvelope {
  return {
    ...observeEnvelope(options.intent ?? "The Save button is visibly present."),
    dagRevision: 2,
    nodeId: "node-2-browser-verify-attempt-1",
    nodeType: "browser.verify",
    attempt: 1,
    maxAttempts: 1,
    idempotencyKey: `${runId}:2:node-2-browser-verify-attempt-1:1`,
  };
}

/** 脚本化会话工厂：按队列逐条执行已校验动作。 */
function scriptedSessionFactory(actions: BrowserModelAction[]): BrowserSessionFactory {
  let index = 0;
  const usageValue = usage();
  return {
    model: usageValue.model,
    create: async ({ operator }) => ({
      run: async () => {
        for (const action of actions) {
          index += 1;
          await operator.screenshot();
          if ((await operator.execute(action)).status !== "running") break;
        }
      },
      abort: async () => undefined,
      dispose: () => undefined,
      getUsage: () => ({
        ...usageValue,
        modelCalls: index,
        loopCount: index,
        actionsProposed: operator.records.length,
        actionsExecuted: operator.records.filter(
          (record) => record.execution.status === "executed",
        ).length,
      }),
    }),
  };
}

function responsesFetch(
  calls: Array<{ name: string; arguments: Record<string, unknown> }>,
  requests: Array<{ url: string; body: Record<string, unknown> }> = [],
): typeof fetch {
  let index = 0;
  return (async (input, init) => {
    requests.push({
      url: input.toString(),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    const call = calls[index++];
    if (!call) return new Response("No scripted response", { status: 500 });
    return new Response(
      JSON.stringify({
        output: [
          {
            type: "function_call",
            name: call.name,
            arguments: JSON.stringify(call.arguments),
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
}
