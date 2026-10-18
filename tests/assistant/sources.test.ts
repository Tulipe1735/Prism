import type { Document } from "../../src/assistant/types.ts";
import { Buffer } from "node:buffer";
import dns from "node:dns/promises";
import { describe, expect, it, vi } from "vitest";
import {
  ArxivSource,
  GitHubTrending,
  GmailSource,
  NotionSource,
  readWebDocument,
} from "../../src/assistant/connectors.ts";

// Public document-store adapter: assertions observe the same methods as a caller.
class DocumentLibrary {
  private documents = new Map<string, Document>();
  getDocument(id: string) {
    return this.documents.get(id);
  }
  listDocuments() {
    return [...this.documents.values()];
  }
  upsertDocument(document: Document) {
    this.documents.set(document.id, document);
  }
  removeDocument(id: string) {
    const document = this.documents.get(id);
    if (document) this.documents.set(id, { ...document, active: false });
  }
}

const PAGE = "3c90c3cc-0d44-4b50-8888-8dd25736052a";
const CHILD = "4c90c3cc-0d44-4b50-8888-8dd25736052a";
const DATABASE = "5c90c3cc-0d44-4b50-8888-8dd25736052a";
const DATA_SOURCE = "6c90c3cc-0d44-4b50-8888-8dd25736052a";
const ROW = "7c90c3cc-0d44-4b50-8888-8dd25736052a";
const ROW2 = "8c90c3cc-0d44-4b50-8888-8dd25736052a";
const TOGGLE = "9c90c3cc-0d44-4b50-8888-8dd25736052a";
const EDITED = "2026-10-17T05:31:56.000Z";
const notionPage = (id = PAGE, title = "Research notes") => ({
  object: "page",
  id,
  url: `https://www.notion.so/${id.replaceAll("-", "")}`,
  last_edited_time: EDITED,
  in_trash: false,
  is_archived: false,
  parent: { type: "workspace", workspace: true },
  properties: {
    title: {
      id: "title",
      type: "title",
      title: [{ type: "text", plain_text: title, text: { content: title } }],
    },
  },
});

describe("Gmail research subscriptions", () => {
  it("refreshes offline authorization, reads paginated MIME mail, and deduplicates arXiv candidates while retaining both mail origins", async () => {
    const announcement =
      "arXiv:2605.09423v2\nTitle: SimWorld Studio\nAuthors: Haoqiang Kang et al.\nCategories: cs.AI\n\nAn evolving coding agent generates embodied environments.\nhttps://arxiv.org/abs/2605.09423v2";
    const source = new GmailSource({
      clientId: "test-client",
      clientSecret: "test-secret",
      refreshToken: "test-refresh",
      query: "label:research",
      fetch: protocol((url, init) => {
        if (url.hostname === "oauth2.googleapis.com") {
          const body = new URLSearchParams(String(init.body));
          expect(body.get("grant_type")).toBe("refresh_token");
          expect(body.get("refresh_token")).toBe("test-refresh");
          return json({
            access_token: "test-access",
            expires_in: 3600,
            token_type: "Bearer",
          });
        }
        expect(new Headers(init.headers).get("Authorization")).toBe(
          "Bearer test-access",
        );
        if (url.pathname === "/gmail/v1/users/me/messages") {
          expect(url.searchParams.get("q")).toBe("label:research");
          return json(
            url.searchParams.has("pageToken")
              ? {
                  messages: [{ id: "mail-2", threadId: "thread-2" }],
                  resultSizeEstimate: 2,
                }
              : {
                  messages: [{ id: "mail-1", threadId: "thread-1" }],
                  nextPageToken: "next-mail-page",
                  resultSizeEstimate: 2,
                },
          );
        }
        if (
          url.pathname === "/gmail/v1/users/me/messages/mail-1" ||
          url.pathname === "/gmail/v1/users/me/messages/mail-2"
        ) {
          expect(url.searchParams.get("format")).toBe("full");
          const id = url.pathname.endsWith("mail-1") ? "mail-1" : "mail-2";
          return json({
            id,
            threadId: id.replace("mail", "thread"),
            historyId: "4321",
            internalDate: "1792216800000",
            snippet: "arXiv daily announcement",
            payload: {
              mimeType: "multipart/alternative",
              filename: "",
              headers: [
                { name: "Subject", value: "cs.AI daily submissions" },
                { name: "From", value: "cs@arxiv.org" },
              ],
              parts:
                id === "mail-1"
                  ? [
                      {
                        mimeType: "text/plain",
                        filename: "",
                        body: { data: Buffer.from(announcement).toString("base64url") },
                      },
                    ]
                  : [
                      {
                        mimeType: "text/html",
                        filename: "",
                        body: {
                          data: Buffer.from(
                            `<html><p>${announcement.replaceAll("\n", "</p><p>")}</p><script>do not read this</script></html>`,
                          ).toString("base64url"),
                        },
                      },
                    ],
            },
          });
        }
        throw new Error(`Unexpected request ${url.pathname}`);
      }),
    });
    const documents = await source.collect();
    const mails = documents.filter(
      (document) => document.metadata?.envelopeOnly === true,
    );
    const papers = documents.filter(
      (document) => document.metadata?.canonicalId === "arxiv:2605.09423",
    );
    expect(mails).toHaveLength(2);
    expect(mails[1]?.content).toContain("An evolving coding agent");
    expect(mails[1]?.content).not.toContain("do not read this");
    expect(papers).toHaveLength(1);
    expect(papers[0]).toMatchObject({
      title: "SimWorld Studio",
      url: "https://arxiv.org/abs/2605.09423",
      source: "gmail",
      metadata: { messageIds: ["mail-1", "mail-2"], canonicalId: "arxiv:2605.09423" },
    });
    expect(papers[0]?.content).toContain("An evolving coding agent");
    expect((await source.collect()).map((document) => document.id)).toEqual(
      documents.map((document) => document.id),
    );
  });
});

