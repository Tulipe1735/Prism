import { htmlToText } from "html-to-text";

export interface HtmlContent {
  title: string;
  text: string;
}

const HEADINGS = ["h1", "h2", "h3", "h4", "h5", "h6"];
const SKIPPED = ["script", "style", "noscript", "svg", "img", "iframe", "template"];

/** Converts an HTML document into a title and readable text. */
export function extractHtml(html: string, pageUrl: string): HtmlContent {
  const origin = new URL(pageUrl).origin;
  const text = htmlToText(html, {
    wordwrap: false,
    selectors: [
      ...SKIPPED.map((selector) => ({ selector, format: "skip" as const })),
      ...HEADINGS.map((selector) => ({ selector, options: { uppercase: false } })),
      { selector: "a", options: { baseUrl: origin } },
      { selector: "table", format: "dataTable" },
    ],
  });
  return { title: extractTitle(html), text: tidy(text) };
}

function extractTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match?.[1]) return "";
  return decodeEntities(match[1]).replace(/\s+/g, " ").trim();
}

/** Collapses the blank-line runs that skipped elements leave behind. */
function tidy(text: string): string {
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const hex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (Number.isInteger(code) && code > 0 && code <= 0x10_ffff)
        return String.fromCodePoint(code);
      return match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}
