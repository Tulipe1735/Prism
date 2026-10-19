import { Buffer } from "node:buffer";
import { isIP } from "node:net";

import { UnsafeTargetError, WebFetchError } from "../shared/errors.ts";
import { VERSION } from "../shared/version.ts";
import { extractHtml } from "./html.ts";
import { type AddressResolver, isPublicAddress, systemResolver } from "./target.ts";

export interface WebFetchOptions {
  url: string;
  fetchImpl?: typeof fetch;
  /** Overrides DNS resolution; tests inject it to keep the network deterministic. */
  resolveAddresses?: AddressResolver;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  signal?: AbortSignal;
}

export interface WebPage {
  /** Final URL after redirects. */
  url: string;
  title: string;
  text: string;
  truncated: boolean;
  contentType: string | null;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_BYTES = 2_000_000;

export async function webFetch(options: WebFetchOptions): Promise<WebPage> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const resolve = options.resolveAddresses ?? systemResolver;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const signal = AbortSignal.any([
    AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    ...(options.signal ? [options.signal] : []),
  ]);
  let url = parseUrl(options.url);
  for (let redirects = 0; ; redirects += 1) {
    // Every hop is checked, so a public URL cannot redirect the kernel into the private network.
    await assertPublicTarget(url, resolve);
    try {
      const response = await fetchImpl(url.href, {
        redirect: "manual",
        headers: {
          "user-agent": `prism/${VERSION}`,
          accept: "text/html,text/plain;q=0.9,*/*;q=0.1",
        },
        signal,
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location)
          throw new WebFetchError(
            `Fetching ${url.href} failed: the redirect response came without a location.`,
          );
        if (redirects >= maxRedirects)
          throw new WebFetchError(
            `Fetching ${url.href} failed: more than ${maxRedirects} redirects.`,
          );
        await response.body?.cancel().catch(() => {});
        url = parseUrl(resolveLocation(location, url));
        continue;
      }
      if (!response.ok)
        throw new WebFetchError(
          `Fetching ${url.href} failed with HTTP ${response.status}.`,
        );
      return await readPage(url, response, options.maxBytes ?? DEFAULT_MAX_BYTES);
    } catch (error) {
      throw mapFailure(url, error, options);
    }
  }
}

/** Turns transport errors into actionable messages and keeps this module's own errors intact. */
function mapFailure(url: URL, error: unknown, options: WebFetchOptions): Error {
  if (error instanceof WebFetchError || error instanceof UnsafeTargetError)
    return error;
  if (options.signal?.aborted) {
    const reason: unknown = options.signal.reason;
    return reason instanceof Error
      ? reason
      : new WebFetchError(`Fetching ${url.href} was cancelled.`);
  }
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError")
    return new WebFetchError(
      `Fetching ${url.href} timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS} ms.`,
    );
  const message = error instanceof Error ? error.message : String(error);
  return new WebFetchError(`Fetching ${url.href} failed: ${message}.`);
}

function resolveLocation(location: string, from: URL): string {
  try {
    return new URL(location, from).href;
  } catch {
    throw new WebFetchError(
      `Fetching ${from.href} failed: the redirect location "${location}" is not a valid URL.`,
    );
  }
}

async function readPage(
  url: URL,
  response: Response,
  maxBytes: number,
): Promise<WebPage> {
  const contentType = response.headers.get("content-type");
  const { text: body, truncated } = await readBody(response, maxBytes);
  const kind = bodyKind(contentType, body);
  if (kind === "binary")
    throw new WebFetchError(
      `Fetching ${url.href} returned unsupported content type ${contentType}; only text pages are fetched.`,
    );
  const content =
    kind === "html" ? extractHtml(body, url.href) : { title: "", text: body };
  return {
    url: url.href,
    title: content.title,
    text: kind === "html" ? content.text : content.text.trim(),
    truncated,
    contentType,
  };
}

async function readBody(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const { bytes, truncated } = await readBytes(response, maxBytes);
  return {
    text: decode(bytes, charsetOf(response.headers.get("content-type"))),
    truncated,
  };
}

/** Reads at most `maxBytes` of the body and reports whether the rest was dropped. */
async function readBytes(
  response: Response,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    return {
      bytes: buffer.subarray(0, maxBytes),
      truncated: buffer.byteLength > maxBytes,
    };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = maxBytes - size;
    if (value.byteLength > remaining) {
      if (remaining > 0) chunks.push(value.subarray(0, remaining));
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  return { bytes: new Uint8Array(Buffer.concat(chunks)), truncated };
}

function charsetOf(contentType: string | null): string {
  const match = /charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType ?? "");
  return match?.[1] ?? "utf-8";
}

function decode(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** Chooses how to read a response body; unknown types fall back to sniffing the text. */
function bodyKind(
  contentType: string | null,
  body: string,
): "html" | "text" | "binary" {
  const type = contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (type === "text/html" || type === "application/xhtml+xml") return "html";
  if (type === "") return body.trimStart().startsWith("<") ? "html" : "text";
  if (type.startsWith("text/") || type === "application/json" || type.endsWith("+json"))
    return "text";
  return "binary";
}

function parseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeTargetError(`Refusing to fetch "${raw}": it is not a valid URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new UnsafeTargetError(
      `Refusing to fetch ${raw}: only http and https URLs are fetched.`,
    );
  if (url.username || url.password)
    throw new UnsafeTargetError(
      `Refusing to fetch ${raw}: URLs with credentials are not fetched.`,
    );
  if (!url.hostname)
    throw new UnsafeTargetError(`Refusing to fetch ${raw}: the URL has no host.`);
  return url;
}

/** Rejects every destination that is not a public HTTP(S) address, before connecting. */
async function assertPublicTarget(url: URL, resolve: AddressResolver): Promise<void> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost"))
    throw new UnsafeTargetError(
      `Refusing to fetch ${url.href}: ${hostname} is not a public address.`,
    );
  if (isIP(hostname)) {
    if (!isPublicAddress(hostname))
      throw new UnsafeTargetError(
        `Refusing to fetch ${url.href}: ${hostname} is not a public address.`,
      );
    return;
  }
  let addresses: string[];
  try {
    addresses = await resolve(hostname);
  } catch {
    throw new WebFetchError(
      `Fetching ${url.href} failed: could not resolve ${hostname}.`,
    );
  }
  const blocked = addresses.find((address) => !isPublicAddress(address));
  if (blocked)
    throw new UnsafeTargetError(
      `Refusing to fetch ${url.href}: ${hostname} resolves to ${blocked}, which is not a public address.`,
    );
}
