import type { Buffer } from "node:buffer";
import type { Server } from "node:http";
import type { CommandConfig, CompactionConfig } from "../../src/kernel/config.ts";
import type { KernelEvent } from "../../src/kernel/events.ts";
import type { ChatContentPart } from "../../src/kernel/model.ts";
import type { SessionEntry } from "../../src/kernel/session.ts";
import type { Tool } from "../../src/kernel/tool.ts";
import type { SkillToolRoots } from "../../src/kernel/tools.ts";
import type { PermissionScope } from "../../src/kernel/types.ts";
import type { WebFetchOverrides } from "../../src/kernel/web-tools.ts";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/kernel/config.ts";
import { type RunningKernel, startKernel } from "../../src/kernel/server.ts";
import { SESSION_TITLE_PROMPT } from "../../src/kernel/session-title.ts";
import { readString } from "../../src/kernel/tool-support.ts";

/**
 * Stands in for a tool with no side effect: the tests use it to drive the loop
 * without touching the workspace. The production kernel does not ship it.
 */
export const echoTool: Tool = {
  name: "echo",
  description: "Returns the given text unchanged. Test double for the task loop.",
  parameters: {
    type: "object",
    properties: { text: { type: "string", description: "Text to return." } },
    required: ["text"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const text = readString(args, "text");
    if (text === undefined)
      return { content: 'The "text" argument must be a string.', isError: true };
    return { content: text };
  },
};

/** One scripted `/chat/completions` answer, consumed in order by the fake model. */
export interface FakeAnswer {
  /** Thinking deltas streamed before the text. */
  reasoning?: string[];
  /** Text deltas the model streams, in order. */
  text?: string[];
  /** Tool calls the model asks for after the text; `arguments` is JSON text. */
  toolCalls?: { id: string; name: string; arguments: string }[];
  /** Reply with this HTTP status instead of a stream. */
  status?: number;
  /** Keep the stream open after the deltas until the client aborts. */
  hold?: boolean;
  /**
   * Computes this answer from the request, for scripts that must read a
   * previous tool result (for example, a browser target reference).
   */
  respond?: (request: ModelRequest) => {
    text?: string[];
    toolCalls?: { id: string; name: string; arguments: string }[];
  };
}

export interface ModelRequest {
  model: string;
  stream?: boolean;
  /** Effort the client asked for; thinking stays enabled for every level. */
  reasoning_effort?: string;
  messages: ({
    reasoning_content?: string;
    tool_calls?: {
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }[];
    tool_call_id?: string;
  } & (
    | { role: "user"; content: string | ChatContentPart[] }
    | { role: "system"; content: string | null }
    | { role: "assistant"; content: string | null }
    | { role: "tool"; content: string }
  ))[];
  tools?: {
    type: string;
    function: { name: string; description: string; parameters: unknown };
  }[];
}

export interface FakeModel {
  /** Base URL to configure as the model endpoint. */
  baseUrl: string;
  /** Request bodies the model received, in order. */
  requests: ModelRequest[];
  titleRequests: ModelRequest[];
  close: () => Promise<void>;
}

function sseChunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/**
 * A scripted OpenAI-compatible model: one answer per request. Tool call
 * arguments arrive in two fragments, so tests exercise assembly.
 */
export async function startFakeModel(
  answers: FakeAnswer[],
  titleAnswer: FakeAnswer = { text: ["处理当前任务"] },
): Promise<FakeModel> {
  const remaining = [...answers];
  const requests: ModelRequest[] = [];
  const titleRequests: ModelRequest[] = [];
  const server: Server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk: Buffer) => {
      raw += chunk.toString();
    });
    request.on("end", () => {
      const parsed = JSON.parse(raw) as ModelRequest;
      const naming = parsed.messages[0]?.content === SESSION_TITLE_PROMPT;
      (naming ? titleRequests : requests).push(parsed);
      const scripted = naming ? titleAnswer : (remaining.shift() ?? { text: [] });
      let answer: FakeAnswer;
      try {
        answer =
          scripted.respond === undefined
            ? scripted
            : { ...scripted, ...(scripted.respond(parsed) ?? {}) };
      } catch (error) {
        // A script that cannot read the previous result fails the request like
        // a real model error would, instead of hanging the loop.
        response.writeHead(500, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            error: { message: `scripted answer failed: ${String(error)}` },
          }),
        );
        return;
      }
      response.on("error", () => {});
      if (answer.status !== undefined) {
        response.writeHead(answer.status, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "scripted failure" } }));
        return;
      }
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const delta of answer.reasoning ?? [])
        response.write(
          sseChunk({ choices: [{ delta: { reasoning_content: delta } }] }),
        );
      for (const delta of answer.text ?? [])
        response.write(sseChunk({ choices: [{ delta: { content: delta } }] }));
      for (const [index, call] of (answer.toolCalls ?? []).entries()) {
        const head = call.arguments.slice(0, 4);
        const tail = call.arguments.slice(4);
        response.write(
          sseChunk({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index,
                      id: call.id,
                      type: "function",
                      function: { name: call.name, arguments: head },
                    },
                  ],
                },
              },
            ],
          }),
        );
        if (tail !== "")
          response.write(
            sseChunk({
              choices: [
                { delta: { tool_calls: [{ index, function: { arguments: tail } }] } },
              ],
            }),
          );
      }
      if (answer.hold) return;
      response.write(
        sseChunk({
          choices: [
            {
              delta: {},
              finish_reason:
                (answer.toolCalls?.length ?? 0) > 0 ? "tool_calls" : "stop",
            },
          ],
        }),
      );
      response.write("data: [DONE]\n\n");
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Fake model did not listen");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    titleRequests,
    close: async () => {
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      await closed;
    },
  };
}

