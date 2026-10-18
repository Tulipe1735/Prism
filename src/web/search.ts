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
  search(request: SearchRequest): Promise<SearchResult[]>;
}

export interface WebSearchConfig {
  /** Search source; defaults to `deepseek`. */
  name?: string;
  apiKey: string;
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

export function createSearchProvider(config: WebSearchConfig): SearchProvider {
  const name = config.name ?? DEFAULT_SOURCE;
  if (name !== DEFAULT_SOURCE)
    throw new ConfigError(
      `Unknown search source "${name}". Supported sources: ${DEFAULT_SOURCE}.`,
    );
  if (!config.apiKey)
    throw new ConfigError(
      `Search source "${name}" needs an API key; set it in the Prism configuration.`,
    );
  return deepseekProvider(config);
}

function deepseekProvider(config: WebSearchConfig): SearchProvider {
  const endpoint = `${(config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")}/v1/tools/search`;
  const configuredCount = config.count ?? DEFAULT_COUNT;
  const fetchImpl = config.fetchImpl ?? fetch;

  return {
    name: DEFAULT_SOURCE,
    async search(request) {
      const count = request.count ?? configuredCount;
      if (!Number.isInteger(count) || count < 1 || count > 50)
        throw new ConfigError("Search count must be an integer between 1 and 50.");
      const payload = await postJson({
        url: endpoint,
        apiKey: config.apiKey,
        label: "DeepSeek search",
        fetchImpl,
        timeoutMs: config.timeoutMs,
        signal: request.signal,
        body: {
          query: request.query,
          count,
          need_content: false,
          ...(request.originalQuestion ? { ori_question: request.originalQuestion } : {}),
        },
      });
      const parsed = searchResponseSchema.safeParse(payload);
      if (!parsed.success)
        throw new Error(
          "DeepSeek search returned an unexpected response shape; no results were used.",
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
