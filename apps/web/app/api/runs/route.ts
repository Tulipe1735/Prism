import { RUN_LIST_SCHEMA_VERSION, runListSchema } from "@prism/contracts";

import { listRecentRuns } from "../../../lib/server/run-repository";
import { RUN_JSON_RESPONSE_HEADERS, runStorageErrorResponse } from "./response";

export async function GET() {
  try {
    const response = runListSchema.parse({
      schemaVersion: RUN_LIST_SCHEMA_VERSION,
      runs: await listRecentRuns(),
    });

    return Response.json(response, { headers: RUN_JSON_RESPONSE_HEADERS });
  } catch {
    return runStorageErrorResponse();
  }
}
