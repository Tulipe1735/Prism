export const NOTION_ORIGINS = [
  "https://app.notion.com",
  "https://www.notion.so",
  "https://notion.so",
  "https://www.notion.com",
];

export interface NotionDocument {
  url: string;
  title: string;
  revision: string;
  content: string;
  selection: string;
  editable: boolean;
}

export function isNotionUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      NOTION_ORIGINS.includes(url.origin)
    );
  } catch {
    return false;
  }
}

export function isNotionDocument(value: unknown): value is NotionDocument {
  if (value === null || typeof value !== "object") return false;
  const doc = value as Record<string, unknown>;
  return (
    typeof doc.url === "string" &&
    doc.url.length <= 2048 &&
    isNotionUrl(doc.url) &&
    typeof doc.title === "string" &&
    doc.title.length <= 1000 &&
    typeof doc.revision === "string" &&
    /^[a-f0-9]{64}$/.test(doc.revision) &&
    typeof doc.content === "string" &&
    doc.content.length <= 30_000 &&
    typeof doc.selection === "string" &&
    doc.selection.length <= 50_000 &&
    typeof doc.editable === "boolean"
  );
}
