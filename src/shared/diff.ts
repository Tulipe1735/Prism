import { diff } from "node:util";

/** Body lines a diff carries before it is cut; the rest is summarised. */
const DEFAULT_MAX_LINES = 200;

export interface UnifiedDiffOptions {
  /** File name for the `---`/`+++` headers; shown as `a/…` and `b/…`. */
  path: string;
  /** True when the write creates the file, so the diff starts from `/dev/null`. */
  created?: boolean;
  /** Body lines to include; the default keeps one tool result readable. */
  maxLines?: number;
}

/**
 * A unified diff of two texts, rendered as one hunk and cut at `maxLines` body
 * lines. `""` means the texts are equal; a cut diff ends with a visible notice,
 * so the model and the workbench never mistake it for the whole change.
 */
export function unifiedDiff(
  before: string,
  after: string,
  options: UnifiedDiffOptions,
): string {
  if (before === after) return "";
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const body: string[] = [];
  let cut = false;

  // `diff(before, after)` reports op 1 for lines of `before` and op -1 for lines
  // of `after`; removals come first inside a changed block, the way a unified
  // diff reads.
  let removed: string[] = [];
  let added: string[] = [];
  const flush = (): void => {
    for (const [prefix, lines] of [
      ["-", removed],
      ["+", added],
    ] as const) {
      for (const text of lines) {
        if (body.length >= maxLines) {
          cut = true;
          break;
        }
        body.push(`${prefix}${text}`);
      }
      if (cut) break;
    }
    removed = [];
    added = [];
  };

  for (const [op, text] of diff(beforeLines, afterLines)) {
    if (op !== 0) {
      (op === 1 ? removed : added).push(text);
      continue;
    }
    flush();
    if (body.length >= maxLines) {
      cut = true;
      break;
    }
    body.push(` ${text}`);
  }
  if (!cut) flush();

  const header = options.created === true ? "--- /dev/null" : `--- a/${options.path}`;
  const range =
    beforeLines.length === 0
      ? `-0,0 +1,${afterLines.length}`
      : afterLines.length === 0
        ? `-1,${beforeLines.length} +0,0`
        : `-1,${beforeLines.length} +1,${afterLines.length}`;
  return [
    header,
    `+++ b/${options.path}`,
    `@@ ${range} @@`,
    ...body,
    ...(cut ? [cutNotice(maxLines)] : []),
  ].join("\n");
}

/** The visible end of a diff that was cut; not a line of either file. */
function cutNotice(maxLines: number): string {
  return `[diff cut after ${maxLines} lines]`;
}

/** One entry per line, without a phantom empty last line for a trailing newline. */
function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}
