import { VERSION } from "./version.ts";

const RETRYABLE = new Set([429, 503, 529]);

export interface PostJsonOptions {
  url: string;
  apiKey: string;
  body: unknown;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  label: string;
  signal?: AbortSignal;
  maxAttempts?: number;
}

/** POST JSON with bounded retries. Any failure happens before an action executes. */
export async function postJson(options: PostJsonOptions): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 25_000;
  let lastError: Error = new Error(`${options.label} is unavailable.`);
  const maxAttempts = options.maxAttempts ?? 3;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1)
    throw new Error("maxAttempts must be a positive integer.");

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    options.signal?.throwIfAborted();
    let response: Response;
    try {
      response = await fetchImpl(options.url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
          "user-agent": `prism/${VERSION}`,
          ...options.headers,
        },
        body: JSON.stringify(options.body),
        signal: AbortSignal.any([
          AbortSignal.timeout(timeoutMs),
          ...(options.signal ? [options.signal] : []),
        ]),
      });
    } catch {
      options.signal?.throwIfAborted();
      lastError = new Error(`${options.label} connection failed; no action executed.`);
      await sleep(500 * 2 ** attempt);
      continue;
    }

    if (RETRYABLE.has(response.status) && attempt < maxAttempts - 1) {
      lastError = new Error(
        `${options.label} returned HTTP ${response.status}; no action executed.`,
      );
      await sleep(500 * 2 ** attempt);
      continue;
    }
    if (!response.ok) {
      throw new Error(
        `${options.label} returned HTTP ${response.status}; no action executed.`,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new Error(`${options.label} returned invalid JSON; no action executed.`);
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
