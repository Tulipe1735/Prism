import { readFile } from "node:fs/promises";

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RoundButtonPage } from "./routes/round-button";

/**
 * 场景相关测试（scenario-relevant tests）：
 * 这些不变量在已知缺陷态与任何合理修复态都必须成立，因此可作为
 * 编码 Oracle 要求的“相关测试” —— 修复不能破坏它们。
 */
describe("round-button fixture invariants", () => {
  it("renders a primary Save button with the exact label text", () => {
    const markup = renderToString(<RoundButtonPage />);

    expect(markup).toContain('aria-label="Save"');
    expect(markup).toMatch(/<button[^>]*>Save<\/button>/);
  });

  it("keeps the Save button enabled and clickable", () => {
    const markup = renderToString(<RoundButtonPage />);
    const button = /<button([^>]*)>Save<\/button>/.exec(markup);

    expect(button).not.toBeNull();
    expect(button![1]).not.toContain("disabled");
  });

  it("declares a stable control size on the Save button", async () => {
    const css = await readFile(new URL("./global.css", import.meta.url), "utf8");

    expect(css).toMatch(/\.save-button\s*\{[^}]*width:\s*96px[^}]*height:\s*44px/);
  });
});
