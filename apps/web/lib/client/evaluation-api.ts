import {
  contractErrorSchema,
  evaluationListResponseSchema,
  type EvaluationReport,
  evaluationResponseSchema,
} from "@prism/contracts";

export class EvaluationApiError extends Error {}

async function trusted(response: Response): Promise<unknown> {
  const body = (await response.json()) as unknown;
  if (!response.ok) {
    const error = contractErrorSchema.safeParse(body);
    throw new EvaluationApiError(
      error.success ? error.data.message : "Prism returned an invalid error contract.",
    );
  }
  return body;
}

export async function fetchEvaluations(): Promise<EvaluationReport[]> {
  const response = await fetch("/api/evaluations", { cache: "no-store" });
  return evaluationListResponseSchema.parse(await trusted(response)).evaluations;
}

export async function startEvaluation(): Promise<EvaluationReport> {
  const response = await fetch("/api/evaluations", { method: "POST" });
  return evaluationResponseSchema.parse(await trusted(response)).report;
}

export async function fetchEvaluation(evaluationId: string): Promise<EvaluationReport> {
  const response = await fetch(`/api/evaluations/${encodeURIComponent(evaluationId)}`, {
    cache: "no-store",
  });
  return evaluationResponseSchema.parse(await trusted(response)).report;
}

export async function resumeEvaluation(
  evaluationId: string,
): Promise<EvaluationReport> {
  const response = await fetch(
    `/api/evaluations/${encodeURIComponent(evaluationId)}/resume`,
    { method: "POST" },
  );
  return evaluationResponseSchema.parse(await trusted(response)).report;
}
