import { z } from "zod";

import { ConfigError } from "../shared/errors.ts";
import { postJson } from "../shared/http.ts";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  summary: string;
  siteName: string | null;
  date: string | null;
}

export interface SearchRequest {
  query: string;
  count?: number;
  originalQuestion?: string;
  signal?: AbortSignal;
}

/** A web search source the kernel can call. See docs/web-search.md to add one. */
export interface SearchProvider {
  readonly name: string;
  search: (request: SearchRequest) => Promise<SearchResult[]>;
}

export interface WebSearchConfig {
  /** Search source; defaults to `deepseek`. Matches `search.provider` in the kernel config. */
  provider?: string;
  apiKey?: string;
  /** Overrides the source endpoint; defaults to `https://api.deepseek.com`. */
  baseUrl?: string;
  count?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const resultSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string().default(""),
  summary: z.string().default(""),
  site_name: z.string().nullish(),
  date: z.string().nullish(),
});

const searchResponseSchema = z.object({ results: z.array(resultSchema) });

const DEFAULT_SOURCE = "deepseek";
const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_COUNT = 10;

/**
 * Builds the search source named in the configuration. `deepseek` is the only
 * source with a built-in endpoint; any other name needs an explicit `baseUrl`
 * and is then called the same way, so a gateway or proxy works without code.
 */
export function createSearchProvider(config: WebSearchConfig): SearchProvider {
  const provider = config.provider ?? DEFAULT_SOURCE;
  if (provider !== DEFAULT_SOURCE && config.baseUrl === undefined)
    throw new ConfigError(
      `Unknown search source "${provider}". Set "search.baseUrl" to use it as a DeepSeek-compatible endpoint, or use "${DEFAULT_SOURCE}".`,
    );
  if (!config.apiKey)
    throw new ConfigError(
      `Search source "${provider}" needs an API key; set it in the Prism configuration.`,
    );
  return compatibleProvider({ ...config, provider, apiKey: config.apiKey });
}

/** The DeepSeek search endpoint shape, which compatible sources reuse. */
function compatibleProvider(
  config: WebSearchConfig & { provider: string; apiKey: string },
): SearchProvider {
  const endpoint = `${(config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")}/v1/tools/search`;
  const configuredCount = config.count ?? DEFAULT_COUNT;
  const fetchImpl = config.fetchImpl ?? fetch;
  const { apiKey, provider } = config;

  return {
    name: provider,
    async search(request) {
      const count = request.count ?? configuredCount;
      if (!Number.isInteger(count) || count < 1 || count > 50)
        throw new ConfigError("Search count must be an integer between 1 and 50.");
      const payload = await postJson({
        url: endpoint,
        apiKey,
        label: `${provider} search`,
        fetchImpl,
        timeoutMs: config.timeoutMs,
        signal: request.signal,
        body: {
          query: request.query,
          count,
          need_content: false,
          ...(request.originalQuestion
            ? { ori_question: request.originalQuestion }
            : {}),
        },
      });
      const parsed = searchResponseSchema.safeParse(payload);
      if (!parsed.success)
        throw new Error(
          `${provider} search returned an unexpected response shape; no results were used.`,
        );
      return parsed.data.results.map((result) => ({
        title: result.title,
        url: result.url,
        snippet: result.snippet,
        summary: result.summary,
        siteName: result.site_name ?? null,
        date: result.date ?? null,
      }));
    },
  };
}
