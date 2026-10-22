import type { IncomingMessage, ServerResponse } from "node:http";
import type { PrismConfig } from "./config.ts";
import type { KernelEvent } from "./events.ts";
import type { InstructionRoots } from "./instructions.ts";
import type { Tool } from "./tool.ts";
import type { SkillToolRoots } from "./tools.ts";
import type { BrowserEngine, PermissionScope } from "./types.ts";
import type { WebFetchOverrides } from "./web-tools.ts";
import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import { KernelError } from "./errors.ts";
import { EventJournal } from "./event-stream.ts";
import {
  Kernel,
  type KernelSettings,
  type KernelStatusReport,
  type SettingsPatch,
} from "./kernel.ts";
import { assertPluginUi, pluginHostRequest } from "./plugin-host.ts";
import { SessionStoreError } from "./session-store.ts";
import {
  BROWSER_ENGINES,
  isBrowserEngine,
  isPermissionScope,
  isThinkingEffort,
  PERMISSION_SCOPES,
  THINKING_EFFORTS,
} from "./types.ts";

/** Cap on request bodies; the workbench sends small JSON documents. */
const MAX_BODY_BYTES = 1_000_000;
const KEEP_ALIVE_MS = 15_000;

export interface KernelServerOptions {
  config: PrismConfig;
  /** 0 (default) lets the operating system pick a free port. */
  port?: number;
  scope?: PermissionScope;
  browserActionsNeedApproval?: boolean;
  tools?: Tool[];
  skillRoots?: SkillToolRoots;
  instructionRoots?: InstructionRoots;
  /** Test seam: a controlled HTTP service instead of the public network. */
  webFetch?: WebFetchOverrides;
  bundledPlugins?: string | false;
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
  const kernel = await Kernel.create(options);
  const clients = new Set<ServerResponse>();
  const terminalClients = new Set<ServerResponse>();
  const journal = new EventJournal();
  // 订阅内核产生的事件，然后把这些事件通过 SSE 推送给所有已连接的客户端。
  const unsubscribe = kernel.subscribe((event) => {
    const frame = journal.publish(event);
    for (const client of clients) if (!client.writableEnded) client.write(frame);
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
    for (const client of [...clients, ...terminalClients]) {
      if (!client.writableEnded) client.write(": keep-alive\n\n");
    }
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
    for (const client of terminalClients) client.end();
    terminalClients.clear();
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

    if (segments[0] === "plugins" && segments.length >= 3) {
      const plugin = decodeURIComponent(segments[1]!);
      if (segments[2] === "host" && segments.length === 4 && method === "POST") {
        if (!request.headers["content-type"]?.startsWith("application/json"))
          throw new KernelError(
            "INVALID_REQUEST",
            "Host requests require application/json.",
          );
        const body = await readJson(request);
        const controller = new AbortController();
        const abort = (): void => controller.abort();
        response.on("close", abort);
        try {
          sendJson(response, 200, {
            result: await pluginHostRequest(
              kernel,
              plugin,
              segments[3]!,
              requireText(body, "sessionId"),
              field(body, "input"),
              controller.signal,
            ),
          });
        } finally {
          response.off("close", abort);
        }
        return;
      }
      if (segments[2] === "resources") {
        const sessionId = url.searchParams.get("sessionId") ?? "";
        await assertPluginUi(kernel, plugin, sessionId);
        if (segments.length === 3 && method === "POST") {
          const { path: _path, ...resource } = await kernel.ctx.attachments.upload(
            sessionId,
            url.searchParams.get("name") ?? "",
            request,
          );
          sendJson(response, 201, { resource });
          return;
        }
        if (segments.length === 4 && method === "GET") {
          await sendAttachment(sessionId, segments[3]!, response);
          return;
        }
      }
    }

    if (
      segments[0] === "plugins" &&
      segments[1] === "ui" &&
      segments.length === 2 &&
      method === "GET"
    ) {
      sendJson(response, 200, { entries: kernel.ctx.creator.ui() });
      return;
    }
    if (
      segments[0] === "plugins" &&
      segments[2] === "assets" &&
      segments.length >= 6 &&
      method === "GET"
    ) {
      const asset = await kernel.ctx.creator.asset(
        segments[1]!,
        segments[3]!,
        segments[4]!,
        segments.slice(5).map(decodeURIComponent).join("/"),
      );
      response.writeHead(200, {
        "content-type": asset.contentType,
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
        "content-security-policy": asset.contentType.startsWith("text/html")
          ? "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
          : "default-src 'none'; script-src 'self' 'unsafe-eval'; connect-src 'self' data: blob:",
      });
      response.end(asset.content);
      return;
    }
    if (
      segments[0] === "plugins" &&
      segments[2] === "rpc" &&
      segments.length === 4 &&
      method === "POST"
    ) {
      if (!request.headers["content-type"]?.startsWith("application/json"))
        throw new KernelError(
          "INVALID_REQUEST",
          "Plugin requests require application/json.",
        );
      const body = await readJson(request, 21 * 1024 * 1024);
      const controller = new AbortController();
      const abort = (): void => controller.abort();
      response.on("close", abort);
      try {
        sendJson(response, 200, {
          result: await kernel.ctx.creator.request(
            segments[1]!,
            segments[3]!,
            field(body, "input"),
            requireText(body, "sessionId"),
            controller.signal,
          ),
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.name === "PluginError" &&
          "code" in error &&
          "status" in error &&
          typeof error.code === "string" &&
          typeof error.status === "number" &&
          error.status >= 400 &&
          error.status <= 599
        )
          sendJson(response, error.status, {
            error: { code: error.code, message: error.message },
          });
        else throw error;
      } finally {
        response.off("close", abort);
      }
      return;
    }

    if (segments[0] === "status" && segments.length === 1 && method === "GET") {
      sendJson(response, 200, kernel.statusReport() satisfies KernelStatusReport);
      return;
    }
    if (segments[0] === "settings" && segments.length === 1) {
      if (method === "GET") {
        sendJson(response, 200, kernel.settings() satisfies KernelSettings);
        return;
      }
      if (method === "PUT") {
        const body = await readJson(request);
        sendJson(
          response,
          200,
          (await kernel.updateSettings(
            parseSettingsPatch(body),
          )) satisfies KernelSettings,
        );
        return;
      }
    }
    if (segments[0] === "events" && segments.length === 1 && method === "GET") {
      openStream(
        response,
        typeof request.headers["last-event-id"] === "string"
          ? request.headers["last-event-id"]
          : undefined,
      );
      return;
    }
    if (segments[0] === "terminals") {
      if (segments.length === 1 && method === "POST") {
        const body = await readJson(request);
        sendJson(
          response,
          201,
          await kernel.ctx.terminals.open(
            requireText(body, "workspace"),
            dimension(body, "cols"),
            dimension(body, "rows"),
          ),
        );
        return;
      }
      const id = segments[1];
      if (
        id !== undefined &&
        segments.length === 3 &&
        segments[2] === "events" &&
        method === "GET"
      ) {
        const unsubscribeTerminal = kernel.ctx.terminals.subscribe(id, (event) => {
          if (!response.headersSent) {
            response.writeHead(200, {
              "content-type": "text/event-stream",
              "cache-control": "no-cache",
              connection: "keep-alive",
            });
            terminalClients.add(response);
          }
          response.write(`data: ${JSON.stringify(event)}\n\n`);
        });
        const drop = (): void => {
          unsubscribeTerminal();
          terminalClients.delete(response);
        };
        response.on("close", drop);
        response.on("error", drop);
        return;
      }
      if (id !== undefined && segments.length === 3 && method === "POST") {
        const body = await readJson(request);
        if (segments[2] === "input") {
          const data = field(body, "data");
          if (typeof data !== "string" || data.length > 64_000)
            throw new KernelError("INVALID_REQUEST", "终端输入无效。");
          kernel.ctx.terminals.write(id, data);
          sendJson(response, 200, { written: true });
          return;
        }
        if (segments[2] === "resize") {
          kernel.ctx.terminals.resize(
            id,
            dimension(body, "cols"),
            dimension(body, "rows"),
          );
          sendJson(response, 200, { resized: true });
          return;
        }
      }
    }
    if (segments[0] === "plugins" && segments.length === 1) {
      if (method === "GET") {
        sendJson(response, 200, { plugins: kernel.ctx.creator.list() });
        return;
      }
      if (method === "POST") {
        if (!request.headers["content-type"]?.startsWith("application/json"))
          throw new KernelError(
            "INVALID_REQUEST",
            "Plugin requests require application/json.",
          );
        sendJson(response, 200, {
          result: await kernel.ctx.creator.manage(await readJson(request)),
        });
        return;
      }
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
      if (segments.length === 4 && segments[2] === "attachments" && method === "GET") {
        await kernel.ctx.sessions.summary(sessionId);
        await sendAttachment(sessionId, segments[3]!, response);
        return;
      }
      if (segments.length === 3 && segments[2] === "attachments" && method === "POST") {
        await kernel.readSession(sessionId);
        const name = url.searchParams.get("name") ?? "";
        sendJson(response, 201, {
          attachment: await kernel.ctx.attachments.upload(sessionId, name, request),
        });
        return;
      }
      if (segments.length === 2 && method === "GET") {
        sendJson(response, 200, await kernel.readSession(sessionId));
        return;
      }
      if (segments.length === 2 && method === "DELETE") {
        await kernel.deleteSession(sessionId);
        sendJson(response, 200, { deleted: true });
        return;
      }
      if (segments.length === 2 && method === "PATCH") {
        const body = await readJson(request);
        sendJson(response, 200, {
          session: await kernel.renameSession(sessionId, requireText(body, "title")),
        });
        return;
      }
      // 收到 POST /sessions/:id/messages 请求时，内核会调用 sendMessage 方法将消息发送到指定的会话中，并返回一个 entryId，表示消息在会话日志中的唯一标识。
      if (
        (segments[2] === "messages" || segments[2] === "steering") &&
        segments.length === 3 &&
        method === "POST"
      ) {
        const body = await readJson(request);
        const text = field(body, "text");
        const attachments = field(body, "attachments") ?? [];
        if (
          typeof text !== "string" ||
          !Array.isArray(attachments) ||
          !attachments.every((id) => typeof id === "string")
        )
          throw new KernelError("INVALID_REQUEST", "消息需要文本和文件标识列表。");
        const entryId = await (segments[2] === "steering"
          ? kernel.steerSession(sessionId, text, attachments)
          : kernel.sendMessage(sessionId, text, attachments));
        sendJson(response, 202, { entryId });
        return;
      }
      if (segments[2] === "cancel" && segments.length === 3 && method === "POST") {
        sendJson(response, 200, { cancelled: kernel.cancelSession(sessionId) });
        return;
      }
      if (segments[2] === "compact" && segments.length === 3 && method === "POST") {
        sendJson(response, 200, await kernel.compactManually(sessionId));
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

  async function sendAttachment(
    sessionId: string,
    id: string,
    response: ServerResponse,
  ): Promise<void> {
    const {
      attachment: { path: _path, ...resource },
      data,
    } = await kernel.ctx.attachments.content(sessionId, id);
    response.writeHead(200, {
      "content-type": resource.mediaType,
      "content-length": data.byteLength,
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(resource.name)}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "x-prism-resource": encodeURIComponent(JSON.stringify(resource)),
      "cache-control": "no-store",
    });
    response.end(data);
  }

  function openStream(response: ServerResponse, cursor?: string): void {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    response.write("retry: 2000\n\n");
    journal.resume(response, cursor);
    clients.add(response);
    writeEvent(response, kernel.statusEvent());
    const drop = (): void => {
      clients.delete(response);
    };
    response.on("close", drop);
    // A workbench that closes its window must not take the kernel down.
    response.on("error", drop);
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  }).catch(async (error: unknown) => {
    await stop();
    throw error;
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
  if (response.writableEnded) return;
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
        TASK_NOT_RUNNING: 409,
        CREATOR_DISABLED: 403,
        PLUGIN_NOT_FOUND: 404,
        PLUGIN_FAILED: 422,
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

async function readJson(
  request: IncomingMessage,
  limit = MAX_BODY_BYTES,
): Promise<unknown> {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk.toString();
    if (Buffer.byteLength(raw) > limit)
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

function dimension(body: unknown, key: string): number {
  const value = field(body, key);
  if (typeof value !== "number" || !Number.isInteger(value) || value < 2 || value > 500)
    throw new KernelError(
      "INVALID_REQUEST",
      `"${key}" must be an integer between 2 and 500`,
    );
  return value;
}

/**
 * Reads the settings patch of `PUT /settings`. Only the settings the kernel can
 * change are accepted; a key it cannot change is refused instead of dropped.
 */
function parseSettingsPatch(body: unknown): SettingsPatch {
  requireKnownKeys(body, ["permissions", "browser", "model", "search", "creator"]);
  const patch: SettingsPatch = {};
  const creator = field(body, "creator");
  if (creator !== undefined) {
    requireKnownKeys(creator, ["enabled"]);
    patch.creator = { enabled: requireBoolean(creator, "enabled") };
  }

  const permissions = field(body, "permissions");
  if (permissions !== undefined) {
    requireKnownKeys(permissions, ["scope"]);
    const scope = field(permissions, "scope");
    if (!isPermissionScope(scope))
      throw new KernelError(
        "INVALID_REQUEST",
        `"permissions.scope" must be one of ${PERMISSION_SCOPES.join(", ")}`,
      );
    patch.permissions = { scope };
  }

  const browser = field(body, "browser");
  if (browser !== undefined) {
    requireKnownKeys(browser, ["engine", "actionsNeedApproval"]);
    const engineField = field(browser, "engine");
    const flag = field(browser, "actionsNeedApproval");
    let engine: BrowserEngine | undefined;
    if (engineField !== undefined) {
      if (!isBrowserEngine(engineField))
        throw new KernelError(
          "INVALID_REQUEST",
          `"browser.engine" must be one of ${BROWSER_ENGINES.join(", ")}`,
        );
      engine = engineField;
    }
    if (flag !== undefined && typeof flag !== "boolean")
      throw new KernelError(
        "INVALID_REQUEST",
        '"browser.actionsNeedApproval" must be a boolean',
      );
    if (engine === undefined && flag === undefined)
      throw new KernelError(
        "INVALID_REQUEST",
        'A "browser" patch must set "engine" or "actionsNeedApproval"',
      );
    patch.browser = {
      ...(engine === undefined ? {} : { engine }),
      ...(flag === undefined ? {} : { actionsNeedApproval: flag }),
    };
  }

  const model = field(body, "model");
  if (model !== undefined) {
    requireKnownKeys(model, ["baseUrl", "model", "apiKey", "thinking"]);
    patch.model = {};
    for (const key of ["baseUrl", "model", "apiKey"] as const) {
      const value = optionalText(model, key);
      if (value !== undefined) patch.model[key] = value;
    }
    const thinking = field(model, "thinking");
    if (thinking !== undefined) {
      if (!isThinkingEffort(thinking))
        throw new KernelError(
          "INVALID_REQUEST",
          `"model.thinking" must be one of ${THINKING_EFFORTS.join(", ")}`,
        );
      patch.model.thinking = thinking;
    }
    if (Object.keys(patch.model).length === 0)
      throw new KernelError(
        "INVALID_REQUEST",
        'A "model" patch must set "baseUrl", "model", "apiKey" or "thinking"',
      );
  }

  const search = field(body, "search");
  if (search !== undefined) {
    requireKnownKeys(search, ["provider", "baseUrl"]);
    patch.search = {};
    for (const key of ["provider", "baseUrl"] as const) {
      const value = optionalText(search, key);
      if (value !== undefined) patch.search[key] = value;
    }
    if (Object.keys(patch.search).length === 0)
      throw new KernelError(
        "INVALID_REQUEST",
        'A "search" patch must set "provider" or "baseUrl"',
      );
  }

  if (Object.keys(patch).length === 0)
    throw new KernelError("INVALID_REQUEST", "A settings patch must set something");
  return patch;
}

function requireKnownKeys(value: unknown, known: string[]): void {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new KernelError("INVALID_REQUEST", "The request body must be a JSON object");
  for (const key of Object.keys(value))
    if (!known.includes(key))
      throw new KernelError(
        "INVALID_REQUEST",
        `Unsupported setting "${key}"; this kernel changes ${known.join(" and ")}`,
      );
}
