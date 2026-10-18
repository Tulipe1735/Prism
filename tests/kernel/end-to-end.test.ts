import type { Buffer } from "node:buffer";
import type { SessionEntry } from "../../src/kernel/session.ts";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { BROWSER_ENGINES } from "../../src/kernel/types.ts";
import {
  api,
  connectEvents,
  type FakeAnswer,
  type KernelHarness,
  type ModelRequest,
  readSessionLog,
  startTestKernel,
} from "./harness.ts";

/**
 * End-to-end coverage on the only approved seam: a real kernel served over
 * HTTP/SSE with a temporary data directory and workspace, a scripted model and
 * controlled services. Every test here exercises a preset capability the way
 * the workbench and the user reach it.
 */

let harness: KernelHarness | undefined;
let page: Server;
let pageUrl = "";
/** Controlled HTTP service standing in for the search source and public pages. */
let web: Server;
let webOrigin = "";
const webRequests: { method: string; path: string }[] = [];

/**
 * A page with exactly one input and one button: small enough to read in a tool
 * result, but the click really changes the page text, so the recorded
 * observation proves the browser executed the action.
 */
const PAGE = `<!doctype html><title>Prism end-to-end</title>
<label>Note <input id="note"></label>
<button id="save">Save</button>
<p role="status" id="status">Idle</p>
<script>
document.getElementById('save').addEventListener('click', () => {
  const value = document.getElementById('note').value;
  document.getElementById('status').textContent = 'Saved ' + value;
});
</script>`;

const SEARCH_ANSWER = {
  results: [
    {
      title: "Playwright browsers",
      url: "http://public.test/page",
      snippet: "Chromium, Firefox and WebKit are driven by one API.",
      summary: "One API for three engines.",
      site_name: "example.com",
      date: "2026-10-18",
    },
  ],
};

/** Long enough that reading it pushes the session over its compaction trigger. */
const NOTE = "The release note: Prism 0.1.6 ships the kernel browser tools.\n".repeat(
  20,
);

const PUBLIC_PAGE = `<!doctype html><title>Prism notes</title>
<h1>Prism notes</h1><p>Extract this text.</p>
<script>window.shouldNotAppear = "script text";</script>`;

beforeAll(async () => {
  page = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(PAGE);
  });
  await new Promise<void>((resolve) => page.listen(0, "127.0.0.1", resolve));
  const address = page.address();
  if (address === null || typeof address === "string")
    throw new Error("The end-to-end page server did not listen");
  pageUrl = `http://127.0.0.1:${address.port}/`;

  web = createServer((request, response) => {
    const path = (request.url ?? "/").split("?")[0]!;
    webRequests.push({ method: request.method ?? "GET", path });
    if (path === "/v1/tools/search" && request.method === "POST") {
      let raw = "";
      request.on("data", (chunk: Buffer) => (raw += chunk.toString()));
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(SEARCH_ANSWER));
      });
      return;
    }
    if (path === "/page" && request.method === "GET") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(PUBLIC_PAGE);
      return;
    }
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("missing");
  });
  await new Promise<void>((resolve) => web.listen(0, "127.0.0.1", resolve));
  const webAddress = web.address();
  if (webAddress === null || typeof webAddress === "string")
    throw new Error("The end-to-end web server did not listen");
  webOrigin = `http://127.0.0.1:${webAddress.port}`;
});

afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
});

afterAll(async () => {
  await new Promise<void>((resolve) => page.close(() => resolve()));
  web.closeAllConnections();
  await new Promise<void>((resolve) => web.close(() => resolve()));
});

async function start(
  options: Parameters<typeof startTestKernel>[0] = {},
): Promise<KernelHarness> {
  harness = await startTestKernel(options);
  return harness;
}

async function createSession(url: string, workspace: string): Promise<string> {
  const created = await api<{ session: { id: string } }>(url, "/sessions", {
    method: "POST",
    body: { workspace },
  });
  expect(created.status).toBe(201);
  return created.body.session.id;
}

async function send(url: string, sessionId: string, text: string): Promise<void> {
  const sent = await api(url, `/sessions/${sessionId}/messages`, {
    method: "POST",
    body: { text },
  });
  expect(sent.status).toBe(202);
}

