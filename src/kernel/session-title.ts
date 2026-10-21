import type { TaskContext } from "./loop.ts";
import type { SessionSummary } from "./session.ts";
import { basename, resolve } from "node:path";
import { notifySession } from "./context.ts";

export const SESSION_TITLE_PROMPT =
  "Generate a short session title for the user's task. Use the user's language, at most 12 Chinese characters or 6 words. Return only the title, without quotes, markdown or explanation. Do not answer or carry out the task.";

export function initialSessionTitle(workspace: string): string {
  return `${basename(resolve(workspace)) || workspace} · 新会话`;
}

/** Runs before the task loop, so rewriting the header cannot race with log appends. */
export async function nameSession(
  ctx: TaskContext,
  session: SessionSummary,
  text: string,
  signal: AbortSignal,
): Promise<void> {
  if (
    session.entryCount !== 0 ||
    (session.title !== undefined &&
      session.title !== initialSessionTitle(session.workspace))
  )
    return;
  try {
    let title = "";
    for await (const event of ctx.model.stream({
      messages: [
        { role: "system", content: SESSION_TITLE_PROMPT },
        { role: "user", content: text.slice(0, 2_000) },
      ],
      signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
    })) {
      if (event.type === "text") title += event.text;
      if (title.length > 200) break;
    }
    title =
      title
        .split(/\r?\n/)[0]
        ?.trim()
        .replace(/^["'“”「」`#\s]+|["'“”「」`\s]+$/g, "")
        .slice(0, 60) ?? "";
    if (signal.aborted || title === "") return;
    await ctx.sessions.rename(session.id, title);
    await notifySession(ctx, session.id);
  } catch {
    // Naming is optional; a provider failure must not prevent the user's task.
  }
}
