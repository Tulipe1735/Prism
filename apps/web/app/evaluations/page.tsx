import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { EvaluationDashboard } from "@/components/field-desk/evaluation-dashboard";
import { PrismMark } from "@/components/prism-mark";
import { listEvaluations } from "@/lib/server/evaluation-repository";

export const metadata: Metadata = { title: "Evaluations" };
export const dynamic = "force-dynamic";

export default async function EvaluationsPage() {
  const evaluations = await listEvaluations();
  return (
    <main className="min-h-screen px-5 pb-20 text-stone-900 sm:px-8 lg:px-[7vw]">
      <header className="flex min-h-20 items-center justify-between border-b-2 border-stone-900">
        <PrismMark />
        <Link
          className="inline-flex min-h-11 items-center gap-2 px-2 font-mono text-[0.65rem] font-bold tracking-[0.1em]"
          href="/"
        >
          <ArrowLeft aria-hidden size={15} /> FIELD DESK
        </Link>
      </header>
      <section className="py-14">
        <span className="font-mono text-[0.65rem] font-bold tracking-[0.15em] text-stone-500">
          RELEASE-CANDIDATE EVALUATION
        </span>
        <h1 className="mt-3 max-w-4xl font-serif text-5xl tracking-[-0.04em] sm:text-6xl">
          Weaknesses stay visible.
        </h1>
        <p className="mt-5 max-w-2xl text-sm leading-6 text-stone-600">
          Three verified-reset attempts per React scenario, plus a paired frozen
          SWE-bench guard. Results are rebuilt from durable Run evidence after refresh.
        </p>
        <EvaluationDashboard initialReports={evaluations} />
      </section>
    </main>
  );
}
