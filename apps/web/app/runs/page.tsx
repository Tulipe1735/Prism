import { ArrowLeft, Inbox } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PrismMark } from "@/components/prism-mark";
import { listRecentRuns } from "@/lib/server/run-repository";

export const metadata: Metadata = {
  title: "Runs",
};

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const runs = await listRecentRuns();

  return (
    <main className="min-h-screen px-5 pb-20 sm:px-8 lg:px-[10vw]">
      <header className="flex min-h-20 items-center justify-between border-b-2 border-stone-900">
        <PrismMark />
        <Link
          className="inline-flex items-center gap-2 font-mono text-[0.65rem] font-bold tracking-[0.1em]"
          href="/"
        >
          <ArrowLeft aria-hidden size={15} /> FIELD DESK
        </Link>
      </header>
      <section className="py-16">
        <span className="font-mono text-[0.65rem] font-bold tracking-[0.15em] text-stone-500">
          RUN HISTORY
        </span>
        <h1 className="mt-3 font-serif text-6xl tracking-[-0.04em]">
          Committed fieldwork.
        </h1>
        {runs.length === 0 ? (
          <div className="mt-12 grid min-h-72 place-items-center border-y border-stone-400 bg-white/30 p-8 text-center">
            <div>
              <Inbox aria-hidden className="mx-auto" size={28} />
              <h2 className="mt-5 font-serif text-3xl">No Runs have been created.</h2>
              <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-stone-600">
                Prism keeps this view empty instead of presenting prototype records as
                canonical state.
              </p>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
