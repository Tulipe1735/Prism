import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FormEnablementPage } from "./form-enablement";

describe("form-enablement fixture", () => {
  it("keeps native email semantics and a named Submit control", () => {
    const markup = renderToString(<FormEnablementPage />);

    expect(markup).toContain('type="email"');
    expect(markup).toContain("required");
    expect(markup).toMatch(/<button[^>]*type="submit"[^>]*>Submit<\/button>/);
  });
});
