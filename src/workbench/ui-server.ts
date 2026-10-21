import type { IncomingMessage, ServerResponse } from "node:http";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { MAX_ATTACHMENT_BYTES } from "../shared/attachments.ts";
import { MAX_CANVAS_BYTES } from "../shared/canvas.ts";

/** Prefix the browser uses for everything that belongs to the kernel. */
export const KERNEL_PREFIX = "/kernel";
/** Cap on proxied request bodies; the workbench sends small JSON documents. */
const MAX_BODY_BYTES = 1_000_000;

/** Chunk names end in a content hash, so their bytes never change. */
const HASHED = /-[A-Z0-9]{8}\.(?:js|css)$/;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

export interface UiServerOptions {
  /** Base URL of the kernel the workbench talks to. */
  kernelUrl: string;
  /** Directory holding `index.html`, `app.js` and `app.css`; defaults to this module's directory. */
  uiRoot?: string;
  /** 0 (default) lets the operating system pick a free port. */
  port?: number;
}

export interface RunningUiServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

/**
 * Serves the workbench UI and forwards everything below `/kernel` to the
 * kernel. The browser then talks to one origin only, which keeps the kernel
 * free of CORS handling and works from Electron and from a plain browser.
 */
export async function startUiServer(
  options: UiServerOptions,
): Promise<RunningUiServer> {
  const uiRoot = resolve(
    options.uiRoot ?? fileURLToPath(new URL("./", import.meta.url)),
  );
  const kernelUrl = new URL(options.kernelUrl);
  const server = createServer((request, response) => {
    void route(request, response).catch((error: unknown) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      console.error(
        `Workbench request ${request.method} ${request.url} failed:`,
        error instanceof Error ? error.message : error,
      );
      sendJson(response, 500, {
        error: { code: "INTERNAL_ERROR", message: "The workbench failed" },
      });
    });
  });

  async function route(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === KERNEL_PREFIX || url.pathname.startsWith(`${KERNEL_PREFIX}/`))
      return proxy(request, response, url);
    if (request.method !== "GET" && request.method !== "HEAD")
      return sendJson(response, 405, {
        error: { code: "INVALID_REQUEST", message: "The UI server only serves files" },
      });
    return sendFile(response, url.pathname);
  }

  async function sendFile(response: ServerResponse, pathname: string): Promise<void> {
    const requested = pathname === "/" ? "/index.html" : pathname;
    const path = resolve(uiRoot, `.${decodeURIComponent(requested)}`);
    const inside = relative(uiRoot, path);
    if (inside === "" || inside.startsWith("..") || inside.startsWith(sep)) {
      sendJson(response, 404, {
        error: { code: "INVALID_REQUEST", message: `No such file ${pathname}` },
      });
      return;
    }
    const content = await readFile(path).catch(() => null);
    if (content === null) {
      sendJson(response, 404, {
        error: { code: "INVALID_REQUEST", message: `No such file ${pathname}` },
      });
      return;
    }
    response.writeHead(200, {
      "content-type": CONTENT_TYPES[extname(path)] ?? "application/octet-stream",
      "content-length": content.byteLength,
      // Lazy chunks are over a megabyte; only hashed names may be cached.
      "cache-control": HASHED.test(path)
        ? "public, max-age=31536000, immutable"
        : "no-store",
    });
    response.end(content);
  }

  async function proxy(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<void> {
    const target = new URL(
      url.pathname.slice(KERNEL_PREFIX.length) + url.search,
      kernelUrl,
    );
    const controller = new AbortController();
    const drop = (): void => controller.abort();
    response.on("close", drop);
    let upstream: Response;
    try {
      upstream = await fetch(target, {
        method: request.method,
        headers:
          request.headers["content-type"] === undefined
            ? {}
            : { "content-type": request.headers["content-type"] },
        body: await readBody(
          request,
          /\/sessions\/[^/]+\/attachments$/.test(url.pathname)
            ? MAX_ATTACHMENT_BYTES
            : /\/sessions\/[^/]+\/canvas$/.test(url.pathname)
              ? MAX_CANVAS_BYTES
              : MAX_BODY_BYTES,
        ),
        signal: controller.signal,
      });
    } catch (error) {
      if (!response.headersSent)
        sendJson(response, 502, {
          error: {
            code: "KERNEL_UNREACHABLE",
            message: `Kernel at ${kernelUrl.origin} is unreachable: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        });
      return;
    }
    // The kernel streams its event stream without an end, so keep it flowing.
    response.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    });
    if (upstream.body === null) {
      response.end();
      return;
    }
    await new Promise<void>((resolvePipe) => {
      const body = Readable.fromWeb(
        upstream.body as Parameters<typeof Readable.fromWeb>[0],
      );
      body.on("error", () => response.end());
      response.on("close", () => body.destroy());
      body.pipe(response).on("finish", resolvePipe);
    });
    response.off("close", drop);
  }

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListen();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("The workbench UI did not bind a TCP port");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    port: address.port,
    close: async () => {
      const closed = new Promise<void>((resolveClose) =>
        server.close(() => resolveClose()),
      );
      server.closeAllConnections();
      await closed;
    },
  };
}

async function readBody(
  request: IncomingMessage,
  limit: number,
): Promise<Buffer | undefined> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Buffer);
    size += buffer.byteLength;
    if (size > limit) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}
