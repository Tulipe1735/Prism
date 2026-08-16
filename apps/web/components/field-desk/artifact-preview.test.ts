import { describe, expect, it } from "vitest";

import { artifactPreviewKind } from "./artifact-preview-kind";

describe("artifactPreviewKind", () => {
  it("loads only bounded image/text evidence and leaves traces as metadata", () => {
    expect(artifactPreviewKind({ mediaType: "image/png", byteLength: 1024 })).toBe(
      "image",
    );
    expect(
      artifactPreviewKind({
        mediaType: "application/vnd.prism.code-oracle-report+json",
        byteLength: 1024,
      }),
    ).toBe("text");
    expect(
      artifactPreviewKind({ mediaType: "application/json", byteLength: 300_000 }),
    ).toBe("metadata");
    expect(
      artifactPreviewKind({ mediaType: "application/zip", byteLength: 1024 }),
    ).toBe("metadata");
  });
});
