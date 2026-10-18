import type { AssistantStore } from "./store.ts";
import type { Document, SourceKind } from "./types.ts";
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { pathToFileURL } from "node:url";

export type MarkdownInput = Omit<Document, "source" | "updatedAt"> & {
  source?: SourceKind;
  updatedAt?: string;
};

interface ParsedFile {
  format: "markdown" | "text" | "pdf" | "docx";
  parseStatus: "parsed" | "partial" | "unreadable";
  warnings: string[];
  pageCount?: number;
  unreadPages?: number[];
  textOnly?: boolean;
}

export class KnowledgeLibrary {
  private readonly store: AssistantStore;

  constructor(store: AssistantStore) {
    this.store = store;
  }

  importMarkdown(input: MarkdownInput): Document {
    const document: Document = {
      ...input,
      source: input.source ?? "file",
      version: input.version ?? hash(input.content),
      updatedAt: input.updatedAt ?? new Date().toISOString(),
    };
    this.store.upsertDocument(document);
    return this.store.getDocument(document.id)!;
  }

  async importFile(file: string): Promise<Document> {
    const path = await realpath(file);
    const info = await stat(path);
    if (!info.isFile()) throw new Error("Import requires a regular file.");
    if (info.size > 50 * 1024 * 1024)
      throw new Error("Files must be 50 MiB or smaller.");
    const extension = extname(path).toLowerCase();
    if (![".md", ".markdown", ".txt", ".pdf", ".docx"].includes(extension))
      throw new Error(
        "Unsupported file format. Import Markdown, plain text, text PDF, or DOCX.",
      );
    const bytes = await readFile(path);
    const version = hash(bytes);
    let content: string;
    let parsed: ParsedFile = {
      format: extension === ".txt" ? "text" : "markdown",
      parseStatus: "parsed",
      warnings: [],
    };
    if (extension === ".pdf") {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({
        data: new Uint8Array(bytes),
        isEvalSupported: false,
        useWorkerFetch: false,
        verbosity: 0,
      });
      try {
        const result = await parser.getText();
        const unreadPages = result.pages
          .filter((page) => !page.text.trim())
          .map((page) => page.num);
        content = result.pages
          .filter((page) => page.text.trim())
          .map((page) => `## Page ${page.num}\n\n${page.text.trim()}`)
          .join("\n\n");
        parsed = {
          format: "pdf",
          parseStatus: !content
            ? "unreadable"
            : unreadPages.length
              ? "partial"
              : "parsed",
          pageCount: result.total,
          unreadPages,
          textOnly: true,
          warnings: unreadPages.length
            ? [
                `No text extracted from pages ${unreadPages.join(", ")}; OCR was not performed.`,
              ]
            : [],
        };
      } finally {
        await parser.destroy();
      }
    } else if (extension === ".docx") {
      const mammoth = await import("mammoth");
      const result = await mammoth.default.extractRawText({ buffer: bytes });
      content = result.value.trim();
      parsed = {
        format: "docx",
        parseStatus: !content
          ? "unreadable"
          : result.messages.length
            ? "partial"
            : "parsed",
        textOnly: true,
        warnings: [
          ...result.messages.map((message) => message.message),
          "Text only; images, embedded files, and hyperlink targets have not been imported.",
        ],
      };
    } else content = bytes.toString("utf8").replace(/^\uFEFF/, "");
    const references = [
      ...content.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:[ \t][^)]*)?\)/g),
    ].map((match) => ({ url: match[1]!, status: "not-read" }));
    return this.importMarkdown({
      id: `file:${hash(path)}`,
      source: "file",
      title: /^#[ \t]+(\S.*)$/m.exec(content)?.[1]?.trim() ?? basename(path, extension),
      url: pathToFileURL(path).href,
      content,
      version,
      updatedAt: info.mtime.toISOString(),
      metadata: {
        filePath: path,
        ...parsed,
        references,
        warnings: [
          ...parsed.warnings,
          ...(references.length
            ? ["Linked files and external pages have not been read."]
            : []),
        ],
      },
    });
  }
}

function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
