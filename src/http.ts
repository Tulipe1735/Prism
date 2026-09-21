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
}

/** POST JSON with bounded retries. Any failure happens before an action executes. */
export async function postJson(options: PostJsonOptions): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 25_000;
  let lastError: Error = new Error(`${options.label} is unavailable.`);

  for (let attempt = 0; attempt < 3; attempt += 1) {
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
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      lastError = new Error(`${options.label} connection failed; no action executed.`);
      await sleep(500 * 2 ** attempt);
      continue;
    }

    if (RETRYABLE.has(response.status) && attempt < 2) {
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
