import { net, protocol } from "electron";
import { rendererContentSecurityPolicy } from "./content-security-policy.ts";
import { RENDERER_HOST, RENDERER_SCHEME } from "./identity-config.ts";

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
    responseHeaders.set(
      "Content-Security-Policy",
      rendererContentSecurityPolicy(url.pathname),
    );
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  });
}
