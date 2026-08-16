import type { ArtifactRef } from "@prism/contracts";

const MAX_TEXT_PREVIEW_BYTES = 256 * 1024;
const MAX_IMAGE_PREVIEW_BYTES = 5 * 1024 * 1024;

export function artifactPreviewKind(
  artifact: Pick<ArtifactRef, "byteLength" | "mediaType">,
): "image" | "text" | "metadata" {
  if (artifact.mediaType === "image/png") {
    return artifact.byteLength <= MAX_IMAGE_PREVIEW_BYTES ? "image" : "metadata";
  }
  const text =
    artifact.mediaType.startsWith("text/") ||
    artifact.mediaType === "application/json" ||
    artifact.mediaType.endsWith("+json");
  return text && artifact.byteLength <= MAX_TEXT_PREVIEW_BYTES ? "text" : "metadata";
}