describe("GitHub Trending", () => {
  it("imports actual ranked Trending HTML with stable repository identities and refuses unrelated search markup", async () => {
    // Shape of github.com/trending: article.Box-row, h2 a, itemprop language.
    let available = true;
    const source = new GitHubTrending({
      fetch: protocol((url) => {
        expect(url.toString()).toBe("https://github.com/trending?since=daily");
        return new Response(
          available
            ? `<html><h1>Trending</h1><article class="Box-row"><h2><a href="/SimWorld-AI/SimWorld-Studio">SimWorld-AI / SimWorld-Studio</a></h2><p class="col-9">Evolving 3D environments for embodied learning</p><div><span itemprop="programmingLanguage">Python</span><a href="/SimWorld-AI/SimWorld-Studio/stargazers">1,234</a><span class="d-inline-block float-sm-right">42 stars today</span></div></article></html>`
            : "<html><h1>Search results</h1><a href='/search'>Popular projects</a></html>",
          { headers: { "Content-Type": "text/html" } },
        );
      }),
    });
    const documents = await source.collect();
    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({
      source: "github",
      title: "SimWorld-AI/SimWorld-Studio",
      url: "https://github.com/SimWorld-AI/SimWorld-Studio",
      metadata: {
        canonicalId: "github:simworld-ai/simworld-studio",
        origin: "github-trending",
        rank: 1,
        dateRange: "daily",
        language: "Python",
        stars: 1234,
        periodStars: 42,
      },
    });
    expect(documents[0]?.content).toContain("Evolving 3D environments");
    expect((await source.collect())[0]?.id).toBe(documents[0]?.id);
    available = false;
    await expect(source.collect()).rejects.toThrow(/Trending/);
  });
});

describe("arXiv metadata search", () => {
  it("queries the official API and preserves abstract, authors, paper identity and unread PDF provenance", async () => {
    const source = new ArxivSource({
      fetch: protocol((url) => {
        expect(url.origin + url.pathname).toBe("https://export.arxiv.org/api/query");
        expect(url.searchParams.get("search_query")).toBe(
          'ti:"recursive self-improvement" AND cat:cs.AI',
        );
        expect(url.searchParams.get("max_results")).toBe("5");
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"><opensearch:totalResults>1</opensearch:totalResults><entry><id>http://arxiv.org/abs/2605.09423v2</id><updated>2026-05-13T08:34:40Z</updated><published>2026-05-10T08:51:50Z</published><title>SimWorld Studio: Automatic Environment Generation</title><summary>SimCoder evolves tools &amp; skills using verifier feedback.</summary><author><name>Haoqiang Kang</name></author><author><name>Xiaokang Ye</name></author><link href="http://arxiv.org/abs/2605.09423v2" rel="alternate" type="text/html"/><link href="http://arxiv.org/pdf/2605.09423v2" rel="related" title="pdf" type="application/pdf"/><category term="cs.AI" scheme="http://arxiv.org/schemas/atom"/></entry></feed>`,
          { headers: { "Content-Type": "application/atom+xml" } },
        );
      }),
    });
    const documents = await source.search(
      'ti:"recursive self-improvement" AND cat:cs.AI',
      5,
    );
    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({
      id: "arxiv:2605.09423",
      source: "arxiv",
      url: "https://arxiv.org/abs/2605.09423",
      version: "2026-05-13T08:34:40Z",
      metadata: {
        canonicalId: "arxiv:2605.09423",
        coverage: "abstract",
        authors: ["Haoqiang Kang", "Xiaokang Ye"],
        attachments: [{ url: "https://arxiv.org/pdf/2605.09423v2", status: "unread" }],
      },
    });
    expect(documents[0]?.content).toContain("SimCoder evolves tools & skills");
  });
});

