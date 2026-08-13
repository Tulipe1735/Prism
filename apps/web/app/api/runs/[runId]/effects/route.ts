import {
  effectDecisionRequestSchema,
  RUN_DOSSIER_RESPONSE_SCHEMA_VERSION,
  runDossierResponseSchema,
} from "@prism/contracts";

import { decideRunEffect } from "../../../../../lib/server/run-repository";
import {
  contractErrorResponse,
  JSON_RESPONSE_HEADERS,
} from "../../../contract-response";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return contractErrorResponse(400, "invalid_json", "The request body is not JSON.");
  }
  const parsed = effectDecisionRequestSchema.safeParse(input);
  if (!parsed.success) {
    return contractErrorResponse(
      400,
      "invalid_effect_decision",
      "The effect decision does not match its contract.",
    );
  }

  try {
    const dossier = await decideRunEffect(runId, parsed.data);
    if (!dossier) {
      return contractErrorResponse(
        404,
        "run_not_found",
        "The requested Run does not exist.",
      );
    }
    return Response.json(
      runDossierResponseSchema.parse({
        schemaVersion: RUN_DOSSIER_RESPONSE_SCHEMA_VERSION,
        dossier,
      }),
      { headers: JSON_RESPONSE_HEADERS },
    );
  } catch (error) {
    return error instanceof TypeError
      ? contractErrorResponse(409, "stale_effect", error.message)
      : contractErrorResponse(
          500,
          "run_storage_error",
          "Prism could not commit the effect decision.",
        );
  }
}