export interface EventStream {
  /** Every event received so far, in arrival order. */
  events: KernelEvent[];
  /** Resolves with the next unconsumed event matching `predicate`. */
  waitFor: (
    predicate: (event: KernelEvent) => boolean,
    timeoutMs?: number,
  ) => Promise<KernelEvent>;
  close: () => void;
}

/** Reads `/events` the way the workbench does: SSE over one long-lived response. */
export async function connectEvents(url: string): Promise<EventStream> {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  if (!response.ok || response.body === null)
    throw new Error(`Event stream refused with HTTP ${response.status}`);
  const events: KernelEvent[] = [];
  let cursor = 0;
  const stream = response.body;
  const waiters: {
    predicate: (event: KernelEvent) => boolean;
    resolve: (event: KernelEvent) => void;
    timer: NodeJS.Timeout;
  }[] = [];
  void (async () => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
          const data = frame
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice("data:".length).trim())
            .join("\n");
          if (data === "") continue;
          const index = events.push(JSON.parse(data) as KernelEvent) - 1;
          for (const waiter of [...waiters])
            if (waiter.predicate(events[index] as KernelEvent)) {
              clearTimeout(waiter.timer);
              waiters.splice(waiters.indexOf(waiter), 1);
              cursor = Math.max(cursor, index + 1);
              waiter.resolve(events[index] as KernelEvent);
            }
        }
      }
    } catch {
      // Aborted by the test, or the kernel shut down.
    } finally {
      for (const waiter of waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.resolve(events.at(-1) as KernelEvent);
      }
    }
  })();

  return {
    events,
    waitFor: (predicate, timeoutMs = 5_000) => {
      const seen = events.slice(cursor).find(predicate);
      if (seen !== undefined) {
        cursor = events.indexOf(seen) + 1;
        return Promise.resolve(seen);
      }
      cursor = events.length;
      return new Promise<KernelEvent>((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new Error(
                `Timed out waiting for an event; saw ${JSON.stringify(events)}`,
              ),
            ),
          timeoutMs,
        );
        waiters.push({ predicate, resolve, timer });
      });
    },
    close: () => controller.abort(),
  };
}

export interface ApiResponse<T> {
  status: number;
  body: T;
}

