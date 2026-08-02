import {
  contractErrorSchema,
  type RepairRequest,
  type RunCreation,
  runCreationSchema,
  type RunDossier,
  runDossierResponseSchema,
  runListSchema,
  type RunSummary,
  type ValidationIssue,
  type WorkspaceEvidenceRecord,
  workspaceEvidenceResponseSchema,
  type WorkspaceRequest,
} from "@prism/contracts";

export class RunApiError extends Error {
  readonly issues: ValidationIssue[];

  constructor(message: string, issues: ValidationIssue[] = []) {
    super(message);
    this.name = "RunApiError";
    this.issues = issues;
  }
}

async function responseBody(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new RunApiError("Prism returned a response that was not valid JSON.");
  }
}

async function trustedBody(response: Response) {
  const body = await responseBody(response);

  if (!response.ok) {
    const parsedError = contractErrorSchema.safeParse(body);
    if (!parsedError.success) {
      throw new RunApiError("Prism returned an invalid error contract.");
    }

    throw new RunApiError(parsedError.data.message, parsedError.data.issues);
  }

  return body;
}

export async function submitRepairRequest(
  request: RepairRequest,
): Promise<RunCreation> {
  const response = await fetch("/api/repair-requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });

  const parsed = runCreationSchema.safeParse(await trustedBody(response));
  if (!parsed.success) {
    throw new RunApiError("Prism returned an invalid Run creation contract.");
  }

  return parsed.data;
}

export async function fetchRuns(): Promise<RunSummary[]> {
  const response = await fetch("/api/runs", { cache: "no-store" });
  const parsed = runListSchema.safeParse(await trustedBody(response));
  if (!parsed.success) {
    throw new RunApiError("Prism returned an invalid Run list contract.");
  }

  return parsed.data.runs;
}

export async function fetchRunDossier(runId: string): Promise<RunDossier> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`, {
    cache: "no-store",
  });
  const parsed = runDossierResponseSchema.safeParse(await trustedBody(response));
  if (!parsed.success) {
    throw new RunApiError("Prism returned an invalid Run dossier contract.");
  }

  return parsed.data.dossier;
}

export async function runWorkspaceRequest(
  runId: string,
  request: WorkspaceRequest,
): Promise<WorkspaceEvidenceRecord> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/workspace`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  const parsed = workspaceEvidenceResponseSchema.safeParse(await trustedBody(response));
  if (!parsed.success) {
    throw new RunApiError("Prism returned an invalid workspace evidence contract.");
  }

  return parsed.data.record;
}
