import type { IncomingMessage, ServerResponse } from "node:http";
import type { PrismConfig } from "./config.ts";
import type { KernelEvent } from "./events.ts";
import type { Tool } from "./tool.ts";
import type { SkillToolRoots } from "./tools.ts";
import type { PermissionScope } from "./types.ts";
import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import {
  Kernel,
  KernelError,
  type KernelSettings,
  type KernelStatusReport,
} from "./kernel.ts";
import { SessionStoreError } from "./session-store.ts";

/** Cap on request bodies; the workbench sends small JSON documents. */
const MAX_BODY_BYTES = 1_000_000;
const KEEP_ALIVE_MS = 15_000;

export interface KernelServerOptions {
  config: PrismConfig;
  /** 0 (default) lets the operating system pick a free port. */
  port?: number;
  scope?: PermissionScope;
  tools?: Tool[];
  skillRoots?: SkillToolRoots;
}

export interface RunningKernel {
  url: string;
  port: number;
  kernel: Kernel;
  /** Stops the transport, cancels running tasks and releases the port. */
  close: () => Promise<void>;
}

/** Serves the kernel over HTTP with its event stream on `GET /events`. */
export async function startKernel(
  options: KernelServerOptions,
): Promise<RunningKernel> {
  const kernel = new Kernel(options);
  const clients = new Set<ServerResponse>();
  const unsubscribe = kernel.subscribe((event) => {
    for (const client of clients) writeEvent(client, event);
  });
  let closed = false;

  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      sendError(response, error);
    });
  });
  server.on("clientError", (_error, socket) => {
    socket.destroy();
  });

  const keepAlive = setInterval(() => {
    for (const client of clients) client.write(": keep-alive\n\n");
  }, KEEP_ALIVE_MS);
  keepAlive.unref();

  async function stop(): Promise<void> {
    if (closed) return;
    closed = true;
    clearInterval(keepAlive);
    kernel.status = "stopping";
    kernel.emit(kernel.statusEvent());
    unsubscribe();
    for (const client of clients) client.end();
    clients.clear();
    await kernel.close();
    const draining = new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeAllConnections();
    await draining;
  }

  async function handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const segments = url.pathname.split("/").filter((segment) => segment !== "");
    const method = request.method ?? "GET";

    if (segments[0] === "status" && segments.length === 1 && method === "GET") {
      sendJson(response, 200, kernel.statusReport() satisfies KernelStatusReport);
      return;
    }
    if (segments[0] === "settings" && segments.length === 1 && method === "GET") {
      sendJson(response, 200, kernel.settings() satisfies KernelSettings);
      return;
    }
    if (segments[0] === "events" && segments.length === 1 && method === "GET") {
      openStream(response);
      return;
    }
    if (segments[0] === "shutdown" && segments.length === 1 && method === "POST") {
      sendJson(response, 202, { stopping: true });
      response.once("finish", () => void stop());
      return;
    }
    if (segments[0] === "sessions" && segments.length === 1) {
      if (method === "GET") {
        const workspace = url.searchParams.get("workspace");
        sendJson(response, 200, {
          sessions: await kernel.listSessions(workspace === null ? {} : { workspace }),
        });
        return;
      }
      if (method === "POST") {
        const body = await readJson(request);
        const workspace = requireText(body, "workspace");
        const title = optionalText(body, "title");
        sendJson(response, 201, {
          session: await kernel.createSession(
            title === undefined ? { workspace } : { workspace, title },
          ),
        });
        return;
      }
    }
    if (segments[0] === "sessions" && segments.length >= 2) {
      const sessionId = decodeURIComponent(segments[1] as string);
      if (segments.length === 2 && method === "GET") {
        sendJson(response, 200, await kernel.readSession(sessionId));
        return;
      }
      if (segments.length === 2 && method === "DELETE") {
        await kernel.deleteSession(sessionId);
        sendJson(response, 200, { deleted: true });
        return;
      }
      if (segments[2] === "messages" && segments.length === 3 && method === "POST") {
        const body = await readJson(request);
        const entryId = await kernel.sendMessage(sessionId, requireText(body, "text"));
        sendJson(response, 202, { entryId });
        return;
      }
      if (segments[2] === "cancel" && segments.length === 3 && method === "POST") {
        sendJson(response, 200, { cancelled: kernel.cancelSession(sessionId) });
        return;
      }
      if (
        segments[2] === "approvals" &&
        segments.length === 4 &&
        method === "POST" &&
        segments[3] !== undefined
      ) {
        const body = await readJson(request);
        const approved = requireBoolean(body, "approved");
        const resolved = kernel.resolveApproval(
          sessionId,
          decodeURIComponent(segments[3]),
          approved,
        );
        if (!resolved)
          throw new KernelError(
            "APPROVAL_NOT_FOUND",
            "That approval was already answered, expired or never existed",
          );
        sendJson(response, 200, { approved });
        return;
      }
    }
    throw new KernelError("INVALID_REQUEST", `Unknown route ${method} ${url.pathname}`);
  }

  function openStream(response: ServerResponse): void {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    response.write("retry: 2000\n\n");
    clients.add(response);
    writeEvent(response, kernel.statusEvent());
    response.on("close", () => clients.delete(response));
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await stop();
    throw new Error("Kernel did not bind a TCP port");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    port: address.port,
    kernel,
    close: stop,
  };
}

function writeEvent(response: ServerResponse, event: KernelEvent): void {
  response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function sendError(response: ServerResponse, error: unknown): void {
  const { status, code } = classify(error);
  if (status >= 500) console.error("Kernel request failed:", error);
  if (response.headersSent) {
    response.end();
    return;
  }
  sendJson(response, status, {
    error: { code, message: error instanceof Error ? error.message : String(error) },
  });
}

function classify(error: unknown): { status: number; code: string } {
  if (error instanceof KernelError)
    return {
      status: {
        INVALID_REQUEST: 400,
        SESSION_NOT_FOUND: 404,
        APPROVAL_NOT_FOUND: 404,
        TASK_RUNNING: 409,
      }[error.code],
      code: error.code,
    };
  if (error instanceof SessionStoreError)
    return {
      status: { SESSION_NOT_FOUND: 404, INVALID_INPUT: 400, INVALID_SESSION_LOG: 500 }[
        error.code
      ],
      code: error.code,
    };
  return { status: 500, code: "INTERNAL_ERROR" };
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk.toString();
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES)
      throw new KernelError("INVALID_REQUEST", "Request body is too large");
  }
  if (raw.trim() === "") return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new KernelError("INVALID_REQUEST", "Request body is not valid JSON");
  }
}

function field(body: unknown, key: string): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body))
    return undefined;
  return (body as Record<string, unknown>)[key];
}

function requireText(body: unknown, key: string): string {
  const value = field(body, key);
  if (typeof value !== "string" || value.trim() === "")
    throw new KernelError("INVALID_REQUEST", `"${key}" must be a non-empty string`);
  return value;
}

function optionalText(body: unknown, key: string): string | undefined {
  const value = field(body, key);
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim() === "")
    throw new KernelError("INVALID_REQUEST", `"${key}" must be a non-empty string`);
  return value;
}

function requireBoolean(body: unknown, key: string): boolean {
  const value = field(body, key);
  if (typeof value !== "boolean")
    throw new KernelError("INVALID_REQUEST", `"${key}" must be a boolean`);
  return value;
}
