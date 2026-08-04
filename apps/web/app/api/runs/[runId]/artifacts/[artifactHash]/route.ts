import { getRunArtifact } from "../../../../../../lib/server/run-repository";
import { contractErrorResponse } from "../../../../contract-response";

function dispositionFor(mediaType: string): string {
  return mediaType === "image/png" ? "inline" : "attachment";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string; artifactHash: string }> },
) {
  const { runId, artifactHash } = await params;
  let result;
  try {
    result = await getRunArtifact(runId, artifactHash);
  } catch {
    return contractErrorResponse(
      500,
      "run_storage_error",
      "Prism could not verify the requested Run artifact.",
    );
  }

  if (!result) {
    return contractErrorResponse(
      404,
      "run_not_found",
      "The requested Run or artifact does not exist.",
    );
  }

  const body = new Uint8Array(result.content.byteLength);
  body.set(result.content);
  return new Response(body.buffer, {
    headers: {
      "cache-control": "private, no-store",
      "content-disposition": dispositionFor(result.artifact.mediaType),
      "content-length": String(result.artifact.byteLength),
      "content-type": result.artifact.mediaType,
      "x-content-type-options": "nosniff",
    },
  });
}
