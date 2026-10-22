import type { WebAppDefinition } from "../../../packages/plugin-sdk/src/index.ts";
import { z } from "zod";

export const webAppOpenSchema = z
  .object({
    plugin: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    sessionId: z.string().uuid(),
    url: z.string().max(2048).optional(),
  })
  .strict();

export function allowsWebAppUrl(
  app: Pick<WebAppDefinition, "origins">,
  value: string,
): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      app.origins.includes(url.origin)
    );
  } catch {
    return false;
  }
}

export const webAppEditSchema = z
  .object({
    text: z.string().min(1).max(50_000),
    guard: z
      .object({
        token: z.string().regex(/^[\w-]{1,100}$/),
        url: z.string().max(2048),
        content: z.string().max(200_000),
        selection: z.string().max(50_000),
      })
      .strict(),
  })
  .strict();

/** Browser-owned evidence is checked again before inserting into an editable. */
export function editGuardExpression(input: z.infer<typeof webAppEditSchema>): string {
  return `(() => {
    const guard = ${JSON.stringify(input.guard)};
    if (location.href !== guard.url) return false;
    const element = document.querySelector('[data-prism-edit-token="' + guard.token + '"]');
    const selection = getSelection();
    return !!element && element.isConnected && element.isContentEditable &&
      (element === document.activeElement || element.contains(document.activeElement)) &&
      element.textContent === guard.content && !!selection && selection.rangeCount === 1 &&
      element.contains(selection.getRangeAt(0).commonAncestorContainer) && selection.toString() === guard.selection;
  })()`;
}
