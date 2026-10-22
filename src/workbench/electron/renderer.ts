import { net, protocol } from "electron";
import {
  CLERK_FRONTEND_HOST,
  RENDERER_HOST,
  RENDERER_SCHEME,
} from "./identity-config.ts";

export function isRendererUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === `${RENDERER_SCHEME}:` && url.host === RENDERER_HOST;
  } catch {
    return false;
  }
}

/** A stable, trusted renderer origin; the existing HTTP server still owns the kernel proxy. */
export function registerRenderer(getUiUrl: () => string | undefined): void {
  protocol.handle(RENDERER_SCHEME, async (request) => {
    if (!isRendererUrl(request.url)) return new Response("Not found", { status: 404 });
    const base = getUiUrl();
    if (base === undefined) return new Response("Starting", { status: 503 });
    const url = new URL(request.url);
    const target = new URL(base);
    target.pathname = url.pathname;
    target.search = url.search;
    const headers = new Headers();
    const contentType = request.headers.get("content-type");
    if (contentType !== null) headers.set("content-type", contentType);
    const upstream = await net.fetch(target.href, {
      method: request.method,
      headers,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : await request.arrayBuffer(),
      signal: request.signal,
    });
    const responseHeaders = new Headers(upstream.headers);
    if (!url.pathname.startsWith("/kernel/plugins/"))
      responseHeaders.set(
        "Content-Security-Policy",
        [
          "default-src 'self'",
          `script-src 'self' 'unsafe-inline' https://${CLERK_FRONTEND_HOST} https://challenges.cloudflare.com https://*.protect.clerk.com`,
          `connect-src 'self' https://${CLERK_FRONTEND_HOST} https://*.protect.clerk.com:* https://clerk-telemetry.com https://*.clerk-telemetry.com`,
          "img-src 'self' https://img.clerk.com data:",
          "style-src 'self' 'unsafe-inline'",
          "worker-src 'self' blob:",
          "frame-src 'self' https://challenges.cloudflare.com https://*.protect.clerk.com",
          "form-action 'self'",
          "object-src 'none'",
          "base-uri 'self'",
        ].join("; "),
      );
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  });
}
