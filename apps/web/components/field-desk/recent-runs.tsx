"use client";

import type { RunSummary } from "@prism/contracts";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Search } from "lucide-react";
import Link from "next/link";

import { fetchRuns } from "@/lib/client/run-api";

export function RecentRuns({ initialRuns }: { initialRuns: readonly RunSummary[] }) {
  const runsQuery = useQuery({
    queryKey: ["runs"],
    queryFn: fetchRuns,
    initialData: [...initialRuns],
  });
  const runs = runsQuery.data;

  return (
    <aside className="border-t-2 border-stone-900">
      <div className="flex min-h-12 items-center justify-between border-b border-stone-400 font-mono text-[0.65rem] font-bold tracking-[0.13em]">
        <span>RECENT RUNS</span>
        <Search aria-hidden size={16} />
      </div>
      {runsQuery.isError ? (
        <div
          className="border-b border-red-400 py-7 text-sm text-red-800"
          role="status"
        >
          Run history could not be refreshed.
        </div>
      ) : runs.length === 0 ? (
        <div className="border-b border-stone-400 py-7">
          <p className="font-serif text-2xl">No Runs yet.</p>
          <p className="mt-2 text-xs leading-5 text-stone-600">
            A successfully committed repair request will appear here.
          </p>
        </div>
      ) : (
        <ul>
          {runs.slice(0, 5).map((run) => (
            <li className="border-b border-stone-400" key={run.id}>
              <Link
                className="grid grid-cols-[0.5rem_1fr_auto] items-center gap-3 px-2 py-4 transition hover:bg-blue-600/5"
                href={`/runs/${encodeURIComponent(run.id)}`}
              >
                <i
                  className={
                    run.integrity === "failed"
                      ? "size-1.5 rounded-full bg-red-700"
                      : "size-1.5 rounded-full bg-blue-600"
                  }
                />
                <span className="min-w-0">
                  <small className="block font-mono text-[0.58rem] font-bold text-stone-500">
                    {run.id}
                  </small>
                  <strong className="mt-1 block truncate font-serif text-sm">
                    {run.title}
                  </strong>
                  <span className="mt-1 block text-[0.63rem] text-stone-500">
                    {run.status} · journal #{run.lastSequence}
                  </span>
                </span>
                <ArrowRight aria-hidden size={14} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link
        className="mt-5 inline-flex items-center gap-2 font-mono text-[0.63rem] font-bold tracking-[0.08em] underline decoration-stone-400 underline-offset-4"
        href="/runs"
      >
        VIEW RUN HISTORY <ArrowRight aria-hidden size={14} />
      </Link>
    </aside>
  );
}
