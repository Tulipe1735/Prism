/**
 * GET /api/runs/[runId]/artifacts/[artifactHash] —— 读取内容寻址产物。
 *
 * 在 Run 快照中按哈希定位产物，读取字节并带正确媒体类型返回。
 * 图片内联展示（inline），其余产物作为附件下载（attachment），
 * 并禁用缓存与嗅探。
 */
import { getRunArtifact } from "../../../../../../lib/server/run-repository";
import { contractErrorResponse } from "../../../../contract-response";

/** 媒体类型到 Content-Disposition 的映射：仅图片内联展示。 */
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

  // 复制到独立 Uint8Array，避免把 ArrayBuffer 视图语义泄露给响应体
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
