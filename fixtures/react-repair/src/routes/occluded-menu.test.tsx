import { readFile } from "node:fs/promises";

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OccludedMenuPage } from "./occluded-menu";

describe("occluded-menu fixture", () => {
  it("keeps the named trigger, menu item, and 44px controls", async () => {
    const markup = renderToString(<OccludedMenuPage />);
    const css = await readFile(new URL("./occluded-menu.css", import.meta.url), "utf8");

    expect(markup).toContain("Account menu");
    expect(markup).toContain('role="menuitem"');
    expect(markup).toContain("No selection");
    expect(css).toMatch(/\.account-menu button\s*\{[^}]*min-height:\s*44px/);
  });
});