/**
 * Waits for the task to stop, the way the workbench derives it: the last log
 * entry is an assistant or system message.
 */
async function waitForTaskEnd(url: string, sessionId: string): Promise<void> {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const { body } = await api<{ entries: SessionEntry[] }>(
      url,
      `/sessions/${sessionId}`,
    );
    const last = body.entries.at(-1);
    if (
      last?.type === "message" &&
      (last.role === "assistant" || last.role === "system")
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`The task in session ${sessionId} never finished`);
}

/** The result of one earlier tool call, by its call id. */
function resultOf<T>(request: ModelRequest, callId: string): T {
  for (const [index, message] of request.messages.entries()) {
    if (!message.tool_calls?.some((call) => call.id === callId)) continue;
    const result = request.messages
      .slice(index + 1)
      .find((candidate) => candidate.role === "tool");
    if (result !== undefined) return JSON.parse(result.content ?? "") as T;
  }
  throw new Error(`The model request carries no result for call ${callId}`);
}

/** A scripted round that calls one tool straight away. */
function call(id: string, name: string, args: Record<string, unknown>): FakeAnswer {
  return { toolCalls: [{ id, name, arguments: JSON.stringify(args) }] };
}

/** A scripted round that builds one tool call from an earlier result. */
function callFrom<T>(
  id: string,
  name: string,
  previous: string,
  args: (result: T) => Record<string, unknown>,
): FakeAnswer {
  return {
    respond: (request) => ({
      toolCalls: [
        { id, name, arguments: JSON.stringify(args(resultOf<T>(request, previous))) },
      ],
    }),
  };
}

function toolResults(
  entries: SessionEntry[],
): Extract<SessionEntry, { type: "tool_result" }>[] {
  return entries.filter(
    (entry): entry is Extract<SessionEntry, { type: "tool_result" }> =>
      entry.type === "tool_result",
  );
}

interface ObservationPayload {
  session: string;
  observation: string;
  evidence: string;
  page: { url: string; title: string };
  state: { messages: { role: string; text: string }[] };
  targets: { ref: string; operation: string; description: string }[];
}

interface ActPayload {
  receipt: { outcome: string; code: string };
  post_observation?:
    | { status: "captured"; data: ObservationPayload }
    | { status: "failed"; error: { code: string; message: string } };
}

/** The observation an action left behind; a missing one fails the script. */
function observed(acted: ActPayload): ObservationPayload {
  if (acted.post_observation?.status !== "captured")
    throw new Error("The action was not followed by an observation");
  return acted.post_observation.data;
}

/** Arguments for one step on the page, using a fresh observation's refs. */
function actArgs(
  view: ObservationPayload,
  operation: "fill" | "click",
  extra: Record<string, unknown>,
): Record<string, unknown> {
  const target = view.targets.find(
    (candidate) =>
      candidate.operation === operation &&
      (operation !== "click" || candidate.description.startsWith("button")),
  );
  if (target === undefined)
    throw new Error(`The observation offers no ${operation} target`);
  return {
    session: view.session,
    observation: view.observation,
    target: target.ref,
    evidence: view.evidence,
    operation,
    ...extra,
  };
}

/** The engine to skip with, or `undefined` when the browser is installed. */
function engineProblem(entries: SessionEntry[]): string | undefined {
  const failed = toolResults(entries).find((entry) => entry.isError);
  if (failed === undefined) return undefined;
  return /browser build is not installed|missing system libraries/i.test(failed.content)
    ? failed.content
    : undefined;
}

