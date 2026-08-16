import {
  EVALUATION_RESPONSE_SCHEMA_VERSION,
  evaluationResponseSchema,
} from "@prism/contracts";

import { resumeEvaluation } from "../../../../../lib/server/evaluation-repository";
import {
  contractErrorResponse,
  JSON_RESPONSE_HEADERS,
} from "../../../contract-response";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ evaluationId: string }> },
) {
  try {
    const { evaluationId } = await params;
    return Response.json(
      evaluationResponseSchema.parse({
        schemaVersion: EVALUATION_RESPONSE_SCHEMA_VERSION,
        report: await resumeEvaluation(evaluationId),
      }),
      { headers: JSON_RESPONSE_HEADERS },
    );
  } catch (error) {
    if (error instanceof Error && error.message === "Evaluation does not exist.") {
      return contractErrorResponse(404, "run_not_found", error.message);
    }
    return contractErrorResponse(
      500,
      "run_storage_error",
      "Prism could not resume the evaluation.",
    );
  }
}
