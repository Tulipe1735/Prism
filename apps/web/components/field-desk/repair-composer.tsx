"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  type LocalWorkspace,
  REPAIR_REQUEST_SCHEMA_VERSION,
  type RepairRequest,
  repairRequestSchema,
  type Viewport,
} from "@prism/contracts";
import * as Label from "@radix-ui/react-label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderGit2, LoaderCircle, Monitor, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "react-toastify";

import { Button } from "@/components/ui/button";
import { RunApiError, submitRepairRequest } from "@/lib/client/run-api";

export function RepairComposer({
  viewport,
  workspace,
}: {
  viewport: Viewport;
  workspace: LocalWorkspace;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<RepairRequest>({
    resolver: zodResolver(repairRequestSchema),
    mode: "onChange",
    defaultValues: {
      schemaVersion: REPAIR_REQUEST_SCHEMA_VERSION,
      prompt: "",
      workspace,
      viewport,
    },
  });
  const creation = useMutation({
    mutationFn: submitRepairRequest,
    onSuccess: async (result) => {
      toast.success("Run committed. Opening its dossier…");
      await queryClient.invalidateQueries({ queryKey: ["runs"] });
      router.push(`/runs/${encodeURIComponent(result.runId)}`);
      router.refresh();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "Prism could not create the Run. Try again.",
      );
    },
  });

  const promptIssue = errors.prompt?.message;
  const serverIssues =
    creation.error instanceof RunApiError ? creation.error.issues : [];

  return (
    <form
      className="border border-stone-800 bg-white/40 shadow-[9px_9px_0_#246bfe]"
      noValidate
      onSubmit={handleSubmit(
        (request) => creation.mutate(request),
        () => toast.error("Fix the highlighted request before creating a Run."),
      )}
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
          aria-describedby={promptIssue ? "repair-prompt-error" : "repair-prompt-help"}
          aria-invalid={promptIssue ? true : undefined}
          className="mt-3 block min-h-40 w-full resize-y border-0 bg-transparent p-0 font-serif text-xl leading-7 outline-none placeholder:text-stone-400 focus-visible:ring-0"
          id="repair-prompt"
          maxLength={2000}
          placeholder="Describe one visible frontend problem…"
          {...register("prompt")}
        />
        <p
          className="min-h-6 pt-1 text-xs leading-5 text-stone-500"
          id={promptIssue ? "repair-prompt-error" : "repair-prompt-help"}
        >
          {promptIssue ? (
            <span className="font-semibold text-red-700">{promptIssue}</span>
          ) : (
            "Be concrete about the target and the expected visible behavior."
          )}
        </p>
      </div>

      <div className="flex flex-col gap-3 border-t border-stone-400 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex items-center gap-2 px-2 font-mono text-[0.62rem] font-semibold text-stone-600">
          <Monitor aria-hidden size={15} />
          {viewport.width} × {viewport.height} @ {viewport.deviceScaleFactor}x
          <span className={isValid ? "text-emerald-700" : "text-stone-400"}>
            · {isValid ? "READY" : "DRAFT"}
          </span>
        </div>
        <Button disabled={creation.isPending} type="submit">
          {creation.isPending ? (
            <LoaderCircle aria-hidden className="animate-spin" size={15} />
          ) : (
            <Send aria-hidden size={15} />
          )}
          {creation.isPending ? "Committing Run…" : "Create Run"}
        </Button>
      </div>

      {creation.isError && (
        <div
          aria-live="polite"
          className="border-t border-red-700/30 bg-red-50 px-5 py-4 text-red-800"
          role="status"
        >
          <p className="text-sm font-semibold">
            {creation.error instanceof Error
              ? creation.error.message
              : "Prism could not create the Run."}
          </p>
          {serverIssues.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {serverIssues.map((issue) => (
                <li key={`${issue.path}-${issue.code}-${issue.message}`}>
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
