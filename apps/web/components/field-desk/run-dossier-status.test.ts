import { describe, expect, it } from "vitest";

import { effectAuthorityEmptyMessage } from "./run-dossier-status";

describe("Run dossier effect authority status", () => {
  it("does not report an empty authority queue while orchestration is active", () => {
    expect(effectAuthorityEmptyMessage(true)).toContain(
      "initial read-only evidence is still running",
    );
    expect(effectAuthorityEmptyMessage(true)).not.toContain(
      "No effect is awaiting authority",
    );
  });

  it("reports the settled empty authority queue accurately", () => {
    expect(effectAuthorityEmptyMessage(false)).toContain(
      "No effect is awaiting authority",
    );
  });
});