it("searches through the configured source and fetches a page as text", async () => {
  const { kernel, model, workspace, dataDir } = await start({
    configFile: {
      search: { provider: "deepseek", baseUrl: webOrigin, apiKey: "search-key" },
    },
    webFetch: {
      // The controlled service is public: the resolver and transport keep the
      // real policy code and point the connection at the test server.
      resolveAddresses: async () => ["93.184.216.34"],
      fetchImpl: ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const target = new URL(input instanceof Request ? input.url : String(input));
        target.hostname = new URL(webOrigin).hostname;
        target.port = new URL(webOrigin).port;
        return fetch(target, init);
      }) as typeof fetch,
    },
    answers: [
      call("call_search", "web_search", { query: "playwright firefox", count: 3 }),
      call("call_fetch", "web_fetch", { url: "http://public.test/page" }),
      // Loopback is refused before any connection is made (SSRF).
      call("call_private", "web_fetch", { url: `${webOrigin}/admin` }),
      { text: ["Done."] },
    ],
  });
  const sessionId = await createSession(kernel.url, workspace);
  await send(kernel.url, sessionId, "look this up");

  await waitForTaskEnd(kernel.url, sessionId);
  const results = toolResults(await readSessionLog(dataDir, sessionId));
  expect(results.map((entry) => entry.isError)).toEqual([false, false, true]);
  // The preset tools are announced to the model in the same request.
  expect(model.requests[0]?.tools?.map((tool) => tool.function.name)).toEqual(
    expect.arrayContaining(["web_search", "web_fetch", "browser_open", "skill"]),
  );

  // The search ran against the configured source and reported its results.
  expect(results[0]!.content).toContain("Playwright browsers");
  expect(results[0]!.content).toContain("http://public.test/page");
  expect(results[0]!.content).toContain(
    "Chromium, Firefox and WebKit are driven by one API.",
  );
  expect(webRequests).toContainEqual({ method: "POST", path: "/v1/tools/search" });

  // The fetch returned the page text, without the script it contains.
  expect(results[1]!.content).toContain("Prism notes");
  expect(results[1]!.content).toContain("Extract this text.");
  expect(results[1]!.content).not.toContain("script text");
  expect(webRequests).toContainEqual({ method: "GET", path: "/page" });

  // A private target is refused, and nothing connected to it.
  expect(results[2]!.content).toContain("not a public address");
  expect(webRequests.some((request) => request.path === "/admin")).toBe(false);
});

const MCP_FIXTURE = fileURLToPath(
  new URL("../mcp/fixtures/stdio-server.mjs", import.meta.url),
);

it("runs a configured MCP server's tools like built-ins, outside the scope", async () => {
  const { kernel, model, workspace, dataDir } = await start({
    // MCP tools declare no effects, so even the read-only scope runs them.
    scope: "read-only",
    mcpConfig: {
      mcpServers: {
        demo: {
          transport: "stdio",
          command: process.execPath,
          args: [MCP_FIXTURE, "serve"],
        },
      },
    },
    answers: [
      call("call_mcp", "mcp__demo__echo", { text: "through the kernel" }),
      call("call_missing", "mcp__demo__explode", {}),
      { text: ["Done."] },
    ],
  });
  const events = await connectEvents(`${kernel.url}/events`);
  const sessionId = await createSession(kernel.url, workspace);
  await send(kernel.url, sessionId, "use the external tool");
  await waitForTaskEnd(kernel.url, sessionId);

  expect(model.requests[0]?.tools?.map((tool) => tool.function.name)).toContain(
    "mcp__demo__echo",
  );
  const results = toolResults(await readSessionLog(dataDir, sessionId));
  expect(results[0]!.content).toBe("echo: through the kernel");
  expect(results[0]!.isError).toBe(false);
  // A tool that throws becomes a result for the model, not a broken task.
  expect(results[1]!.isError).toBe(true);
  expect(results[1]!.content).toContain("tool exploded");
  // No MCP call asked for approval: the three scopes do not cover them.
  expect(events.events.some((event) => event.type === "approval.requested")).toBe(
    false,
  );
  events.close();
});

