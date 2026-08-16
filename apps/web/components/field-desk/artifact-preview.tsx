"use client";

import type { ArtifactRef } from "@prism/contracts";
import Image from "next/image";
import { useRef, useState } from "react";

import { artifactPreviewKind } from "./artifact-preview-kind";

function artifactUrl(runId: string, hash: string): string {
  return `/api/runs/${encodeURIComponent(runId)}/artifacts/${hash}`;
}

export function ArtifactPreview({
  artifact,
  runId,
}: {
  artifact: ArtifactRef;
  runId: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController>(null);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const kind = artifactPreviewKind(artifact);
  const url = artifactUrl(runId, artifact.hash);
  const titleId = `artifact-${artifact.hash}-title`;

  async function openPreview() {
    setError(null);
    dialog.current?.showModal();
    if (kind !== "text" || content !== null) return;
    request.current = new AbortController();
    setLoading(true);
    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: request.current.signal,
      });
      if (!response.ok) throw new Error("missing");
      setContent(await response.text());
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        setError("The committed artifact is missing or failed its integrity check.");
      }
    } finally {
      setLoading(false);
    }
  }

  function closePreview() {
    request.current?.abort();
    dialog.current?.close();
  }

  return (
    <>
      <button
        className="min-h-11 border border-stone-500 px-3 font-mono text-[0.61rem] font-bold hover:bg-stone-100"
        onClick={openPreview}
        type="button"
      >
        Preview
      </button>
      <dialog
        aria-labelledby={titleId}
        className="m-auto max-h-[85vh] w-[min(56rem,calc(100vw-2rem))] border-2 border-stone-900 bg-stone-50 p-0 text-stone-900 shadow-2xl backdrop:bg-stone-950/55"
        onClose={() => request.current?.abort()}
        ref={dialog}
      >
        <div className="sticky top-0 flex items-start justify-between gap-4 border-b-2 border-stone-900 bg-stone-50 p-5">
          <div>
            <p className="font-mono text-[0.6rem] font-bold tracking-[0.1em] text-stone-500">
              VERIFIED ARTIFACT PREVIEW
            </p>
            <h2 className="mt-1 break-all font-serif text-2xl" id={titleId}>
              {artifact.mediaType}
            </h2>
          </div>
          <button
            autoFocus
            className="min-h-11 border border-stone-900 px-4 font-mono text-xs font-bold"
            onClick={closePreview}
            type="button"
          >
            Close
          </button>
        </div>
        <div className="p-5">
          <dl className="grid gap-2 border-b border-stone-400 pb-4 font-mono text-xs sm:grid-cols-2">
            <div>
              <dt className="text-stone-500">INTEGRITY</dt>
              <dd>{error ? "Verification failed" : "SHA-256 verified"}</dd>
            </div>
            <div>
              <dt className="text-stone-500">SIZE</dt>
              <dd>{artifact.byteLength} bytes</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-stone-500">HASH</dt>
              <dd className="break-all">{artifact.hash}</dd>
            </div>
          </dl>
          {kind === "image" && !error && (
            <Image
              alt={`Committed screenshot ${artifact.hash.slice(0, 12)}`}
              className="mt-5 h-auto max-h-[55vh] w-full object-contain"
              height={720}
              onError={() => setError("The committed screenshot could not be loaded.")}
              src={url}
              unoptimized
              width={1280}
            />
          )}
          {kind === "text" && (
            <pre className="mt-5 max-h-[55vh] overflow-auto whitespace-pre-wrap break-words bg-stone-900 p-4 text-xs text-stone-50">
              {loading ? "Loading bounded preview…" : content}
            </pre>
          )}
          {kind === "metadata" && (
            <p className="mt-5 text-sm leading-6">
              Binary or oversized evidence is not loaded into the page. Open the raw
              artifact to inspect it with the appropriate local tool.
            </p>
          )}
          {error && (
            <p
              className="mt-5 border-2 border-red-800 bg-red-50 p-4 text-sm text-red-900"
              role="alert"
            >
              {error}
            </p>
          )}
          <a
            className="mt-5 inline-flex min-h-11 items-center border border-stone-900 px-4 font-mono text-xs font-bold underline underline-offset-4"
            href={url}
            rel="noreferrer"
            target="_blank"
          >
            Open raw artifact
          </a>
        </div>
      </dialog>
    </>
  );
}
