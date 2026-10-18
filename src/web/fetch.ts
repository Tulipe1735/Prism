import { isIP } from "node:net";

import { UnsafeTargetError, WebFetchError } from "../shared/errors.ts";
import { VERSION } from "../shared/version.ts";
import { isPublicAddress, systemResolver, type AddressResolver } from "./target.ts";

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

export async function webFetch(options: WebFetchOptions): Promise<WebPage> {
  const url = parseUrl(options.url);
  await assertPublicTarget(url, options.resolveAddresses ?? systemResolver);
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(url.href, {
    redirect: "manual",
    headers: {
      "user-agent": `prism/${VERSION}`,
      accept: "text/html,text/plain;q=0.9,*/*;q=0.1",
    },
    signal: AbortSignal.any([
      AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      ...(options.signal ? [options.signal] : []),
    ]),
  });
  return {
    url: url.href,
    title: "",
    text: await response.text(),
    truncated: false,
    contentType: response.headers.get("content-type"),
  };
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
    throw new WebFetchError(`Fetching ${url.href} failed: could not resolve ${hostname}.`);
  }
  const blocked = addresses.find((address) => !isPublicAddress(address));
  if (blocked)
    throw new UnsafeTargetError(
      `Refusing to fetch ${url.href}: ${hostname} resolves to ${blocked}, which is not a public address.`,
    );
}
