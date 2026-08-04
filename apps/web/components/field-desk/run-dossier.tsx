"use client";

import type { RunDossier, WorkspaceRequest } from "@prism/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  FileKey2,
  FlaskConical,
  FolderSearch2,
} from "lucide-react";

import {
  fetchRunDossier,
  runWorkspaceRequest,
  startMockOrchestration,
} from "@/lib/client/run-api";

function shouldPollRunDossier(dossier: RunDossier | undefined): boolean {
  if (!dossier) return false;
  const latestRevision = dossier.dagRevisions[dossier.dagRevisions.length - 1];
  if (!latestRevision) return false;
  const progressByNode = new Map(
    dossier.nodeProgress.map((progress) => [progress.nodeId, progress]),
  );
  return latestRevision.nodes.some((node) => {
    const progress = progressByNode.get(node.nodeId);
    return !progress || !["succeeded", "failed", "blocked"].includes(progress.state);
  });
}

function artifactUrl(runId: string, artifactHash: string): string {
  return `/api/runs/${encodeURIComponent(runId)}/artifacts/${artifactHash}`;
}

export function RunDossierView({
  initialDossier,
  runId,
}: {
  initialDossier: RunDossier;
  runId: string;
}) {
  const queryClient = useQueryClient();
  const dossierQuery = useQuery({
    queryKey: ["runs", runId],
    queryFn: () => fetchRunDossier(runId),
    initialData: initialDossier,
    refetchInterval: (query) => (shouldPollRunDossier(query.state.data) ? 150 : false),
    refetchOnMount: "always",
  });
  const workspaceMutation = useMutation({
    mutationFn: (request: WorkspaceRequest) => runWorkspaceRequest(runId, request),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["runs", runId] });
    },
  });
  const orchestrationMutation = useMutation({
    mutationFn: () => startMockOrchestration(runId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["runs", runId] });
    },
  });

  function inspectWorkspace() {
    workspaceMutation.mutate({
      schemaVersion: "prism.workspace-request/v1",
      requestId: crypto.randomUUID(),
      runId,
      operation: "inspect",
      paths: ["package.json"],
      patterns: ["apps/**/*.{ts,tsx}", "packages/**/*.ts"],
    });
  }

  function testWorkspace() {
    workspaceMutation.mutate({
      schemaVersion: "prism.workspace-request/v1",
      requestId: crypto.randomUUID(),
      runId,
      operation: "test",
      command: { executable: "pnpm", arguments: ["test"] },
      workingDirectory: ".",
      timeoutMs: 120_000,
    });
  }

  if (dossierQuery.isFetching && !dossierQuery.data) {
    return (
      <section className="py-12">
        <div className="border-y border-stone-500 py-8 font-mono text-sm" role="status">
          Checking the canonical journal and artifact hashes…
        </div>
      </section>
    );
  }

  if (dossierQuery.isError || !dossierQuery.data) {
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
  const latestRevision = dossier.dagRevisions[dossier.dagRevisions.length - 1];
  const nodeProgressByNode = new Map(
    dossier.nodeProgress.map((progress) => [progress.nodeId, progress]),
  );
  const orchestrationActive = shouldPollRunDossier(dossier);

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

      <section className="mt-10 border-t-2 border-stone-900 pt-7">
        <p className="font-mono text-[0.62rem] font-bold tracking-[0.12em] text-stone-500">
          BROKERED BROWSER BASELINES
        </p>
        <h2 className="mt-2 inline-flex items-center gap-2 font-serif text-3xl">
          <Camera aria-hidden size={22} /> What Prism observed before mutation
        </h2>
        {dossier.browserBaselines.length === 0 ? (
          <p className="mt-5 border border-dashed border-stone-500 p-5 text-sm text-stone-600">
            No Browser Baseline is committed. Browser evidence can only be captured from
            an explicitly configured local origin and is never substituted by visual
            judgment.
          </p>
        ) : (
          <ol className="mt-5 space-y-4">
            {dossier.browserBaselines.map((baseline) => (
              <li
                className="border border-stone-500 bg-white/40 p-5"
                key={baseline.baselineId}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <strong className="font-mono text-[0.68rem] tracking-[0.1em]">
                    {baseline.targetIdentity}
                  </strong>
                  <span className="font-mono text-[0.6rem] text-stone-500">
                    {baseline.browserVersion}
                  </span>
                </div>
                <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
                  <div>
                    <dt className="font-mono text-stone-500">ROUTE / BUILD</dt>
                    <dd className="mt-1 break-all">
                      {baseline.route} · {baseline.buildIdentity}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-mono text-stone-500">OBSERVATION</dt>
                    <dd className="mt-1 break-all">
                      {baseline.observation.pageStateHash}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-mono text-stone-500">SCREENSHOT SHA-256</dt>
                    <dd className="mt-1 break-all">
                      {baseline.screenshot.hash}
                      <a
                        className="mt-2 inline-block border border-stone-400 px-2 py-1 font-mono text-[0.58rem] text-stone-700 hover:bg-stone-100"
                        href={artifactUrl(runId, baseline.screenshot.hash)}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Open screenshot
                      </a>
                    </dd>
                  </div>
                  <div>
                    <dt className="font-mono text-stone-500">TRACE / EVIDENCE</dt>
                    <dd className="mt-1">
                      <a
                        className="border border-stone-400 px-2 py-1 font-mono text-[0.58rem] text-stone-700 hover:bg-stone-100"
                        href={artifactUrl(runId, baseline.trace.hash)}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Open trace
                      </a>
                      <span>
                        {" "}
                        · {baseline.trace.byteLength} bytes · {baseline.dom.byteLength}{" "}
                        byte DOM
                      </span>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {[
                          ["Open target DOM", baseline.dom.hash],
                          ["Open accessibility facts", baseline.accessibility.hash],
                          ["Open target geometry", baseline.computed.hash],
                          ["Open console evidence", baseline.console.hash],
                          ["Open network evidence", baseline.network.hash],
                        ].map(([label, artifactHash]) => (
                          <a
                            className="border border-stone-300 px-2 py-1 font-mono text-[0.58rem] text-stone-700 hover:bg-stone-100"
                            href={artifactUrl(runId, artifactHash)}
                            key={`${label}-${artifactHash}`}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {label}
                          </a>
                        ))}
                      </div>
                    </dd>
                  </div>
                </dl>
                <p className="mt-4 border-t border-stone-300 pt-3 text-xs text-stone-600">
                  Deterministic browser facts are committed above. Supplemental visual
                  judgment: {baseline.supplementalVisualJudgment ?? "none"}.
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="mt-10 border-t-2 border-stone-900 pt-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[0.62rem] font-bold tracking-[0.12em] text-stone-500">
              MOCK HYBRID ORCHESTRATION / CANONICAL JOURNAL
            </p>
            <h2 className="mt-2 font-serif text-3xl">Dual-runtime Run DAG</h2>
          </div>
          <button
            className="border border-stone-900 px-3 py-2 font-mono text-[0.62rem] font-bold disabled:cursor-not-allowed disabled:opacity-50"
            disabled={orchestrationMutation.isPending || Boolean(latestRevision)}
            onClick={() => orchestrationMutation.mutate()}
            type="button"
          >
            {orchestrationMutation.isPending
              ? "Starting durable Run…"
              : latestRevision
                ? "Mock Run committed"
                : "Start mock hybrid Run"}
          </button>
        </div>

        {orchestrationMutation.isError && (
          <p className="mt-5 border border-red-800 bg-red-50 p-4 text-sm text-red-900">
            Prism could not start the mock Run. No source or browser effect was
            attempted.
          </p>
        )}

        {!latestRevision ? (
          <p className="mt-5 border border-dashed border-stone-500 p-5 text-sm text-stone-600">
            Start the bounded mock Run to observe durable node progress and effect
            fences.
          </p>
        ) : (
          <ol className="mt-5 space-y-3">
            {latestRevision.nodes.map((node) => {
              const progress = nodeProgressByNode.get(node.nodeId);
              const introducedInRevision = dossier.dagRevisions.find((revision) =>
                revision.nodes.some((candidate) => candidate.nodeId === node.nodeId),
              )?.revision;
              return (
                <li
                  className="border border-stone-500 bg-white/40 p-4"
                  key={node.nodeId}
                >
                  <p className="font-mono text-[0.66rem] tracking-[0.08em]">
                    {node.nodeType} / {progress?.state ?? "ready"}
                  </p>
                  <p className="mt-2 break-all font-mono text-[0.58rem] text-stone-500">
                    READY AFTER{" "}
                    {node.predecessorIds.length
                      ? node.predecessorIds.join(", ")
                      : "root evidence"}
                    {` / DAG REVISION ${introducedInRevision ?? "unknown"}`}
                  </p>
                  <p className="mt-2 text-xs">
                    {node.runtime} / {node.effectClass} / journal{" "}
                    {progress ? `#${progress.journalPosition}` : "awaiting"} / artifacts{" "}
                    {progress?.artifacts.length ?? 0}
                  </p>
                  <p className="mt-2 break-all font-mono text-[0.58rem] text-stone-500">
                    correlation / causation:{" "}
                    {progress
                      ? `${progress.correlationId} / ${progress.causationEventId ?? "root"}`
                      : "awaiting"}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
        {latestRevision && (
          <p className="mt-5 font-mono text-[0.6rem] text-stone-600">
            {orchestrationActive ? "DURABLE POLL ACTIVE / " : "DURABLE RUN SETTLED / "}
            EFFECT FENCE{" "}
            {dossier.effectLease
              ? `#${dossier.effectLease.token} / ${dossier.effectLease.state}`
              : "none"}
          </p>
        )}
      </section>

      <section className="mt-10 border-t-2 border-stone-900 pt-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[0.62rem] font-bold tracking-[0.12em] text-stone-500">
              CONFINED WORKSPACE EVIDENCE
            </p>
            <h2 className="mt-2 font-serif text-3xl">
              What Prism inspected — and stopped
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex items-center gap-2 border border-stone-900 px-3 py-2 font-mono text-[0.62rem] font-bold disabled:cursor-wait disabled:opacity-50"
              disabled={workspaceMutation.isPending}
              onClick={inspectWorkspace}
              type="button"
            >
              <FolderSearch2 aria-hidden size={14} /> Inspect registered files
            </button>
            <button
              className="inline-flex items-center gap-2 bg-stone-900 px-3 py-2 font-mono text-[0.62rem] font-bold text-stone-50 disabled:cursor-wait disabled:opacity-50"
              disabled={workspaceMutation.isPending}
              onClick={testWorkspace}
              type="button"
            >
              <FlaskConical aria-hidden size={14} /> Run allowlisted tests
            </button>
          </div>
        </div>

        {workspaceMutation.isError && (
          <p
            className="mt-4 border border-red-800 bg-red-50 p-4 text-sm text-red-900"
            role="alert"
          >
            Prism could not commit the workspace evidence. No wider command or path was
            attempted.
          </p>
        )}

        {dossier.workspaceEvidence.length === 0 ? (
          <p className="mt-5 border border-dashed border-stone-500 p-5 text-sm text-stone-600">
            No workspace operation has been journaled yet. Each button submits a typed,
            bounded request; a denial is evidence too.
          </p>
        ) : (
          <ol className="mt-5 space-y-4">
            {dossier.workspaceEvidence.map(({ evidence, artifact }) => (
              <li
                className="border border-stone-500 bg-white/40 p-5"
                key={evidence.requestId}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <strong className="font-mono text-[0.68rem] tracking-[0.1em]">
                    {evidence.operation.toUpperCase()} / {evidence.status.toUpperCase()}
                  </strong>
                  <span className="font-mono text-[0.6rem] text-stone-500">
                    {evidence.reasonCode ?? "policy passed"}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6">{evidence.summary}</p>

                {evidence.details.operation === "inspect" && (
                  <div className="mt-4 grid gap-4 text-xs md:grid-cols-2">
                    <div>
                      <strong className="font-mono">READS</strong>
                      <ul className="mt-2 space-y-1">
                        {evidence.details.reads.map((read) => (
                          <li className="break-all" key={read.path}>
                            {read.path} · {read.byteLength} bytes
                            {read.truncated ? " · truncated" : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <strong className="font-mono">DISCOVERED</strong>
                      <ul className="mt-2 space-y-1">
                        {evidence.details.discoveredPaths.map((discoveredPath) => (
                          <li className="break-all" key={discoveredPath}>
                            {discoveredPath}
                          </li>
                        ))}
                      </ul>
                      {evidence.details.discoveryTruncated && (
                        <p className="mt-2 font-mono text-stone-500">
                          Result list truncated at the evidence boundary.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {evidence.details.operation === "test" && (
                  <div className="mt-4 text-xs">
                    <p className="font-mono">
                      {evidence.details.command.executable}{" "}
                      {evidence.details.command.arguments.join(" ")} · exit{" "}
                      {evidence.details.exitCode ?? "none"}
                    </p>
                    {(evidence.details.stdout || evidence.details.stderr) && (
                      <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap bg-stone-900 p-4 text-[0.68rem] text-stone-50">
                        {[evidence.details.stdout, evidence.details.stderr]
                          .filter(Boolean)
                          .join("\n")}
                      </pre>
                    )}
                  </div>
                )}

                {evidence.details.operation === "patch" && (
                  <ul className="mt-4 space-y-3 font-mono text-xs">
                    {evidence.details.files.map((file) => (
                      <li className="border border-stone-300 p-3" key={file.path}>
                        <p className="break-all font-bold">{file.path}</p>
                        <p className="mt-2 break-all">
                          BEFORE / {file.beforeSha256 ?? "new file"}
                        </p>
                        <p className="mt-1 break-all">AFTER / {file.afterSha256}</p>
                        <p className="mt-1">{file.byteLength} bytes</p>
                      </li>
                    ))}
                  </ul>
                )}

                <p className="mt-4 break-all border-t border-stone-300 pt-3 font-mono text-[0.58rem] text-stone-500">
                  ARTIFACT SHA-256 / {artifact.hash} / {artifact.byteLength} bytes
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}
