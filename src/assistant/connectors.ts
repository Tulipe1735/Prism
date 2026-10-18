import type { LookupAddress } from "node:dns";
import type { Document } from "./types.ts";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import dns from "node:dns/promises";
import { request as requestHttp } from "node:http";
import { request as requestHttps } from "node:https";
import { BlockList, isIP } from "node:net";
import { load } from "cheerio";
import { XMLParser, XMLValidator } from "fast-xml-parser";

type Json = Record<string, unknown>;
type Fetch = typeof globalThis.fetch;
export interface DocumentStore {
  getDocument: (id: string) => Document | undefined;
  listDocuments: () => Document[];
  upsertDocument: (document: Document) => void;
  removeDocument: (id: string) => void;
}

export class SourceError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "SourceError";
    this.status = status;
  }
}

function object(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SourceError("Invalid source response: expected an object");
  return value as Json;
}
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function richText(value: unknown): string {
  return array(value)
    .map((part) => {
      const item = object(part);
      return (
        text(item.plain_text) || (item.text ? text(object(item.text).content) : "")
      );
    })
    .join("");
}
function version(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
function htmlText(html: string): string {
  const $ = load(html);
  $("script, style, noscript, iframe, template, svg").remove();
  $("a[href]").each((_, element) => {
    const anchor = $(element);
    const href = anchor.attr("href") || "";
    if (/^https?:\/\//i.test(href) && anchor.text().trim() !== href)
      anchor.append(` (${href})`);
  });
  $("br").replaceWith("\n");
  $("p, div, h1, h2, h3, h4, li, section, article, tr, pre").each((_, element) => {
    $(element).append("\n");
  });
  return $("body")
    .text()
    .replace(/[\t \u00A0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function withTimeout(signal?: AbortSignal, milliseconds = 20_000): AbortSignal {
  const timeout = AbortSignal.timeout(milliseconds);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
async function readBytes(
  response: Response,
  signal: AbortSignal,
  maxBytes = 8 * 1024 * 1024,
): Promise<Uint8Array> {
  signal.throwIfAborted();
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw new SourceError("Source response exceeds the byte limit");
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = (): void => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await abortable(reader.read(), signal);
      signal.throwIfAborted();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes)
        throw new SourceError("Source response exceeds the byte limit");
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    signal.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
async function requestJson(
  fetch: Fetch,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<Json> {
  signal.throwIfAborted();
  const response = await abortable(
    fetch(url, { ...init, signal, redirect: "error" }),
    signal,
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new SourceError(
      `${new URL(url).hostname}: HTTP ${response.status}`,
      response.status,
    );
  }
  const bytes = await readBytes(response, signal);
  try {
    return object(JSON.parse(Buffer.from(bytes).toString("utf8")));
  } catch {
    throw new SourceError(`${new URL(url).hostname}: invalid JSON response`);
  }
}

export interface SyncReport {
  imported: number;
  removed: number;
  failures: string[];
  complete: boolean;
}

function notionUrl(id: string): string {
  return `https://www.notion.so/${id.replaceAll("-", "")}`;
}
function notionProperty(property: Json): string {
  const type = text(property.type);
  const value = property[type];
  if (type === "title" || type === "rich_text") return richText(value);
  if (type === "relation")
    return array(value)
      .map((item) => notionUrl(text(object(item).id)))
      .join(", ");
  if (type === "files")
    return array(value)
      .map((item) => {
        const file = object(item);
        const url = text(object(file[text(file.type)]).url);
        return `[${text(file.name) || "Attachment"}](${url}) (attachment; unread)`;
      })
      .join(", ");
  if (type === "select" || type === "status")
    return value ? text(object(value).name) : "";
  if (type === "multi_select" || type === "people")
    return array(value)
      .map((item) => text(object(item).name) || text(object(item).id))
      .join(", ");
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** Read-only Notion API adapter. Markdown copies are written only to the library. */
export class NotionSource {
  private fetch: Fetch;
  private options: { token: string; fetch?: Fetch };
  constructor(options: { token: string; fetch?: Fetch }) {
    this.options = options;
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async sync(store: DocumentStore, signal?: AbortSignal): Promise<SyncReport> {
    const report: SyncReport = {
      imported: 0,
      removed: 0,
      failures: [],
      complete: true,
    };
    const operation = withTimeout(signal, 10 * 60_000);
    const headers = {
      Authorization: `Bearer ${this.options.token}`,
      "Notion-Version": "2026-03-11",
      "Content-Type": "application/json",
    };
    let requests = 0;
    const request = (path: string, body?: Json): Promise<Json> => {
      if (++requests > 2_000)
        throw new SourceError(
          "Notion synchronization request limit reached; remaining scope not covered",
        );
      return requestJson(
        this.fetch,
        `https://api.notion.com/v1${path}`,
        {
          headers,
          method: body ? "POST" : "GET",
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
        withTimeout(operation),
      );
    };
    const paginate = async function* (path: string, body?: Json): AsyncGenerator<Json> {
      let cursor: string | undefined;
      const cursors = new Set<string>();
      do {
        const url = new URL(`https://api.notion.com/v1${path}`);
        if (!body) {
          url.searchParams.set("page_size", "100");
          if (cursor) url.searchParams.set("start_cursor", cursor);
        }
        const listing = await request(
          `${url.pathname.slice(3)}${url.search}`,
          body
            ? { ...body, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }
            : undefined,
        );
        if (!Array.isArray(listing.results) || typeof listing.has_more !== "boolean")
          throw new SourceError(`Notion ${path}: invalid pagination response`);
        if (
          listing.request_status &&
          object(listing.request_status).type === "incomplete"
        )
          fail(`Notion ${path}`, new SourceError("query result truncated"));
        for (const item of listing.results) yield object(item);
        if (!listing.has_more) return;
        cursor = text(listing.next_cursor);
        if (!cursor || cursors.has(cursor))
          throw new SourceError(
            `Notion ${path}: missing or repeated pagination cursor`,
          );
        cursors.add(cursor);
      } while (true);
    };
    const seen = new Set<string>();
    const blocksSeen = new Set<string>();
    const revoke = (id: string): void => {
      const previous = store.getDocument(`notion:${id}`);
      if (previous && previous.active !== false) {
        store.removeDocument(previous.id);
        report.removed++;
      }
    };
    function fail(scope: string, error: unknown): void {
      report.complete = false;
      report.failures.push(
        `${scope}: ${error instanceof Error ? error.message : "Notion source failure"}`,
      );
    }
    async function scanBlocks(id: string): Promise<void> {
      if (blocksSeen.has(id)) return;
      blocksSeen.add(id);
      for await (const block of paginate(`/blocks/${id}/children`)) {
        const childId = text(block.id);
        if (block.type === "child_page") await visit({ object: "page", id: childId });
        else if (block.type === "child_database")
          await visit({ object: "database", id: childId });
        else if (block.has_children) await scanBlocks(childId);
      }
    }
    async function visit(entry: Json): Promise<void> {
      try {
        await importEntry(entry);
      } catch (error) {
        if (
          entry.object === "page" &&
          error instanceof SourceError &&
          (error.status === 403 || error.status === 404)
        )
          revoke(text(entry.id));
        fail(`Notion ${text(entry.object)} ${text(entry.id)}`, error);
      }
    }
    async function importEntry(entry: Json): Promise<void> {
      const id = text(entry.id);
      const key = `${text(entry.object)}:${id}`;
      if (!id || seen.has(key)) return;
      seen.add(key);
      if (entry.object === "database") {
        const database = await request(`/databases/${id}`);
        for (const source of array(database.data_sources))
          await visit({ ...object(source), object: "data_source" });
        return;
      }
      if (entry.object === "data_source") {
        for await (const row of paginate(`/data_sources/${id}/query`, {}))
          await visit(row);
        return;
      }
      if (entry.object !== "page") return;
      const page = entry.properties ? entry : await request(`/pages/${id}`);
      if (page.in_trash || page.is_archived) {
        revoke(id);
        return;
      }
      const properties = object(page.properties);
      const rendered = await request(`/pages/${id}/markdown`);
      if (typeof rendered.markdown !== "string")
        throw new SourceError("Notion: Markdown content is missing");
      const warnings: string[] = [];
      const warn = (message: string): void => {
        warnings.push(message);
        fail(`Notion page ${id}`, new SourceError(message));
      };
      for (const [name, value] of Object.entries(properties)) {
        const property = object(value);
        const type = text(property.type);
        if (
          !property.has_more &&
          (!(
            type === "title" ||
            type === "rich_text" ||
            type === "people" ||
            type === "relation"
          ) ||
            array(property[type]).length < 25)
        )
          continue;
        try {
          const items: unknown[] = [];
          for await (const item of paginate(
            `/pages/${id}/properties/${encodeURIComponent(text(property.id))}`,
          ))
            items.push(item[type]);
          properties[name] = { ...property, [type]: items, has_more: false };
        } catch (error) {
          warn(
            `Property ${name} incomplete: ${error instanceof Error ? error.message : "read failed"}`,
          );
        }
      }
      const title = Object.values(properties)
        .map((property) => object(property))
        .find((property) => property.type === "title");
      let content = rendered.markdown;
      const unknownBlockIds = array(rendered.unknown_block_ids).map(text);
      const recovered = new Set<string>([id]);
      const recover = async (blockId: string): Promise<void> => {
        if (recovered.has(blockId)) {
          warn(`Repeated unloaded Markdown block ${blockId}`);
          return;
        }
        recovered.add(blockId);
        try {
          const subtree = await request(`/pages/${blockId}/markdown`);
          if (typeof subtree.markdown !== "string")
            throw new SourceError("Markdown content missing");
          content += `\n\n## Additional source subtree (${notionUrl(blockId)})\n\n${subtree.markdown}`;
          if (subtree.truncated) warn(`Markdown subtree ${blockId} is truncated`);
          for (const child of array(subtree.unknown_block_ids))
            await recover(text(child));
        } catch (error) {
          warn(
            `Unloaded Markdown block ${blockId}: ${error instanceof Error ? error.message : "read failed"}`,
          );
        }
      };
      if (rendered.truncated || unknownBlockIds.length || /<unknown\b/i.test(content))
        warn(
          `Markdown is incomplete or unsupported; unloaded blocks: ${unknownBlockIds.join(", ") || "not identified"}`,
        );
      for (const blockId of unknownBlockIds) await recover(blockId);
      for (const warning of array(rendered.warnings))
        warn(
          `Markdown warning: ${text(object(warning).code)} ${text(object(warning).message)}`,
        );
      if (content.length > 1_000_000) {
        content = content.slice(0, 1_000_000);
        warn("Markdown text limit reached; remaining content not covered");
      }
      try {
        await scanBlocks(id);
      } catch (error) {
        warn(
          `Child traversal incomplete: ${error instanceof Error ? error.message : "read failed"}`,
        );
      }
      const propertyMarkdown = Object.entries(properties)
        .map(([name, property]) => `- **${name}**: ${notionProperty(object(property))}`)
        .join("\n");
      const attachments = Object.values(properties).flatMap((property) => {
        const value = object(property);
        return value.type === "files"
          ? array(value.files).map((item) => {
              const file = object(item);
              return {
                name: text(file.name),
                url: text(object(file[text(file.type)]).url),
                status: "unread",
              };
            })
          : [];
      });
      const attachmentUrls = new Set(attachments.map((file) => file.url));
      const addAttachment = (name: string, href: string, embedded: boolean): void => {
        try {
          const url = new URL(href, text(page.url) || notionUrl(id));
          if (
            !["http:", "https:"].includes(url.protocol) ||
            (!embedded &&
              !/\.(?:pdf|docx?|pptx?|xlsx?|csv|zip|png|jpe?g|gif|webp|svg|mp[34]|wav|ogg|mov)$/i.test(
                url.pathname,
              )) ||
            attachmentUrls.has(url.toString())
          )
            return;
          attachmentUrls.add(url.toString());
          attachments.push({ name, url: url.toString(), status: "unread" });
        } catch {
          /* Invalid references are not downloaded or represented as read content. */
        }
      };
      for (const match of content.matchAll(
        /(!?)\[([^\]\n]*)\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+"[^"]*")?\s*\)/g,
      ))
        addAttachment(
          match[2] || "Attachment",
          match[3] || match[4] || "",
          match[1] === "!",
        );
      const markup = load(content);
      markup(
        "file[src], file[href], pdf[src], image[src], img[src], audio[src], video[src]",
      ).each((_, element) => {
        const file = markup(element);
        addAttachment(
          file.text().trim() || file.attr("alt") || "Attachment",
          file.attr("src") || file.attr("href") || "",
          true,
        );
      });
      const document: Document = {
        id: `notion:${id}`,
        source: "notion",
        title: title ? richText(title.title) : "Untitled",
        url: text(page.url) || notionUrl(id),
        content: `${propertyMarkdown}\n\n${content}`,
        version: text(page.last_edited_time),
        updatedAt: text(page.last_edited_time),
        active: true,
        metadata: {
          status: warnings.length ? "partial" : "complete",
          pageId: id,
          properties,
          parent: page.parent,
          attachments,
          warnings,
          truncated: rendered.truncated === true,
          unknownBlockIds,
        },
      };
      const previous = store.getDocument(document.id);
      if (JSON.stringify(previous) !== JSON.stringify(document)) {
        store.upsertDocument(document);
        report.imported++;
      }
    }
    try {
      for await (const entry of paginate("/search", {})) await visit(entry);
      // Search can lag behind changes and never proves that a missing page was deleted.
      // Recheck each known active page directly before withdrawing its copy.
      for (const document of store.listDocuments()) {
        if (document.source !== "notion" || document.active === false) continue;
        const id =
          text(document.metadata?.pageId) || document.id.slice("notion:".length);
        if (!seen.has(`page:${id}`)) await visit({ object: "page", id });
      }
    } catch (error) {
      fail("Notion discovery", error);
    }
    return report;
  }
}

const ARXIV_ID = "(?:\\d{4}\\.\\d{4,5}|[a-z][a-z.-]*/\\d{7})(?:v\\d+)?";
function paperId(id: string): string {
  return id.replace(/v\d+$/, "");
}

/** OAuth refresh and Gmail's documented JSON MIME protocol, not browser cookies. */
export class GmailSource {
  private fetch: Fetch;
  private options: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    query?: string;
    fetch?: Fetch;
  };
  constructor(options: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    query?: string;
    fetch?: Fetch;
  }) {
    this.options = options;
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async collect(
    signal?: AbortSignal,
    processedMessageIds?: ReadonlySet<string>,
  ): Promise<Document[]> {
    const operation = withTimeout(signal, 90_000);
    const token = await requestJson(
      this.fetch,
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.options.clientId,
          client_secret: this.options.clientSecret,
          refresh_token: this.options.refreshToken,
          grant_type: "refresh_token",
        }).toString(),
      },
      withTimeout(operation),
    );
    if (!text(token.access_token))
      throw new SourceError("Gmail OAuth refresh did not return an access token");
    const headers = { Authorization: `Bearer ${text(token.access_token)}` };
    const request = (path: string): Promise<Json> =>
      requestJson(
        this.fetch,
        `https://gmail.googleapis.com/gmail/v1/users/me/${path}`,
        { headers },
        withTimeout(operation),
      );
    const documents = new Map<string, Document>();
    const papers = new Map<string, Document>();
    const messageIds = new Set<string>();
    let totalTextBytes = 0;
    let cursor = "";
    const cursors = new Set<string>();
    do {
      const params = new URLSearchParams({
        q: this.options.query ?? "from:arxiv.org",
        maxResults: "100",
      });
      if (cursor) params.set("pageToken", cursor);
      const listing = await request(`messages?${params}`);
      for (const entry of array(listing.messages)) {
        const id = text(object(entry).id);
        if (!id || messageIds.has(id) || processedMessageIds?.has(id)) continue;
        messageIds.add(id);
        if (messageIds.size > 1_000)
          throw new SourceError(
            "Gmail collection exceeds 1000 messages; narrow the subscription query",
          );
        const message = await request(`messages/${encodeURIComponent(id)}?format=full`);
        const payload = object(message.payload);
        const header = (name: string): Json | undefined =>
          array(payload.headers)
            .map(object)
            .find((item) => text(item.name).toLowerCase() === name.toLowerCase());
        const title = text(header("subject")?.value) || "Research subscription";
        const from = text(header("from")?.value);
        const plain: string[] = [];
        const html: string[] = [];
        const attachments: { name: string; attachmentId: string; status: string }[] =
          [];
        let parts = 0;
        const readPart = async (part: Json, depth = 0): Promise<void> => {
          if (++parts > 250 || depth > 20)
            throw new SourceError(`Gmail message ${id}: MIME nesting limit exceeded`);
          const body = part.body ? object(part.body) : {};
          const filename = text(part.filename);
          const mime = text(part.mimeType).toLowerCase();
          if (filename || (!mime.startsWith("text/") && body.attachmentId)) {
            attachments.push({
              name: filename || mime,
              attachmentId: text(body.attachmentId),
              status: "unread",
            });
            return;
          }
          if (mime === "text/plain" || mime === "text/html") {
            const data = body.attachmentId
              ? await request(
                  `messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(text(body.attachmentId))}`,
                )
              : body;
            if (typeof data.data === "string") {
              if (!/^[\w-]*={0,2}$/.test(data.data))
                throw new SourceError(`Gmail message ${id}: invalid base64url body`);
              const decoded = Buffer.from(data.data, "base64url").toString("utf8");
              (mime === "text/plain" ? plain : html).push(decoded);
            }
          }
          for (const child of array(part.parts))
            await readPart(object(child), depth + 1);
        };
        await readPart(payload);
        const content = plain.length
          ? plain.join("\n\n")
          : html.map(htmlText).join("\n\n");
        if (content.length > 1_000_000)
          throw new SourceError(`Gmail message ${id}: body text exceeds the limit`);
        totalTextBytes += Buffer.byteLength(content, "utf8");
        if (totalTextBytes > 8 * 1024 * 1024)
          throw new SourceError(
            "Gmail collection exceeds the total text limit; narrow the subscription query",
          );
        const time = Number(message.internalDate);
        const updatedAt =
          Number.isFinite(time) && time > 0
            ? new Date(time).toISOString()
            : new Date().toISOString();
        const url = `https://mail.google.com/mail/u/0/#all/${text(message.threadId) || id}`;
        const origins = {
          messageId: id,
          documentId: `gmail:${id}`,
          url,
          from,
          subject: title,
          receivedAt: updatedAt,
        };
        const candidates: string[] = [];
        const headersPattern = new RegExp(`^arXiv:\\s*(${ARXIV_ID})\\b`, "gim");
        const matches = [...content.matchAll(headersPattern)];
        const urlMatches = matches.length
          ? []
          : [
              ...content.matchAll(
                new RegExp(
                  `https?://(?:www\\.)?arxiv\\.org/(?:abs|pdf)/(${ARXIV_ID})`,
                  "gi",
                ),
              ),
            ];
        for (const [index, match] of [...matches, ...urlMatches].entries()) {
          const arxivId = paperId(match[1] ?? "");
          if (!arxivId) continue;
          const canonicalId = `arxiv:${arxivId}`;
          if (candidates.includes(canonicalId)) continue;
          candidates.push(canonicalId);
          const start = matches.length ? match.index : 0;
          const end = matches.length ? matches[index + 1]?.index : undefined;
          const excerpt = content.slice(start, end).trim();
          const paperTitle =
            /^Title:\s*(.+(?:\n[ \t].+)*)/im
              .exec(excerpt)?.[1]
              ?.replace(/\s+/g, " ")
              .trim() ||
            (!matches.length
              ? content
                  .slice(0, match.index)
                  .split("\n")
                  .pop()
                  ?.replace(/\s*\($/, "")
                  .trim()
              : "") ||
            `${title} — arXiv:${arxivId}`;
          const existing = papers.get(canonicalId);
          if (existing) {
            const metadata = existing.metadata ?? {};
            metadata.messageIds = [...array(metadata.messageIds), id];
            metadata.provenance = [...array(metadata.provenance), origins];
          } else {
            if (papers.size >= 2_000)
              throw new SourceError(
                "Gmail collection exceeds 2000 research candidates; narrow the subscription query",
              );
            papers.set(canonicalId, {
              id: `gmail-paper:${arxivId}`,
              source: "gmail",
              title: paperTitle,
              url: `https://arxiv.org/abs/${arxivId}`,
              content: excerpt,
              version: version(excerpt),
              updatedAt,
              active: true,
              metadata: {
                status: "complete",
                canonicalId,
                kind: "paper",
                arxivId,
                messageIds: [id],
                provenance: [origins],
              },
            });
          }
        }
        documents.set(`gmail:${id}`, {
          id: `gmail:${id}`,
          source: "gmail",
          title,
          url,
          content: content || text(message.snippet),
          version: version(content),
          updatedAt,
          active: true,
          metadata: {
            status: content ? "complete" : "partial",
            kind: "subscription-mail",
            envelopeOnly: candidates.length > 0,
            ...(candidates.length
              ? {}
              : {
                  canonicalId: `subscription:${version(content || text(message.snippet))}`,
                }),
            messageId: id,
            threadId: text(message.threadId),
            from,
            candidateItems: candidates,
            attachments,
            provenance: [origins],
          },
        });
      }
      cursor = text(listing.nextPageToken);
      if (cursor) {
        if (cursors.has(cursor) || cursors.size >= 100)
          throw new SourceError(
            "Gmail pagination is incomplete: repeated cursor or page limit reached",
          );
        cursors.add(cursor);
      }
    } while (cursor);
    return [...documents.values(), ...papers.values()];
  }
}

/** Read the official daily list. Search results are a different source. */
export class GitHubTrending {
  private fetch: Fetch;
  constructor(options: { fetch?: Fetch } = {}) {
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async collect(signal?: AbortSignal): Promise<Document[]> {
    const operation = withTimeout(signal);
    operation.throwIfAborted();
    const listUrl = "https://github.com/trending?since=daily";
    const response = await abortable(
      this.fetch(listUrl, {
        signal: operation,
        redirect: "error",
        headers: { Accept: "text/html", "User-Agent": "Prism-Personal-Assistant/0.1" },
      }),
      operation,
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new SourceError(
        `GitHub Trending: HTTP ${response.status}`,
        response.status,
      );
    }
    const $ = load(Buffer.from(await readBytes(response, operation)).toString("utf8"));
    const documents = new Map<string, Document>();
    const updatedAt = new Date().toISOString();
    $("article.Box-row").each((_, article) => {
      const row = $(article);
      const anchor = row.find("h2 a").first();
      const path = anchor.attr("href") ?? "";
      if (!/^\/[\w.-]+\/[\w.-]+$/.test(path)) return;
      const repo = path.slice(1);
      const canonicalId = `github:${repo.toLowerCase()}`;
      const description = row.find("p").first().text().replace(/\s+/g, " ").trim();
      const language = row.find("[itemprop='programmingLanguage']").text().trim();
      const count = (value: string): number =>
        Number(value.replaceAll(",", "").match(/\d+/)?.[0] ?? "0");
      const stars = count(row.find(`a[href$='/stargazers']`).first().text());
      const periodStars = count(row.find(".float-sm-right").text());
      const content = `# ${repo}\n\n${description}\n\nLanguage: ${language || "not provided"}\nStars: ${stars}; stars today: ${periodStars}\nSource: ${listUrl}`;
      documents.set(canonicalId, {
        id: canonicalId,
        source: "github",
        title: repo,
        url: `https://github.com/${repo}`,
        content,
        version: version(content),
        updatedAt,
        active: true,
        metadata: {
          canonicalId,
          status: "complete",
          coverage: "trending-listing",
          origin: "github-trending",
          listUrl,
          rank: documents.size + 1,
          dateRange: "daily",
          language,
          stars,
          periodStars,
        },
      });
    });
    if (!documents.size)
      throw new SourceError(
        "GitHub Trending markup unavailable or not recognized; this is not an empty recommendation result",
      );
    return [...documents.values()];
  }
}

export class ArxivSource {
  private fetch: Fetch;
  constructor(options: { fetch?: Fetch } = {}) {
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async search(
    query: string,
    maxResults = 10,
    signal?: AbortSignal,
  ): Promise<Document[]> {
    if (!query.trim() || query.length > 4_000)
      throw new SourceError("arXiv search requires a query of 1–4000 characters");
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 50)
      throw new SourceError("arXiv search allows 1–50 results per request");
    const operation = withTimeout(signal);
    operation.throwIfAborted();
    const params = new URLSearchParams({
      search_query: query,
      start: "0",
      max_results: String(maxResults),
      sortBy: "submittedDate",
      sortOrder: "descending",
    });
    const response = await abortable(
      this.fetch(`https://export.arxiv.org/api/query?${params}`, {
        signal: operation,
        redirect: "error",
        headers: {
          Accept: "application/atom+xml",
          "User-Agent": "Prism-Personal-Assistant/0.1",
        },
      }),
      operation,
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new SourceError(`arXiv: HTTP ${response.status}`, response.status);
    }
    const xml = Buffer.from(await readBytes(response, operation)).toString("utf8");
    if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)
      throw new SourceError("arXiv returned invalid or unsupported XML");
    const parser = new XMLParser({
      ignoreAttributes: false,
      removeNSPrefix: true,
      parseTagValue: false,
      isArray: (name) => ["entry", "author", "link", "category"].includes(name),
    });
    const parsed = object(parser.parse(xml));
    if (!parsed.feed) throw new SourceError("arXiv response is not an Atom feed");
    const feed = object(parsed.feed);
    const documents = new Map<string, Document>();
    for (const value of array(feed.entry)) {
      const entry = object(value);
      const matched = new RegExp(`/abs/(${ARXIV_ID})$`, "i").exec(text(entry.id));
      if (!matched?.[1])
        throw new SourceError(
          "arXiv returned an error entry or an unrecognized paper ID",
        );
      const id = paperId(matched[1]);
      const canonicalId = `arxiv:${id}`;
      const title = text(entry.title).replace(/\s+/g, " ").trim();
      const authors = array(entry.author).map((author) => text(object(author).name));
      const categories = array(entry.category).map((category) =>
        text(object(category)["@_term"]),
      );
      const pdf = array(entry.link)
        .map(object)
        .find(
          (link) => link["@_type"] === "application/pdf" || link["@_title"] === "pdf",
        );
      const pdfUrl = pdf ? text(pdf["@_href"]).replace(/^http:/, "https:") : "";
      const content = `# ${title}\n\nAuthors: ${authors.join(", ")}\nPublished: ${text(entry.published)}\nUpdated: ${text(entry.updated)}\n\n## Abstract\n\n${text(entry.summary).trim()}\n\n${pdfUrl ? `PDF: ${pdfUrl} (linked; not read)` : "PDF not provided"}`;
      documents.set(canonicalId, {
        id: canonicalId,
        source: "arxiv",
        title,
        url: `https://arxiv.org/abs/${id}`,
        content,
        version: text(entry.updated) || matched[1],
        updatedAt: text(entry.updated) || new Date().toISOString(),
        active: true,
        metadata: {
          canonicalId,
          status: "complete",
          coverage: "abstract",
          arxivId: id,
          authors,
          categories,
          published: text(entry.published),
          query,
          attachments: pdfUrl ? [{ url: pdfUrl, status: "unread" }] : [],
        },
      });
    }
    return [...documents.values()].slice(0, maxResults);
  }
}

const blockedV4 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blockedV4.addSubnet(address, prefix, "ipv4");
const blockedV6 = new BlockList();
for (const [address, prefix] of [
  ["::", 96],
  ["::ffff:0:0", 96],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
] as const)
  blockedV6.addSubnet(address, prefix, "ipv6");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
function publicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedV4.check(address, "ipv4");
  return (
    family === 6 && globalV6.check(address, "ipv6") && !blockedV6.check(address, "ipv6")
  );
}
async function resolvePublic(url: URL, signal: AbortSignal): Promise<LookupAddress[]> {
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && url.port !== (url.protocol === "https:" ? "443" : "80"))
  )
    throw new SourceError(
      "Web source must use an unauthenticated HTTP(S) URL on its standard port",
    );
  const hostname = url.hostname
    .replace(/^\[|\]$/g, "")
    .toLowerCase()
    .replace(/\.$/, "");
  if (
    !hostname ||
    hostname === "localhost" ||
    /\.(?:localhost|local|internal|home|lan)$/.test(hostname)
  )
    throw new SourceError("Web source resolves to a private or local destination");
  const family = isIP(hostname);
  const addresses = family
    ? [{ address: hostname, family }]
    : await abortable(dns.lookup(hostname, { all: true, verbatim: true }), signal);
  if (!addresses.length || addresses.some((entry) => !publicAddress(entry.address)))
    throw new SourceError(
      "Web source resolves to a private, reserved or non-public address",
    );
  return addresses;
}

// Pin the validated address on the actual connection: a second DNS resolution by
// fetch would allow a malicious hostname to change from a public to a private IP.
function pinnedRequest(
  url: URL,
  addresses: LookupAddress[],
  signal: AbortSignal,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const address = addresses[0];
    if (!address) {
      reject(new SourceError("Web source has no public address"));
      return;
    }
    const request = (url.protocol === "https:" ? requestHttps : requestHttp)(
      url,
      {
        signal,
        lookup: (_hostname, lookupOptions, callback) => {
          if (lookupOptions.all) callback(null, addresses);
          else callback(null, address.address, address.family);
        },
        headers: {
          Accept: "text/html,application/pdf,text/plain,text/markdown",
          "Accept-Encoding": "identity",
          "User-Agent": "Prism-Personal-Assistant/0.1",
        },
      },
      (response) => {
        const status = response.statusCode ?? 502;
        if (status < 200 || status > 599) {
          response.destroy();
          reject(new SourceError("Web source returned an invalid HTTP status"));
          return;
        }
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers))
          if (value !== undefined)
            headers.set(name, Array.isArray(value) ? value.join(", ") : value);
        if (status >= 300 && status < 400) {
          response.destroy();
          resolve(new Response(null, { status, headers }));
          return;
        }
        if (Number(headers.get("content-length")) > 8 * 1024 * 1024) {
          response.destroy();
          reject(new SourceError("Web document exceeds the byte limit"));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 8 * 1024 * 1024) {
            response.destroy();
            reject(new SourceError("Web document exceeds the byte limit"));
          } else chunks.push(chunk);
        });
        response.on("end", () => {
          try {
            resolve(
              new Response(
                status === 204 || status === 205 ? null : Buffer.concat(chunks),
                { status, headers },
              ),
            );
          } catch {
            reject(new SourceError("Web source returned an invalid response"));
          }
        });
        response.on("error", reject);
        response.on("aborted", () =>
          reject(new SourceError("Web response was interrupted")),
        );
      },
    );
    request.on("error", reject);
    request.end();
  });
}

