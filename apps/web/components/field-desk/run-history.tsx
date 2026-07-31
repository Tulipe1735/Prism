"use client";

import type { RunSummary } from "@prism/contracts";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Inbox } from "lucide-react";
import Link from "next/link";

import { type RunStatusFilter, useFieldDeskStore } from "@/lib/client/field-desk-store";
import { fetchRuns } from "@/lib/client/run-api";

const filters: Array<{ label: string; value: RunStatusFilter }> = [
  { label: "All statuses", value: "all" },
  { label: "Created", value: "created" },
  { label: "Queued", value: "queued" },
  { label: "Terminal error", value: "terminal_error" },
];

export function RunHistory({ initialRuns }: { initialRuns: readonly RunSummary[] }) {
  const statusFilter = useFieldDeskStore((state) => state.runStatusFilter);
  const setStatusFilter = useFieldDeskStore((state) => state.setRunStatusFilter);
  const runsQuery = useQuery({
    queryKey: ["runs"],
    queryFn: fetchRuns,
    initialData: [...initialRuns],
    refetchOnMount: "always",
  });

  if (runsQuery.isFetching) {
    return (
      <div
        className="mt-12 border-y border-stone-500 py-10 font-mono text-sm"
        role="status"
      >
        Checking committed Run history…
      </div>
    );
  }

  if (runsQuery.isError) {
    return (
      <div
        className="mt-12 border-2 border-red-800 bg-red-50 p-5 text-red-900"
        role="alert"
      >
        <p className="font-mono text-xs font-bold tracking-[0.1em]">
          RUN HISTORY COULD NOT BE VERIFIED
        </p>
        <p className="mt-3 text-sm">
          Cached entries are hidden until durable Run storage can be read again.
        </p>
      </div>
    );
  }

  const visibleRuns = runsQuery.data.filter(
    (run) => statusFilter === "all" || run.status === statusFilter,
  );

  if (runsQuery.data.length === 0) {
    return (
      <div className="mt-12 grid min-h-72 place-items-center border-y border-stone-400 bg-white/30 p-8 text-center">
        <div>
          <Inbox aria-hidden className="mx-auto" size={28} />
          <h2 className="mt-5 font-serif text-3xl">No Runs have been created.</h2>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-stone-600">
            Create a repair Run from the Field Desk. Only committed journal state
            appears here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-10">
      <label className="font-mono text-[0.63rem] font-bold tracking-[0.1em]">
        STATUS FILTER
        <select
          className="ml-3 border border-stone-500 bg-stone-50 px-3 py-2"
          onChange={(event) => setStatusFilter(event.target.value as RunStatusFilter)}
          value={statusFilter}
        >
          {filters.map((filter) => (
            <option key={filter.value} value={filter.value}>
              {filter.label}
            </option>
          ))}
        </select>
      </label>

      {visibleRuns.length === 0 ? (
        <p className="mt-8 border-y border-stone-400 py-10 font-serif text-2xl">
          No Runs match this ephemeral filter.
        </p>
      ) : (
        <ul className="mt-7 divide-y divide-stone-400 border-y-2 border-stone-900">
          {visibleRuns.map((run) => (
            <li key={run.id}>
              <Link
                className="grid gap-3 px-3 py-6 transition hover:bg-blue-600/5 sm:grid-cols-[1fr_auto] sm:items-center"
                href={`/runs/${encodeURIComponent(run.id)}`}
              >
                <span>
                  <small className="font-mono text-[0.61rem] font-bold text-stone-500">
                    {run.id}
                  </small>
                  <strong className="mt-2 block font-serif text-2xl">
                    {run.title}
                  </strong>
                  <span className="mt-2 block text-xs text-stone-600">
                    {run.status} · journal #{run.lastSequence} · integrity{" "}
                    {run.integrity}
                  </span>
                </span>
                <ArrowRight aria-hidden size={18} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