it("keeps serving when an MCP server or its configuration is broken", async () => {
  const { kernel, model, workspace, dataDir } = await start({
    mcpConfig: {
      mcpServers: {
        good: {
          transport: "stdio",
          command: process.execPath,
          args: [MCP_FIXTURE, "serve"],
        },
        broken: {
          transport: "stdio",
          command: process.execPath,
          args: [MCP_FIXTURE, "crash"],
        },
      },
    },
    answers: [call("call_good", "mcp__good__echo", { text: "still here" })],
  });
  const sessionId = await createSession(kernel.url, workspace);
  await send(kernel.url, sessionId, "use the working server");
  await waitForTaskEnd(kernel.url, sessionId);

  const results = toolResults(await readSessionLog(dataDir, sessionId));
  expect(results[0]!.content).toBe("echo: still here");
  expect(model.requests[0]?.tools?.map((tool) => tool.function.name)).toEqual(
    expect.arrayContaining(["mcp__good__echo"]),
  );
  expect(model.requests[0]?.tools?.map((tool) => tool.function.name)).not.toEqual(
    expect.arrayContaining([expect.stringContaining("mcp__broken__")]),
  );

  // A malformed configuration is reported without taking the kernel down.
  const malformed = await startTestKernel({
    mcpConfig: { mcpServers: { broken: { transport: "carrier-pigeon" } } },
  });
  try {
    await expect(api(malformed.kernel.url, "/status")).resolves.toMatchObject({
      status: 200,
      body: { status: "ready" },
    });
  } finally {
    await malformed.cleanup();
  }
});

it("discovers the preset prism skill and loads its instructions on demand", async () => {
  const { kernel, model, workspace, dataDir } = await start({
    // The skills shipped with Prism resolve like they do in a user install.
    bundledSkills: "package",
    answers: [
      call("call_list", "skill", {}),
      call("call_read", "skill", { name: "prism" }),
      { text: ["Read it."] },
    ],
  });
  const sessionId = await createSession(kernel.url, workspace);
  await send(kernel.url, sessionId, "how do I drive a browser?");
  await waitForTaskEnd(kernel.url, sessionId);

  // The prompt names the skill so the model can choose it.
  expect(model.requests[0]?.messages[0]?.content).toContain("- prism:");
  // Without an mcp.json, the kernel connects no servers and registers no MCP tools.
  expect(
    model.requests[0]?.tools?.some((tool) => tool.function.name.startsWith("mcp__")),
  ).toBe(false);
  const results = toolResults(await readSessionLog(dataDir, sessionId));
  expect(results[0]!.content).toContain("prism (bundled)");
  // The body the kernel served is the skill file shipped with Prism.
  const shipped = await readFile(
    fileURLToPath(new URL("../../skills/prism/SKILL.md", import.meta.url)),
    "utf8",
  );
  const body = shipped.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "").trim();
  expect(results[1]!.content).toBe(body);
});

