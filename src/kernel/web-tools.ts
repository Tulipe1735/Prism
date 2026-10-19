import type { SearchResult } from "../web/search.ts";
import type { AddressResolver } from "../web/target.ts";
import type { Tool } from "./tool.ts";
import { webFetch } from "../web/fetch.ts";
import { createSearchProvider } from "../web/search.ts";
import { missingArgument, readNumber, readString } from "./tool-support.ts";

/**
 * The web as the kernel's read-only tools: `web_search` asks the configured
 * source, `web_fetch` reads one page as text. Neither writes the workspace and
 * neither is bound by the permission scopes; `web_fetch` refuses private and
 * reserved targets in every scope (SSRF).
 */
export interface WebToolsOptions {
  /**
   * The search source in effect, read on every call so the workbench can
   * change it without restarting the kernel.
   */
  search: () => {
    provider: string;
    apiKey?: string;
    baseUrl?: string;
    count?: number;
  };
  /** Test seam: a controlled HTTP service in place of the public network. */
  fetch?: WebFetchOverrides;
}

export interface WebFetchOverrides {
  fetchImpl?: typeof fetch;
  resolveAddresses?: AddressResolver;
  timeoutMs?: number;
  maxBytes?: number;
}

export function createWebTools(options: WebToolsOptions): Tool[] {
  const search: Tool = {
    name: "web_search",
    description:
      "Searches the web and returns titles, links and summaries. Follow up with web_fetch to read a result.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query." },
        count: {
          type: "number",
          description:
            "Number of results, 1 to 50; the configured default applies otherwise.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    execute: async (args, context) => {
      const query = readString(args, "query");
      if (query === undefined || query === "") return missingArgument("query");
      const count = readNumber(args, "count");
      try {
        // Built per call: a kernel without a search key still starts and serves
        // every other tool, and reports the missing key when search is used.
        const provider = createSearchProvider(options.search());
        const results = await provider.search({
          query,
          signal: context.signal,
          ...(count === undefined ? {} : { count }),
        });
        return { content: renderResults(results) };
      } catch (error) {
        return {
          content: `web_search failed: ${describe(error)}`,
          isError: true,
        };
      }
    },
  };

  const fetchTool: Tool = {
    name: "web_fetch",
    description:
      "Reads one public web page and returns its text. Private, loopback and reserved addresses are refused.",
    parameters: {
      type: "object",
      properties: { url: { type: "string", description: "Page to read." } },
      required: ["url"],
      additionalProperties: false,
    },
    execute: async (args, context) => {
      const url = readString(args, "url");
      if (url === undefined || url === "") return missingArgument("url");
      try {
        const page = await webFetch({
          url,
          signal: context.signal,
          ...options.fetch,
        });
        const heading = page.title === "" ? page.url : `${page.title}\n${page.url}`;
        return {
          content: [
            heading,
            page.truncated ? "[the page was cut at the size limit]" : undefined,
            page.text,
          ]
            .filter((part): part is string => part !== undefined)
            .join("\n\n"),
        };
      } catch (error) {
        return { content: describe(error), isError: true };
      }
    },
  };

  return [search, fetchTool];
}

/** One result per block, so the model can quote a link without guessing. */
function renderResults(results: SearchResult[]): string {
  if (results.length === 0) return "The search returned no results.";
  return results
    .map((result, index) => {
      const source = [result.siteName, result.date]
        .filter((value): value is string => value !== null && value !== "")
        .join(", ");
      return [
        `${index + 1}. ${result.title}`,
        `   ${result.url}`,
        ...(source === "" ? [] : [`   ${source}`]),
        ...(result.snippet === "" ? [] : [`   ${result.snippet}`]),
        ...(result.summary === "" || result.summary === result.snippet
          ? []
          : [`   ${result.summary}`]),
      ].join("\n");
    })
    .join("\n\n");
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