/** Bounded source reading; linked attachments are references until separately read. */
export async function readWebDocument(
  input: string,
  options: { fetch?: Fetch; signal?: AbortSignal } = {},
): Promise<Document> {
  const signal = withTimeout(options.signal, 30_000);
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SourceError("Invalid web source URL");
  }
  url.hash = "";
  const originalUrl = url.toString();
  let response: Response | undefined;
  const visited = new Set<string>();
  for (let redirects = 0; redirects <= 5; redirects++) {
    signal.throwIfAborted();
    if (visited.has(url.toString())) throw new SourceError("Web redirect loop");
    visited.add(url.toString());
    const addresses = await resolvePublic(url, signal);
    response = await abortable(
      options.fetch
        ? options.fetch(url.toString(), {
            signal,
            redirect: "manual",
            headers: { Accept: "text/html,application/pdf,text/plain,text/markdown" },
          })
        : pinnedRequest(url, addresses, signal),
      signal,
    );
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    void response.body?.cancel().catch(() => {});
    if (!location || redirects === 5)
      throw new SourceError("Web redirect limit reached or location missing");
    const next = new URL(location, url);
    if (url.protocol === "https:" && next.protocol !== "https:")
      throw new SourceError("Web redirect downgraded HTTPS");
    url = next;
    url.hash = "";
    response = undefined;
  }
  if (!response?.ok) {
    void response?.body?.cancel().catch(() => {});
    throw new SourceError(
      `Web source: HTTP ${response?.status ?? "unknown"}`,
      response?.status,
    );
  }
  const bytes = await readBytes(response, signal);
  const encoding = response.headers.get("content-encoding");
  if (encoding && encoding.toLowerCase() !== "identity" && !options.fetch)
    throw new SourceError(`Unsupported web content encoding: ${encoding}`);
  const contentType =
    (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ||
    "application/octet-stream";
  if (
    contentType === "application/pdf" ||
    Buffer.from(bytes.subarray(0, 5)).toString("ascii") === "%PDF-"
  ) {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({
      data: bytes,
      isEvalSupported: false,
      useSystemFonts: false,
      verbosity: 0,
    });
    const abort = (): void => {
      void parser.destroy().catch(() => {});
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      const parsed = await abortable(
        parser.getText({ first: 80, pageJoiner: "" }),
        signal,
      );
      const pages = parsed.pages.map((page) => ({
        number: page.num,
        locator: `page ${page.num}`,
      }));
      const fullText = parsed.pages
        .map((page) => `## Page ${page.num}\n\n${page.text.trim()}`)
        .join("\n\n");
      const readable = parsed.pages.some((page) => page.text.trim().length > 0);
      const content = readable ? fullText.slice(0, 1_000_000) : "";
      const truncated =
        parsed.total > parsed.pages.length || fullText.length > 1_000_000;
      return {
        id: `web:${version(url.toString())}`,
        source: "web",
        title: url.pathname.split("/").pop() || url.hostname,
        url: url.toString(),
        content,
        version:
          response.headers.get("etag") ||
          version(Buffer.from(bytes).toString("base64")),
        updatedAt: new Date().toISOString(),
        active: readable,
        metadata: {
          status: readable ? (truncated ? "partial" : "complete") : "unreadable",
          originalUrl,
          contentType: "application/pdf",
          format: "pdf",
          pageCount: parsed.total,
          pages,
          truncated,
          coverage: "extracted-text",
          attachments: [],
          warnings: readable
            ? truncated
              ? ["PDF reading capped at 80 pages or 1000000 text characters"]
              : []
            : ["PDF has no extractable text; scanned content has not been read"],
        },
      };
    } finally {
      signal.removeEventListener("abort", abort);
      await parser.destroy();
    }
  }
  if (
    !["text/html", "application/xhtml+xml", "text/plain", "text/markdown"].includes(
      contentType,
    )
  )
    throw new SourceError(`Unsupported web document format: ${contentType}`);
  const raw = Buffer.from(bytes).toString("utf8");
  const $ = load(raw);
  const title = contentType.includes("html")
    ? $("title").first().text().trim() || $("h1").first().text().trim() || url.hostname
    : url.pathname.split("/").pop() || url.hostname;
  const attachments: { url: string; status: "unread" }[] = [];
  if (contentType.includes("html"))
    $("a[href], img[src], iframe[src]").each((_, element) => {
      const href = $(element).attr("href") || $(element).attr("src");
      if (!href) return;
      try {
        const link = new URL(href, url);
        if (
          ["http:", "https:"].includes(link.protocol) &&
          (/\.(?:pdf|docx?|pptx?|xlsx?|zip|png|jpe?g)(?:$|\?)/i.test(link.pathname) ||
            element.tagName !== "a")
        )
          attachments.push({ url: link.toString(), status: "unread" });
      } catch {
        /* An invalid link is not fetched or represented as read content. */
      }
    });
  const fullText = contentType.includes("html") ? htmlText(raw) : raw;
  const content = fullText.slice(0, 1_000_000);
  return {
    id: `web:${version(url.toString())}`,
    source: "web",
    title,
    url: url.toString(),
    content,
    version:
      response.headers.get("etag") ||
      response.headers.get("last-modified") ||
      version(content),
    updatedAt: new Date().toISOString(),
    active: true,
    metadata: {
      status: fullText.length > content.length ? "partial" : "complete",
      originalUrl,
      contentType,
      attachments,
      truncated: fullText.length > content.length,
    },
  };
}
