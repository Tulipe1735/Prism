import {
  EVALUATION_RESPONSE_SCHEMA_VERSION,
  evaluationListResponseSchema,
  evaluationResponseSchema,
} from "@prism/contracts";

import {
  createEvaluation,
  listEvaluations,
} from "../../../lib/server/evaluation-repository";
import { contractErrorResponse, JSON_RESPONSE_HEADERS } from "../contract-response";

export async function GET() {
  try {
    return Response.json(
      evaluationListResponseSchema.parse({
        schemaVersion: EVALUATION_RESPONSE_SCHEMA_VERSION,
        evaluations: await listEvaluations(),
      }),
      { headers: JSON_RESPONSE_HEADERS },
    );
  } catch {
    return contractErrorResponse(
      500,
      "run_storage_error",
      "Prism could not read evaluation storage.",
    );
  }
}

export async function POST() {
  try {
    return Response.json(
      evaluationResponseSchema.parse({
        schemaVersion: EVALUATION_RESPONSE_SCHEMA_VERSION,
        report: await createEvaluation(),
      }),
      { status: 201, headers: JSON_RESPONSE_HEADERS },
    );
  } catch (error) {
    return contractErrorResponse(
      500,
      "run_storage_error",
      error instanceof Error ? error.message : "Prism could not start the evaluation.",
    );
  }
}
