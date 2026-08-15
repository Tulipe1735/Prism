import { readFile } from "node:fs/promises";

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CardShadowPage } from "./card-shadow";

describe("card-shadow fixture", () => {
  it("keeps a stable, named profile card", async () => {
    const markup = renderToString(<CardShadowPage />);
    const css = await readFile(new URL("./card-shadow.css", import.meta.url), "utf8");

    expect(markup).toContain('aria-label="Profile card"');
    expect(markup).toContain("Ada Lovelace");
    expect(css).toMatch(
      /\.profile-card\s*\{[^}]*width:\s*360px[^}]*min-height:\s*180px/,
    );
  });
});
