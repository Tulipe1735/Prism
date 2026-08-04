import {
  ORCHESTRATION_START_RESPONSE_SCHEMA_VERSION,
  orchestrationStartResponseSchema,
} from "@prism/contracts";

import { startMockHybridRun } from "../../../../../lib/server/run-repository";
import {
  contractErrorResponse,
  JSON_RESPONSE_HEADERS,
} from "../../../contract-response";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;

  try {
    const started = await startMockHybridRun(runId);
    if (!started) {
      return contractErrorResponse(
        404,
        "run_not_found",
        "The requested Run does not exist.",
      );
    }

    return Response.json(
      orchestrationStartResponseSchema.parse({
        schemaVersion: ORCHESTRATION_START_RESPONSE_SCHEMA_VERSION,
        status: "started",
        runId,
      }),
      { status: 202, headers: JSON_RESPONSE_HEADERS },
    );
  } catch {
    return contractErrorResponse(
      500,
      "run_storage_error",
      "Prism could not start the durable mock Run.",
    );
  }
}
