import {
  CONTRACT_ERROR_SCHEMA_VERSION,
  contractErrorSchema,
  RUN_DOSSIER_RESPONSE_SCHEMA_VERSION,
  runDossierResponseSchema,
} from "@prism/contracts";

import { getRunDossier } from "../../../../lib/server/run-repository";
import { RUN_JSON_RESPONSE_HEADERS, runStorageErrorResponse } from "../response";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  let dossier;
  try {
    dossier = await getRunDossier(runId);
  } catch {
    return runStorageErrorResponse();
  }

  if (!dossier) {
    const error = contractErrorSchema.parse({
      schemaVersion: CONTRACT_ERROR_SCHEMA_VERSION,
      code: "run_not_found",
      message: "The requested Run does not exist.",
      issues: [],
    });
    return Response.json(error, {
      status: 404,
      headers: RUN_JSON_RESPONSE_HEADERS,
    });
  }

  const response = runDossierResponseSchema.parse({
    schemaVersion: RUN_DOSSIER_RESPONSE_SCHEMA_VERSION,
    dossier,
  });
  return Response.json(response, { headers: RUN_JSON_RESPONSE_HEADERS });
}