describe("safe web document reading", () => {
  it("reads public HTML through checked redirects, retaining readable source and unread attachment links", async () => {
    const resolve = vi.fn();
    resolve.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    vi.spyOn(dns, "lookup").mockImplementation(resolve);
    const document = await readWebDocument("https://example.com/start", {
      fetch: protocol((url, init) => {
        expect(init.redirect).toBe("manual");
        if (url.pathname === "/start")
          return new Response(null, {
            status: 302,
            headers: { Location: "https://papers.example.com/method" },
          });
        return new Response(
          `<html><head><title>Method comparison</title></head><body><main><h1>Persistent skill updates</h1><p>Held-out tasks test whether retained skills transfer.</p><a href="/supplement.pdf">Supplement</a></main><script>ignore hidden script content</script></body></html>`,
          {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              ETag: '"source-v1"',
            },
          },
        );
      }),
    });
    expect(document).toMatchObject({
      source: "web",
      title: "Method comparison",
      url: "https://papers.example.com/method",
      version: '"source-v1"',
      active: true,
      metadata: {
        status: "complete",
        originalUrl: "https://example.com/start",
        contentType: "text/html",
        attachments: [
          { url: "https://papers.example.com/supplement.pdf", status: "unread" },
        ],
      },
    });
    expect(document.content).toContain(
      "Held-out tasks test whether retained skills transfer.",
    );
    expect(document.content).not.toContain("hidden script");
  });
});
const list = (results: unknown[], next_cursor: string | null = null) => ({
  object: "list",
  results,
  has_more: next_cursor !== null,
  next_cursor,
});
const markdown = (text: string) => ({
  object: "page_markdown",
  id: PAGE,
  markdown: text,
  truncated: false,
  unknown_block_ids: [],
});
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
type Route = (url: URL, init: RequestInit) => Response | Promise<Response>;
function protocol(route: Route): typeof fetch {
  return async (input, init) => route(new URL(String(input)), init ?? {});
}

