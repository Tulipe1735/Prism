import {
  EVALUATION_RESPONSE_SCHEMA_VERSION,
  evaluationResponseSchema,
} from "@prism/contracts";

import { getEvaluation } from "../../../../lib/server/evaluation-repository";
import { contractErrorResponse, JSON_RESPONSE_HEADERS } from "../../contract-response";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ evaluationId: string }> },
) {
  try {
    const { evaluationId } = await params;
    const report = await getEvaluation(evaluationId);
    if (!report) {
      return contractErrorResponse(404, "run_not_found", "The requested evaluation does not exist.");
    }
    return Response.json(
      evaluationResponseSchema.parse({
        schemaVersion: EVALUATION_RESPONSE_SCHEMA_VERSION,
        report,
      }),
      { headers: JSON_RESPONSE_HEADERS },
    );
  } catch {
    return contractErrorResponse(500, "run_storage_error", "Prism could not read evaluation storage.");
  }
}