/** One JSON request against the kernel, the way the workbench sends it. */
export async function api<T = unknown>(
  url: string,
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<ApiResponse<T>> {
  const response = await fetch(`${url}${path}`, {
    method: options.method ?? "GET",
    headers: options.body === undefined ? {} : { "content-type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = (await response.json().catch(() => null)) as T;
  return { status: response.status, body };
}

export interface KernelHarness {
  kernel: RunningKernel;
  model: FakeModel;
  workspace: string;
  dataDir: string;
  home: string;
  cleanup: () => Promise<void>;
}
/** The session log as it sits on disk, the way the workbench would replay it. */
export async function readSessionLog(
  dataDir: string,
  sessionId: string,
): Promise<SessionEntry[]> {
  const root = join(dataDir, "sessions");
  for (const directory of await readdir(root)) {
    try {
      const lines = (
        await readFile(join(root, directory, `${sessionId}.jsonl`), "utf8")
      )
        .split("\n")
        .filter((line) => line !== "");
      return lines.slice(1).map((line) => JSON.parse(line) as SessionEntry);
    } catch {
      // Not this workspace directory.
    }
  }
  throw new Error(`Session ${sessionId} was not written under ${root}`);
}

export async function startTestKernel(
  options: {
    answers?: FakeAnswer[];
    titleAnswer?: FakeAnswer;
    tools?: Tool[];
    scope?: PermissionScope;
    browserActionsNeedApproval?: boolean;
    /** Written to `<dataDir>/config.json` before the kernel loads it. */
    configFile?: Record<string, unknown>;
    /** Written to `<dataDir>/mcp.json` before the kernel loads it. */
    mcpConfig?: unknown;
    workspace?: string;
    /** Overrides for `compaction` in the kernel config. */
    compaction?: Partial<CompactionConfig>;
    /** Overrides for `command` in the kernel config. */
    command?: Partial<CommandConfig>;
    /** Overrides the skill roots entirely; otherwise the temporary roots apply. */
    skillRoots?: SkillToolRoots;
    /** `package`: resolve the skills shipped with Prism, as a user install does. */
    bundledSkills?: "empty" | "package";
    /** Test seam: transport overrides for a controlled HTTP service. */
    webFetch?: WebFetchOverrides;
    bundledPlugins?: string | false;
  } = {},
): Promise<KernelHarness> {
  const base = await mkdtemp(join(tmpdir(), "prism-kernel-"));
  const workspace = options.workspace ?? join(base, "workspace");
  const home = join(base, "home");
  const bundled = join(base, "bundled-skills");
  const dataDir = join(base, "data");
  await Promise.all([
    mkdir(workspace, { recursive: true }),
    mkdir(home, { recursive: true }),
    mkdir(bundled, { recursive: true }),
    mkdir(dataDir, { recursive: true }),
  ]);
  if (options.configFile !== undefined)
    await writeFile(
      join(dataDir, "config.json"),
      JSON.stringify(options.configFile),
      "utf8",
    );
  if (options.mcpConfig !== undefined)
    await writeFile(
      join(dataDir, "mcp.json"),
      JSON.stringify(options.mcpConfig),
      "utf8",
    );
  const model = await startFakeModel(options.answers ?? [], options.titleAnswer);
  const config = await loadConfig({
    dataDir,
    overrides: {
      model: { baseUrl: model.baseUrl, model: "scripted-model", apiKey: "test-key" },
      ...(options.compaction === undefined ? {} : { compaction: options.compaction }),
      ...(options.command === undefined ? {} : { command: options.command }),
    },
  });
  const kernel = await startKernel({
    config,
    bundledPlugins: options.bundledPlugins ?? false,
    ...(options.scope === undefined ? {} : { scope: options.scope }),
    ...(options.browserActionsNeedApproval === undefined
      ? {}
      : { browserActionsNeedApproval: options.browserActionsNeedApproval }),
    tools: [echoTool, ...(options.tools ?? [])],
    ...(options.webFetch === undefined ? {} : { webFetch: options.webFetch }),
    skillRoots: options.skillRoots ?? {
      home,
      ...(options.bundledSkills === "package" ? {} : { bundled }),
    },
    instructionRoots: { home },
  });
  return {
    kernel,
    model,
    workspace,
    dataDir,
    home,
    cleanup: async () => {
      await kernel.close();
      await model.close();
      await rm(base, { recursive: true, force: true });
    },
  };
}