describe("Notion source synchronization", () => {
  it("imports readable Markdown with original page and version, without duplicating repeated synchronization", async () => {
    const library = new DocumentLibrary();
    const source = new NotionSource({
      token: "test-notion-token",
      fetch: protocol((url, init) => {
        expect(new Headers(init.headers).get("Authorization")).toBe(
          "Bearer test-notion-token",
        );
        expect(new Headers(init.headers).get("Notion-Version")).toBe("2026-03-11");
        if (url.pathname === "/v1/search") return json(list([notionPage()]));
        if (url.pathname === `/v1/pages/${PAGE}/markdown`)
          return json(
            markdown(
              "## Research question\nHow can reusable skills improve a harness?",
            ),
          );
        if (url.pathname === `/v1/blocks/${PAGE}/children`) return json(list([]));
        throw new Error(`Unexpected protocol request: ${url.pathname}`);
      }),
    });

    expect(await source.sync(library)).toEqual({
      imported: 1,
      removed: 0,
      failures: [],
      complete: true,
    });
    expect(library.getDocument(`notion:${PAGE}`)).toMatchObject({
      source: "notion",
      title: "Research notes",
      version: EDITED,
      active: true,
      url: "https://www.notion.so/3c90c3cc0d444b5088888dd25736052a",
      metadata: { status: "complete", pageId: PAGE },
    });
    expect(library.getDocument(`notion:${PAGE}`)?.content).toContain(
      "## Research question",
    );
    expect(await source.sync(library)).toEqual({
      imported: 0,
      removed: 0,
      failures: [],
      complete: true,
    });
    expect(library.listDocuments()).toHaveLength(1);
  });

  it("covers paginated search, nested child pages and database rows instead of treating the top-level count as the full library", async () => {
    const library = new DocumentLibrary();
    const source = new NotionSource({
      token: "test-notion-token",
      fetch: protocol((url, init) => {
        const body = init.body ? JSON.parse(String(init.body)) : {};
        if (url.pathname === "/v1/search")
          return json(
            body.start_cursor ? list([]) : list([notionPage()], "search-next"),
          );
        if (url.pathname === `/v1/blocks/${PAGE}/children`)
          return json(
            url.searchParams.has("start_cursor")
              ? list([
                  {
                    object: "block",
                    id: CHILD,
                    type: "child_page",
                    has_children: false,
                    child_page: { title: "Next research step" },
                  },
                ])
              : list(
                  [
                    {
                      object: "block",
                      id: TOGGLE,
                      type: "toggle",
                      has_children: true,
                      toggle: { rich_text: [] },
                    },
                  ],
                  "block-next",
                ),
          );
        if (url.pathname === `/v1/blocks/${TOGGLE}/children`)
          return json(
            list([
              {
                object: "block",
                id: DATABASE,
                type: "child_database",
                child_database: { title: "Papers" },
              },
            ]),
          );
        if (url.pathname === `/v1/databases/${DATABASE}`)
          return json({
            object: "database",
            id: DATABASE,
            data_sources: [{ id: DATA_SOURCE, name: "Papers" }],
          });
        if (url.pathname === `/v1/data_sources/${DATA_SOURCE}/query`)
          return json(
            body.start_cursor
              ? list([notionPage(ROW2, "Comparison")])
              : list(
                  [
                    {
                      ...notionPage(ROW, "Method notes"),
                      parent: {
                        type: "data_source_id",
                        data_source_id: DATA_SOURCE,
                        database_id: DATABASE,
                      },
                      properties: {
                        ...notionPage().properties,
                        Status: {
                          id: "status",
                          type: "status",
                          status: { id: "new", name: "To read", color: "default" },
                        },
                        Related: {
                          id: "related",
                          type: "relation",
                          has_more: false,
                          relation: [{ id: CHILD }],
                        },
                        Slides: {
                          id: "files",
                          type: "files",
                          files: [
                            {
                              name: "Slides.pdf",
                              type: "external",
                              external: { url: "https://example.com/slides.pdf" },
                            },
                          ],
                        },
                      },
                    },
                  ],
                  "rows-next",
                ),
          );
        if (url.pathname === `/v1/pages/${CHILD}`)
          return json(notionPage(CHILD, "Next research step"));
        if (url.pathname.endsWith("/markdown"))
          return json(markdown("Verified source text."));
        if (url.pathname.endsWith("/children")) return json(list([]));
        throw new Error(`Unexpected protocol request: ${url.pathname}`);
      }),
    });
    expect(await source.sync(library)).toEqual({
      imported: 4,
      removed: 0,
      failures: [],
      complete: true,
    });
    expect(library.getDocument(`notion:${CHILD}`)?.title).toBe("Next research step");
    expect(library.getDocument(`notion:${ROW2}`)?.title).toBe("Comparison");
    const record = library.getDocument(`notion:${ROW}`);
    expect(record?.content).toContain("To read");
    expect(record?.content).toContain(
      "https://www.notion.so/4c90c3cc0d444b5088888dd25736052a",
    );
    expect(record?.content).toContain("Slides.pdf");
    expect(record?.metadata).toMatchObject({
      attachments: [{ url: "https://example.com/slides.pdf", status: "unread" }],
    });
  });

  it.each([403, 404])(
    "removes only a confirmed inaccessible page (%s), preserves transient failures, and reports incomplete synchronization",
    async (revokedStatus) => {
      let phase = 1;
      const library = new DocumentLibrary();
      const source = new NotionSource({
        token: "test-notion-token",
        fetch: protocol((url) => {
          if (url.pathname === "/v1/search") {
            if (phase === 3)
              return json(
                { object: "error", code: "service_unavailable", status: 503 },
                503,
              );
            return json(
              list(
                phase === 1
                  ? [notionPage(), notionPage(CHILD), notionPage(ROW)]
                  : [{ ...notionPage(), last_edited_time: "2026-10-18T05:31:56.000Z" }],
              ),
            );
          }
          if (url.pathname === `/v1/pages/${CHILD}`)
            return json(
              {
                object: "error",
                status: revokedStatus,
                code:
                  revokedStatus === 403 ? "restricted_resource" : "object_not_found",
              },
              revokedStatus,
            );
          if (url.pathname === `/v1/pages/${ROW}`)
            return json(
              { object: "error", status: 503, code: "service_unavailable" },
              503,
            );
          if (url.pathname.endsWith("/markdown"))
            return json(
              markdown(
                phase === 1
                  ? "Previous reliable source."
                  : "Updated research question.",
              ),
            );
          if (url.pathname.endsWith("/children")) return json(list([]));
          throw new Error(`Unexpected protocol request: ${url.pathname}`);
        }),
      });
      expect((await source.sync(library)).complete).toBe(true);
      phase = 2;
      const report = await source.sync(library);
      expect(report).toMatchObject({ imported: 1, removed: 1, complete: false });
      expect(report.failures.join("\n")).toContain(ROW);
      expect(library.getDocument(`notion:${PAGE}`)?.content).toContain(
        "Updated research question.",
      );
      expect(library.getDocument(`notion:${CHILD}`)?.active).toBe(false);
      expect(library.getDocument(`notion:${ROW}`)).toMatchObject({
        active: true,
        version: EDITED,
      });
      expect(library.getDocument(`notion:${ROW}`)?.content).toContain(
        "Previous reliable source.",
      );
      phase = 3;
      expect(await source.sync(library)).toMatchObject({
        imported: 0,
        removed: 0,
        complete: false,
      });
      expect(library.getDocument(`notion:${PAGE}`)?.active).toBe(true);
      expect(library.getDocument(`notion:${ROW}`)?.active).toBe(true);
    },
  );

  it("keeps the parent readable while reporting truncated and inaccessible Markdown subtrees", async () => {
    const library = new DocumentLibrary();
    const source = new NotionSource({
      token: "test-token",
      fetch: protocol((url) => {
        if (url.pathname === "/v1/search")
          return json(list([notionPage(), notionPage(ROW2)]));
        if (url.pathname === `/v1/pages/${PAGE}/markdown`)
          return json({
            ...markdown(
              `Available content\n<unknown url="${notionPage(CHILD).url}" alt="unloaded"/>`,
            ),
            truncated: true,
            unknown_block_ids: [CHILD],
          });
        if (url.pathname === `/v1/pages/${CHILD}/markdown`)
          return json({ object: "error", status: 404, code: "object_not_found" }, 404);
        if (url.pathname === `/v1/pages/${ROW2}/markdown`)
          return json(markdown("Other complete source"));
        if (url.pathname.endsWith("/children")) return json(list([]));
        throw new Error(`Unexpected request ${url.pathname}`);
      }),
    });
    const report = await source.sync(library);
    expect(report).toMatchObject({ imported: 2, removed: 0, complete: false });
    expect(report.failures.join("\n")).toContain(CHILD);
    expect(library.getDocument(`notion:${PAGE}`)).toMatchObject({
      active: true,
      metadata: { status: "partial", truncated: true, unknownBlockIds: [CHILD] },
    });
    expect(library.getDocument(`notion:${PAGE}`)?.content).toContain(
      "Available content",
    );
    expect(library.getDocument(`notion:${ROW2}`)?.metadata?.status).toBe("complete");
  });

  it("preserves database property values beyond the inline relation limit and reports a capped database query", async () => {
    const library = new DocumentLibrary();
    const source = new NotionSource({
      token: "test-token",
      fetch: protocol((url) => {
        if (url.pathname === "/v1/search")
          return json(list([{ object: "data_source", id: DATA_SOURCE }]));
        if (url.pathname === `/v1/data_sources/${DATA_SOURCE}/query`)
          return json({
            ...list([
              {
                ...notionPage(ROW),
                properties: {
                  ...notionPage().properties,
                  Related: {
                    id: "rel",
                    type: "relation",
                    has_more: true,
                    relation: [{ id: CHILD }],
                  },
                },
              },
            ]),
            request_status: {
              type: "incomplete",
              incomplete_reason: "query_result_limit_reached",
            },
          });
        if (url.pathname === `/v1/pages/${ROW}/properties/rel`)
          return json(
            url.searchParams.has("start_cursor")
              ? list([
                  {
                    object: "property_item",
                    type: "relation",
                    id: "rel",
                    relation: { id: ROW2 },
                  },
                ])
              : list(
                  [
                    {
                      object: "property_item",
                      type: "relation",
                      id: "rel",
                      relation: { id: CHILD },
                    },
                  ],
                  "property-next",
                ),
          );
        if (url.pathname.endsWith("/markdown"))
          return json(markdown("Method evidence"));
        if (url.pathname.endsWith("/children")) return json(list([]));
        throw new Error(`Unexpected request ${url.pathname}`);
      }),
    });
    const report = await source.sync(library);
    expect(report).toMatchObject({ imported: 1, removed: 0, complete: false });
    expect(report.failures.join("\n")).toContain("query result truncated");
    expect(library.getDocument(`notion:${ROW}`)?.content).toContain(
      "https://www.notion.so/8c90c3cc0d444b5088888dd25736052a",
    );
    expect(library.getDocument(`notion:${ROW}`)?.metadata?.properties).toMatchObject({
      Related: { has_more: false, relation: [{ id: CHILD }, { id: ROW2 }] },
    });
  });
});
