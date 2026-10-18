import type { Buffer } from "node:buffer";
import type { Server } from "node:http";
import type { CommandConfig, CompactionConfig } from "../../src/kernel/config.ts";
import type { KernelEvent } from "../../src/kernel/events.ts";
import type { SessionEntry } from "../../src/kernel/session.ts";
import type { Tool } from "../../src/kernel/tool.ts";
import type { PermissionScope } from "../../src/kernel/types.ts";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/kernel/config.ts";
import { type RunningKernel, startKernel } from "../../src/kernel/server.ts";

/** One scripted `/chat/completions` answer, consumed in order by the fake model. */
export interface FakeAnswer {
  /** Text deltas the model streams, in order. */
  text?: string[];
  /** Tool calls the model asks for after the text; `arguments` is JSON text. */
  toolCalls?: { id: string; name: string; arguments: string }[];
  /** Reply with this HTTP status instead of a stream. */
  status?: number;
  /** Keep the stream open after the deltas until the client aborts. */
  hold?: boolean;
}

export interface ModelRequest {
  model: string;
  stream?: boolean;
  messages: {
    role: string;
    content: string | null;
    tool_calls?: {
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }[];
    tool_call_id?: string;
  }[];
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
  close: () => Promise<void>;
}

function sseChunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/**
 * A scripted OpenAI-compatible model: one answer per request. Tool call
 * arguments arrive in two fragments, so tests exercise assembly.
 */
export async function startFakeModel(answers: FakeAnswer[]): Promise<FakeModel> {
  const remaining = [...answers];
  const requests: ModelRequest[] = [];
  const server: Server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk: Buffer) => {
      raw += chunk.toString();
    });
    request.on("end", () => {
      requests.push(JSON.parse(raw) as ModelRequest);
      const answer = remaining.shift() ?? { text: [] };
      response.on("error", () => {});
      if (answer.status !== undefined) {
        response.writeHead(answer.status, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "scripted failure" } }));
        return;
      }
      response.writeHead(200, { "content-type": "text/event-stream" });
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
    tools?: Tool[];
    scope?: PermissionScope;
    workspace?: string;
    /** Overrides for `compaction` in the kernel config. */
    compaction?: Partial<CompactionConfig>;
    /** Overrides for `command` in the kernel config. */
    command?: Partial<CommandConfig>;
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
  ]);
  const model = await startFakeModel(options.answers ?? []);
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
    ...(options.scope === undefined ? {} : { scope: options.scope }),
    ...(options.tools === undefined ? {} : { tools: options.tools }),
    skillRoots: { home, bundled },
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
