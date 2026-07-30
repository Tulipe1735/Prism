"use client";

import * as Label from "@radix-ui/react-label";
import {
  REPAIR_REQUEST_SCHEMA_VERSION,
  contractErrorSchema,
  formatContractIssues,
  repairRequestSchema,
  repairRequestValidationSchema,
  type LocalWorkspace,
  type ValidationIssue,
  type Viewport,
} from "@prism/contracts";
import { Check, FolderGit2, LoaderCircle, Monitor, Send } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";

type SubmissionState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "accepted"; message: string }
  | { status: "error"; message: string; issues: ValidationIssue[] };

export function RepairComposer({
  viewport,
  workspace,
}: {
  viewport: Viewport;
  workspace: LocalWorkspace;
}) {
  const [prompt, setPrompt] = useState("");
  const [hasInteracted, setHasInteracted] = useState(false);
  const [submission, setSubmission] = useState<SubmissionState>({
    status: "idle",
  });

  const draft = useMemo(
    () => ({
      schemaVersion: REPAIR_REQUEST_SCHEMA_VERSION,
      prompt,
      workspace,
      viewport,
    }),
    [prompt, viewport, workspace],
  );
  const browserValidation = useMemo(
    () => repairRequestSchema.safeParse(draft),
    [draft],
  );
  const browserIssues = browserValidation.success
    ? []
    : formatContractIssues(browserValidation.error);
  const promptIssue = browserIssues.find((issue) => issue.path === "prompt");
  const visiblePromptIssue = hasInteracted ? promptIssue : undefined;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHasInteracted(true);

    const parsedDraft = repairRequestSchema.safeParse(draft);
    if (!parsedDraft.success) {
      setSubmission({
        status: "error",
        message: "Fix the highlighted request before validation.",
        issues: formatContractIssues(parsedDraft.error),
      });
      return;
    }

    setSubmission({ status: "submitting" });

    try {
      const response = await fetch("/api/repair-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsedDraft.data),
      });
      const responseBody: unknown = await response.json();

      if (!response.ok) {
        const parsedError = contractErrorSchema.safeParse(responseBody);
        if (!parsedError.success) {
          throw new Error("The server returned an invalid error contract.");
        }

        setSubmission({
          status: "error",
          message: parsedError.data.message,
          issues: parsedError.data.issues,
        });
        return;
      }

      const validation = repairRequestValidationSchema.safeParse(responseBody);
      if (!validation.success) {
        throw new Error("The server returned an invalid validation contract.");
      }

      setSubmission({
        status: "accepted",
        message: "Request validated at both boundaries. No Run has been created yet.",
      });
    } catch {
      setSubmission({
        status: "error",
        message: "Prism could not validate the request. Try again.",
        issues: [
          {
            path: "<root>",
            code: "invalid_response",
            message: "The validation boundary did not return a trusted result.",
          },
        ],
      });
    }
  }

  const isSubmitting = submission.status === "submitting";

  return (
    <form
      className="border border-stone-800 bg-white/40 shadow-[9px_9px_0_#246bfe]"
      noValidate
      onSubmit={handleSubmit}
    >
      <div className="flex min-h-12 items-center justify-between gap-4 border-b border-stone-400 px-4">
        <span className="inline-flex min-w-0 items-center gap-2 font-mono text-[0.67rem] font-semibold">
          <FolderGit2 aria-hidden className="shrink-0" size={15} />
          <span className="truncate" title={workspace.path}>
            {workspace.displayName}
          </span>
        </span>
        <span className="font-mono text-[0.59rem] font-bold tracking-[0.1em] text-stone-500">
          LOCAL / V1
        </span>
      </div>

      <div className="px-5 pt-5">
        <Label.Root
          className="font-mono text-[0.63rem] font-bold tracking-[0.12em]"
          htmlFor="repair-prompt"
        >
          FRONTEND REPAIR REQUEST
        </Label.Root>
        <textarea
          aria-describedby={
            visiblePromptIssue ? "repair-prompt-error" : "repair-prompt-help"
          }
          aria-invalid={visiblePromptIssue ? true : undefined}
          className="mt-3 block min-h-40 w-full resize-y border-0 bg-transparent p-0 font-serif text-xl leading-7 outline-none placeholder:text-stone-400 focus-visible:ring-0"
          id="repair-prompt"
          maxLength={2000}
          onBlur={() => setHasInteracted(true)}
          onChange={(event) => {
            setPrompt(event.target.value);
            if (submission.status !== "idle") {
              setSubmission({ status: "idle" });
            }
          }}
          placeholder="Describe one visible frontend problem…"
          value={prompt}
        />
        <p
          className="min-h-6 pt-1 text-xs leading-5 text-stone-500"
          id={visiblePromptIssue ? "repair-prompt-error" : "repair-prompt-help"}
        >
          {visiblePromptIssue ? (
            <span className="font-semibold text-red-700">
              {visiblePromptIssue.message}
            </span>
          ) : (
            "Be concrete about the target and the expected visible behavior."
          )}
        </p>
      </div>

      <div className="flex flex-col gap-3 border-t border-stone-400 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex items-center gap-2 px-2 font-mono text-[0.62rem] font-semibold text-stone-600">
          <Monitor aria-hidden size={15} />
          {viewport.width} × {viewport.height} @ {viewport.deviceScaleFactor}x
        </div>
        <Button disabled={isSubmitting} type="submit">
          {isSubmitting ? (
            <LoaderCircle aria-hidden className="animate-spin" size={15} />
          ) : submission.status === "accepted" ? (
            <Check aria-hidden size={15} />
          ) : (
            <Send aria-hidden size={15} />
          )}
          {isSubmitting
            ? "Validating…"
            : submission.status === "accepted"
              ? "Validated"
              : "Validate request"}
        </Button>
      </div>

      {submission.status !== "idle" && submission.status !== "submitting" && (
        <div
          aria-live="polite"
          className={
            submission.status === "accepted"
              ? "border-t border-emerald-700/30 bg-emerald-50 px-5 py-4 text-emerald-800"
              : "border-t border-red-700/30 bg-red-50 px-5 py-4 text-red-800"
          }
          role="status"
        >
          <p className="text-sm font-semibold">{submission.message}</p>
          {submission.status === "error" && submission.issues.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {submission.issues.map((issue, index) => (
                <li key={`${issue.path}-${issue.code}-${index}`}>
                  <span className="font-mono">{issue.path}</span>: {issue.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