it("compacts a long session, loads nested instructions and keeps memory across sessions", async () => {
  const { kernel, model, workspace, home, dataDir } = await start({
    compaction: { triggerTokens: 300, keepTokens: 100 },
    answers: [
      call("call_read", "read_file", { path: "src/note.txt" }),
      { text: ["SUMMARY: the release note in src/note.txt was read."] },
      { text: ["Read the note."] },
      { text: ["Fresh session, nothing to add."] },
    ],
  });
  // Instructions at every level the kernel reads: global, ancestor, workspace.
  await mkdir(join(home, ".agents"), { recursive: true });
  await writeFile(
    join(home, ".agents", "AGENTS.md"),
    "Global rule: answer in the user's language.",
    "utf8",
  );
  await writeFile(
    join(dirname(workspace), "AGENTS.md"),
    "Ancestor rule: keep each change small.",
    "utf8",
  );
  await writeFile(
    join(workspace, "AGENTS.md"),
    "Workspace rule: run pnpm test before reporting.",
    "utf8",
  );
  await mkdir(join(workspace, "src"), { recursive: true });
  await writeFile(
    join(workspace, "src", "AGENTS.md"),
    "Nested rule: the release note lives in src/note.txt.",
    "utf8",
  );
  await writeFile(join(workspace, "src", "note.txt"), NOTE, "utf8");

  const events = await connectEvents(`${kernel.url}/events`);
  const sessionId = await createSession(kernel.url, workspace);
  await send(kernel.url, sessionId, "read the notes and continue");
  await waitForTaskEnd(kernel.url, sessionId);

  // The long file pushed the context over the trigger; the kernel summarized it.
  await expect(
    events.waitFor((event) => event.type === "session.compacted"),
  ).resolves.toMatchObject({ sessionId, reason: "auto" });
  events.close();

  // The instructions reached the model outermost first, before anything was read.
  const first = model.requests[0]!.messages[0]!.content ?? "";
  expect(first).toContain("Global rule: answer in the user's language.");
  expect(first).toContain("Ancestor rule: keep each change small.");
  expect(first).toContain("Workspace rule: run pnpm test before reporting.");
  expect(first).not.toContain("Nested rule: the release note lives");
  expect(first.indexOf("Global rule")).toBeLessThan(first.indexOf("Workspace rule"));

  // The summary is written by the session model, in a request of its own.
  expect(model.requests[1]!.tools).toBeUndefined();
  expect(model.requests[1]!.messages[0]!.content).toMatch(/summari[sz]e/i);

  // The next round continues from the summary; the replaced turn is gone from
  // the context but stays in the log, and the nested file joined the prompt.
  const continued = model.requests[2]!.messages;
  const context = continued.map((message) => message.content ?? "").join("\n");
  expect(context).toContain("SUMMARY: the release note in src/note.txt was read.");
  expect(context).not.toContain("read the notes and continue");
  expect(context).toContain("Nested rule: the release note lives in src/note.txt.");
  expect(
    continued.some(
      (message) =>
        message.role === "system" &&
        (message.content ?? "").includes("Instructions discovered at"),
    ),
  ).toBe(true);

  const entries = await readSessionLog(dataDir, sessionId);
  expect(
    entries
      .filter((entry) => entry.type === "compaction")
      .map((entry) => entry.summary),
  ).toEqual(["SUMMARY: the release note in src/note.txt was read."]);
  expect(entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "message",
        role: "user",
        content: "read the notes and continue",
      }),
      expect.objectContaining({
        type: "tool_result",
        content: expect.stringContaining("The release note"),
      }),
    ]),
  );

  // A new session in the same workspace starts from the project instructions
  // without inheriting the old conversation.
  const second = await createSession(kernel.url, workspace);
  await send(kernel.url, second, "where are we?");
  await waitForTaskEnd(kernel.url, second);
  const secondPrompt = model.requests.at(-1)!.messages[0]!.content ?? "";
  expect(secondPrompt).toContain("Workspace rule: run pnpm test before reporting.");
  expect(secondPrompt).not.toContain("SUMMARY: the release note");
});

