import { ArrowRight, Search } from "lucide-react";
import Link from "next/link";

import type { RecentRun } from "@/lib/server/run-repository";

export function RecentRuns({ runs }: { runs: readonly RecentRun[] }) {
  return (
    <aside className="border-t-2 border-stone-900">
      <div className="flex min-h-12 items-center justify-between border-b border-stone-400 font-mono text-[0.65rem] font-bold tracking-[0.13em]">
        <span>RECENT RUNS</span>
        <Search aria-hidden size={16} />
      </div>
      {runs.length === 0 ? (
        <div className="border-b border-stone-400 py-7">
          <p className="font-serif text-2xl">No Runs yet.</p>
          <p className="mt-2 text-xs leading-5 text-stone-600">
            Validated requests appear here only after durable Run creation is available.
          </p>
        </div>
      ) : (
        <ul>
          {runs.map((run) => (
            <li className="border-b border-stone-400" key={run.id}>
              <Link
                className="grid grid-cols-[0.5rem_1fr_auto] items-center gap-3 px-2 py-4 transition hover:bg-blue-600/5"
                href={`/runs/${encodeURIComponent(run.id)}`}
              >
                <i className="size-1.5 rounded-full bg-blue-600" />
                <span className="min-w-0">
                  <small className="block font-mono text-[0.58rem] font-bold text-stone-500">
                    {run.id}
                  </small>
                  <strong className="mt-1 block truncate font-serif text-sm">
                    {run.title}
                  </strong>
                  <span className="mt-1 block text-[0.63rem] text-stone-500">
                    {run.status}
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
