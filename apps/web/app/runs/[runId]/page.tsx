import { notFound } from "next/navigation";

import { RunDossierView } from "@/components/field-desk/run-dossier";
import { getRunDossier } from "@/lib/server/run-repository";

export default async function RunDossierPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const dossier = await getRunDossier(runId);

  if (!dossier) {
    notFound();
  }

  return <RunDossierView initialDossier={dossier} runId={runId} />;
}