for (const engine of BROWSER_ENGINES) {
  it(`drives a real ${engine} page through open, observe, act and receipt`, async ({
    skip,
  }) => {
    const { kernel, model, workspace, dataDir } = await start({
      configFile: { browser: { engine } },
      answers: [
        call("call_open", "browser_open", { url: pageUrl }),
        callFrom<{ session: string }>(
          "call_observe",
          "browser_observe",
          "call_open",
          (opened) => ({ session: opened.session }),
        ),
        callFrom<ObservationPayload>(
          "call_fill",
          "browser_act",
          "call_observe",
          (view) =>
            actArgs(view, "fill", { value: "note text", request_id: "e2e-fill" }),
        ),
        callFrom<ActPayload>("call_click", "browser_act", "call_fill", (acted) =>
          actArgs(observed(acted), "click", { request_id: "e2e-click" }),
        ),
        callFrom<ActPayload>(
          "call_receipt",
          "browser_receipt",
          "call_click",
          (acted) => ({
            session: observed(acted).session,
            request_id: "e2e-click",
          }),
        ),
        { text: ["Saved the note."] },
      ],
    });
    const sessionId = await createSession(kernel.url, workspace);
    await send(kernel.url, sessionId, "fill the form and save");
    await waitForTaskEnd(kernel.url, sessionId);

    const entries = await readSessionLog(dataDir, sessionId);
    const problem = engineProblem(entries);
    if (problem !== undefined) skip(`${engine} is unavailable: ${problem}`);

    const results = toolResults(entries);
    expect(results.map((entry) => entry.isError)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    const view = JSON.parse(results[1]!.content) as ObservationPayload;
    expect(view.page.title).toBe("Prism end-to-end");
    const filled = JSON.parse(results[2]!.content) as ActPayload;
    expect(filled.receipt).toMatchObject({
      outcome: "executed",
      code: "INPUT_ACKNOWLEDGED",
    });
    const clicked = JSON.parse(results[3]!.content) as ActPayload;
    expect(clicked.receipt).toMatchObject({
      outcome: "executed",
      code: "INPUT_ACKNOWLEDGED",
    });
    // The page itself reported the new state, so the click really happened.
    expect(observed(clicked).state.messages).toEqual(
      expect.arrayContaining([{ role: "status", text: "Saved note text" }]),
    );
    // The receipt is readable after the action, by its request id.
    const receipt = JSON.parse(results[4]!.content) as {
      request_id: string;
      outcome: string;
      code: string;
    };
    expect(receipt).toMatchObject({
      request_id: "e2e-click",
      outcome: "executed",
      code: "INPUT_ACKNOWLEDGED",
    });
    expect(model.requests.length).toBeGreaterThanOrEqual(5);
    expect(entries.at(-1)).toMatchObject({
      type: "message",
      role: "assistant",
      content: "Saved the note.",
    });
  });
}

it("asks once per browser action and runs nothing the user refused", async () => {
  const { kernel, workspace, dataDir } = await start({
    browserActionsNeedApproval: true,
    answers: [
      call("call_open", "browser_open", { url: pageUrl }),
      callFrom<{ session: string }>(
        "call_observe",
        "browser_observe",
        "call_open",
        (opened) => ({ session: opened.session }),
      ),
      callFrom<ObservationPayload>("call_fill", "browser_act", "call_observe", (view) =>
        actArgs(view, "fill", { value: "note text", request_id: "e2e-fill" }),
      ),
      callFrom<ActPayload>("call_refused", "browser_act", "call_fill", (acted) =>
        actArgs(observed(acted), "click", { request_id: "e2e-refused-click" }),
      ),
      // The refused click never ran, so the observation it was based on is
      // still valid; the script takes it from the fill result again.
      callFrom<ActPayload>("call_click", "browser_act", "call_fill", (acted) =>
        actArgs(observed(acted), "click", { request_id: "e2e-click" }),
      ),
      { text: ["Done."] },
    ],
  });
  const events = await connectEvents(`${kernel.url}/events`);
  const sessionId = await createSession(kernel.url, workspace);
  await send(kernel.url, sessionId, "fill the form and save");

  const answer = async (
    tool: string,
    approved: boolean,
  ): Promise<{ requestId: string }> => {
    const requested = await events.waitFor(
      (event) =>
        event.type === "approval.requested" && "tool" in event && event.tool === tool,
    );
    if (requested.type !== "approval.requested")
      throw new Error("Expected an approval request");
    expect(requested.reason).toContain("approval");
    expect(requested.target).toContain(pageUrl);
    const response = await api(
      kernel.url,
      `/sessions/${sessionId}/approvals/${requested.requestId}`,
      { method: "POST", body: { approved } },
    );
    expect(response.status).toBe(200);
    return { requestId: requested.requestId };
  };

  const opened = await answer("browser_open", true);
  await events.waitFor(
    (event) => event.type === "tool.completed" && event.callId === "call_open",
  );
  await answer("browser_act", true);
  await events.waitFor(
    (event) => event.type === "tool.completed" && event.callId === "call_fill",
  );
  const refused = await answer("browser_act", false);
  await events.waitFor(
    (event) => event.type === "tool.failed" && event.callId === "call_refused",
  );
  await answer("browser_act", true);
  await waitForTaskEnd(kernel.url, sessionId);

  // Every request was answered exactly once, in the order the tools ran.
  const requests = events.events.filter((event) => event.type === "approval.requested");
  expect(requests).toHaveLength(4);
  expect(
    events.events.filter((event) => event.type === "approval.resolved"),
  ).toMatchObject([
    { requestId: opened.requestId, approved: true },
    { approved: true },
    { requestId: refused.requestId, approved: false },
    { approved: true },
  ]);

  const results = toolResults(await readSessionLog(dataDir, sessionId));
  expect(results.map((entry) => entry.isError)).toEqual([
    false,
    false,
    false,
    true,
    false,
  ]);
  // The model read a refusal it must not retry, and the page did not move.
  expect(results[3]!.content).toContain("refused");
  expect(results[3]!.content).toContain("not executed");
  const clicked = JSON.parse(results[4]!.content) as ActPayload;
  expect(observed(clicked).state.messages).toEqual(
    expect.arrayContaining([{ role: "status", text: "Saved note text" }]),
  );
  events.close();
});
