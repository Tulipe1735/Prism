import { readFile } from "node:fs/promises";

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MobileOverflowPage } from "./mobile-overflow";

describe("mobile-overflow fixture", () => {
  it("keeps named checkout actions and 44px controls", async () => {
    const markup = renderToString(<MobileOverflowPage />);
    const css = await readFile(
      new URL("./mobile-overflow.css", import.meta.url),
      "utf8",
    );

    expect(markup).toContain('aria-label="Checkout actions"');
    expect(markup).toContain("Place order");
    expect(css).toMatch(/\.checkout-actions button\s*\{[^}]*min-height:\s*44px/);
  });
});
