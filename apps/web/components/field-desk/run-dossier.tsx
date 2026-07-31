"use client";

import type { RunDossier } from "@prism/contracts";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileKey2 } from "lucide-react";

import { fetchRunDossier } from "@/lib/client/run-api";

export function RunDossierView({
  initialDossier,
  runId,
}: {
  initialDossier: RunDossier;
  runId: string;
}) {
  const dossierQuery = useQuery({
    queryKey: ["runs", runId],
    queryFn: () => fetchRunDossier(runId),
    initialData: initialDossier,
    refetchOnMount: "always",
  });

  if (dossierQuery.isFetching) {
    return (
      <section className="py-12">
        <div className="border-y border-stone-500 py-8 font-mono text-sm" role="status">
          Checking the canonical journal and artifact hashes…
        </div>
      </section>
    );
  }

  if (dossierQuery.isError) {
    return (
      <section className="py-12">
        <div
          className="border-2 border-red-800 bg-red-50 p-5 text-red-900"
          role="alert"
        >
          <p className="font-mono text-xs font-bold tracking-[0.1em]">
            RUN INTEGRITY COULD NOT BE VERIFIED
          </p>
          <p className="mt-3 text-sm leading-6">
            Prism stopped displaying cached Run state because durable storage could not
            be read.
          </p>
        </div>
      </section>
    );
  }

  const dossier = dossierQuery.data;

  return (
    <section className="py-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-[0.64rem] font-bold tracking-[0.14em]">
          COMMITTED RUN / JOURNAL #{dossier.lastSequence}
        </span>
        <span
          className={
            dossier.integrity === "verified"
              ? "inline-flex items-center gap-2 border border-emerald-700 px-3 py-2 font-mono text-[0.62rem] font-bold text-emerald-800"
              : "inline-flex items-center gap-2 border border-red-700 px-3 py-2 font-mono text-[0.62rem] font-bold text-red-800"
          }
        >
          {dossier.integrity === "verified" ? (
            <CheckCircle2 aria-hidden size={14} />
          ) : (
            <AlertTriangle aria-hidden size={14} />
          )}
          {dossier.status}
        </span>
      </div>
      <h1 className="mt-3 max-w-4xl font-serif text-5xl">{dossier.title}</h1>

      {dossier.terminalError && (
        <div
          className="mt-9 border-2 border-red-800 bg-red-50 p-5 text-red-900"
          role="alert"
        >
          <p className="font-mono text-xs font-bold tracking-[0.1em]">
            TERMINAL INTEGRITY ERROR / {dossier.terminalError.code}
          </p>
          <p className="mt-3 text-sm leading-6">{dossier.terminalError.message}</p>
          <p className="mt-2 text-xs">
            Prism rejected the stored state instead of silently loading untrusted bytes.
          </p>
        </div>
      )}

      <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <article className="border-y-2 border-stone-900 py-7">
          <p className="font-mono text-[0.62rem] font-bold tracking-[0.12em] text-stone-500">
            ORIGINAL REPAIR REQUEST
          </p>
          <pre className="mt-4 whitespace-pre-wrap font-serif text-2xl leading-9">
            {dossier.prompt ?? "Prompt unavailable because the manifest is unreadable."}
          </pre>
        </article>

        <aside className="border border-stone-500 bg-white/40 p-5">
          <p className="font-mono text-[0.62rem] font-bold tracking-[0.12em]">
            DURABLE BOUNDARIES
          </p>
          <dl className="mt-5 space-y-4 text-xs">
            <div>
              <dt className="font-mono text-stone-500">MANIFEST CREATED</dt>
              <dd className="mt-1">{dossier.createdAt ?? "unavailable"}</dd>
            </div>
            <div>
              <dt className="font-mono text-stone-500">WORKSPACE</dt>
              <dd className="mt-1 break-all">
                {dossier.workspace?.path ?? "unavailable"}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-stone-500">VIEWPORT</dt>
              <dd className="mt-1">
                {dossier.viewport
                  ? `${dossier.viewport.width} × ${dossier.viewport.height} @ ${dossier.viewport.deviceScaleFactor}x`
                  : "unavailable"}
              </dd>
            </div>
          </dl>
        </aside>
      </div>

      <section className="mt-10 border-t border-stone-400 pt-7">
        <h2 className="inline-flex items-center gap-2 font-serif text-3xl">
          <FileKey2 aria-hidden size={22} /> Hashed artifacts
        </h2>
        <ul className="mt-5 space-y-3">
          {dossier.artifacts.map((artifact) => (
            <li
              className="grid gap-2 border border-stone-400 p-4 font-mono text-[0.61rem] sm:grid-cols-[auto_1fr_auto]"
              key={artifact.hash}
            >
              <strong>{artifact.algorithm}</strong>
              <span className="break-all">{artifact.hash}</span>
              <span>{artifact.byteLength} bytes</span>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
