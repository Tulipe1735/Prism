import { notFound } from "next/navigation";

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

  return (
    <section className="py-12">
      <span className="font-mono text-[0.64rem] font-bold tracking-[0.14em]">
        COMMITTED RUN
      </span>
      <h1 className="mt-3 font-serif text-5xl">{dossier.title}</h1>
    </section>
  );
}
