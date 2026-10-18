import { describe, expect, it, vi } from "vitest";

import { createSearchProvider } from "../../src/web/search.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const deepseekResults = {
  results: [
    {
      rerank_score: 2.4,
      title: "DeepSeek V4 model released",
      url: "https://example.com/deepseek-v4",
      snippet: "DeepSeek V4 is now available.",
      summary: "DeepSeek has released the V4 model.",
      content: "",
      site_name: "Example News",
      site_icon: null,
      date: "2026-06-01T00:00:00+00:00",
      authority: 3,
    },
  ],
};

describe("createSearchProvider", () => {
  it("parses DeepSeek search results into titles, links, and summaries", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(deepseekResults));
    const provider = createSearchProvider({
      name: "deepseek",
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const results = await provider.search({ query: "DeepSeek V4" });

    expect(results).toEqual([
      {
        title: "DeepSeek V4 model released",
        url: "https://example.com/deepseek-v4",
        snippet: "DeepSeek V4 is now available.",
        summary: "DeepSeek has released the V4 model.",
        siteName: "Example News",
        date: "2026-06-01T00:00:00+00:00",
      },
    ]);
  });

  it("sends the query to the DeepSeek search endpoint with the API key", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ results: [] }));
    const provider = createSearchProvider({
      name: "deepseek",
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await provider.search({ query: "prism agent", count: 3 });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.deepseek.com/v1/tools/search");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ authorization: "Bearer test-key" });
    expect(JSON.parse(String(init.body))).toEqual({
      query: "prism agent",
      count: 3,
      need_content: false,
    });
  });

  it("honors a configured base URL and default result count", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ results: [] }));
    const provider = createSearchProvider({
      name: "deepseek",
      apiKey: "test-key",
      baseUrl: "https://gateway.example.com/deepseek/",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await provider.search({ query: "prism agent" });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://gateway.example.com/deepseek/v1/tools/search");
    expect(JSON.parse(String(init.body))).toMatchObject({ count: 10 });
  });

  it("rejects an unknown source with the supported names", () => {
    expect(() =>
      createSearchProvider({ name: "altavista", apiKey: "test-key" }),
    ).toThrow(/deepseek/);
  });

  it("surfaces provider failures without inventing results", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: {} }, 401));
    const provider = createSearchProvider({
      name: "deepseek",
      apiKey: "bad-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(provider.search({ query: "prism agent" })).rejects.toThrow(/HTTP 401/);
  });
});
