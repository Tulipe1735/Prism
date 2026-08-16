"use client";

import type {
  CapabilityAttempt,
  EvaluationReport,
  SweBenchResult,
} from "@prism/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createColumnHelper,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { formatDistanceToNow } from "date-fns";
import { ArrowRight, Play, RefreshCw, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  fetchEvaluation,
  fetchEvaluations,
  resumeEvaluation,
  startEvaluation,
} from "@/lib/client/evaluation-api";

const scenarioLabels: Record<string, string> = {
  "round-button": "Round button",
  "card-shadow": "Card shadow",
  "profile-dialog": "Profile dialog",
  "form-enablement": "Form enablement",
  "mobile-overflow": "Mobile overflow",
  "occluded-menu": "Occluded menu",
};

const attemptTableFeatures = tableFeatures({});
const attemptColumn = createColumnHelper<
  typeof attemptTableFeatures,
  CapabilityAttempt
>();
const attemptColumns = attemptColumn.columns([
  attemptColumn.accessor("scenarioId", {
    header: "Scenario",
    cell: ({ getValue }) => scenarioLabels[getValue()] ?? getValue(),
  }),
  attemptColumn.accessor("ordinal", { header: "Try" }),
  attemptColumn.accessor("status", { header: "Outcome" }),
  attemptColumn.accessor("failureClass", {
    header: "Failure class",
    cell: ({ getValue }) => getValue() ?? "—",
  }),
  attemptColumn.accessor("diagnostics", {
    header: "Route diagnostics",
    cell: ({ getValue }) => getValue().join(" · ") || "Not run",
  }),
  attemptColumn.accessor("metrics.tokens", { header: "Tokens" }),
  attemptColumn.accessor("metrics.costUsd", {
    header: "Cost",
    cell: ({ getValue }) => `$${getValue().toFixed(3)}`,
  }),
  attemptColumn.accessor("metrics.wallTimeMs", {
    header: "Wall time",
    cell: ({ getValue }) => `${(getValue() / 1000).toFixed(1)}s`,
  }),
  attemptColumn.accessor("runId", {
    header: "Evidence",
    cell: ({ getValue }) => (
      <Link
        className="inline-flex min-h-11 items-center gap-1 underline underline-offset-4"
        href={`/runs/${encodeURIComponent(getValue())}`}
      >
        Dossier <ArrowRight aria-hidden size={13} />
      </Link>
    ),
  }),
]);

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t-2 border-stone-900 py-4">
      <dt className="font-mono text-[0.62rem] font-bold tracking-[0.1em] text-stone-500">
        {label}
      </dt>
      <dd className="mt-2 font-serif text-3xl">{value}</dd>
    </div>
  );
}

function CodingGuard({ report }: { report: EvaluationReport }) {
  const exclusions = report.evaluation.coding.results.filter(
    ({ status }) => status === "setup_excluded",
  );
  const grouped = report.evaluation.coding.tasks.map((task) => ({
    ...task,
    direct: report.evaluation.coding.results.find(
      (result) => result.instanceId === task.instanceId && result.mode === "direct",
    ),
    embedded: report.evaluation.coding.results.find(
      (result) => result.instanceId === task.instanceId && result.mode === "embedded",
    ),
  }));
  const verdict = (result: SweBenchResult | undefined) =>
    result?.status === "setup_excluded"
      ? "Excluded"
      : result?.resolved
        ? "Resolved"
        : "Unresolved";
  return (
    <section className="mt-14 border-t-2 border-stone-900 pt-8">
      <div className="grid gap-5 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <span className="font-mono text-[0.64rem] font-bold tracking-[0.12em]">
            CODING NON-REGRESSION / FROZEN 12
          </span>
          <h2 className="mt-2 font-serif text-4xl">Direct Pi versus embedded Pi.</h2>
        </div>
        <p className="font-mono text-xs">
          direct {report.summary.coding.directResolved ?? "—"} · embedded{" "}
          {report.summary.coding.embeddedResolved ?? "—"}
        </p>
      </div>
      {exclusions.length > 0 && (
        <div className="mt-6 flex gap-3 border-2 border-amber-700 bg-amber-50 p-5 text-amber-950" role="status">
          <ShieldAlert aria-hidden className="mt-0.5 shrink-0" size={20} />
          <p className="text-sm leading-6">
            <strong className="block">Setup exclusions are reported before scores.</strong>
            {exclusions[0]?.setupExclusion} ({exclusions.length}/24 paired attempts)
          </p>
        </div>
      )}
      <div className="mt-6 overflow-x-auto border-y border-stone-500">
        <table className="w-full min-w-[48rem] border-collapse text-left text-sm">
          <thead className="font-mono text-[0.62rem] uppercase tracking-[0.08em]">
            <tr>
              <th className="p-3">Repository</th><th className="p-3">Instance</th>
              <th className="p-3">Direct</th><th className="p-3">Embedded</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-300">
            {grouped.map((row) => (
              <tr key={row.instanceId}>
                <td className="p-3">{row.repository}</td><td className="p-3 font-mono text-xs">{row.instanceId}</td>
                <td className="p-3">{verdict(row.direct)}</td><td className="p-3">{verdict(row.embedded)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function EvaluationDashboard({ initialReports }: { initialReports: EvaluationReport[] }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState(initialReports[0]?.evaluation.evaluationId);
  const listQuery = useQuery({
    queryKey: ["evaluations"],
    queryFn: fetchEvaluations,
    initialData: initialReports,
    refetchOnMount: "always",
  });
  const selected = selectedId ?? listQuery.data[0]?.evaluation.evaluationId;
  const reportQuery = useQuery({
    queryKey: ["evaluation", selected],
    queryFn: () => fetchEvaluation(selected!),
    enabled: Boolean(selected),
    initialData: listQuery.data.find(({ evaluation }) => evaluation.evaluationId === selected),
    refetchInterval: (query) => query.state.data?.evaluation.status === "running" ? 2_000 : false,
  });
  const syncReport = (report: EvaluationReport) => {
    setSelectedId(report.evaluation.evaluationId);
    queryClient.setQueryData(["evaluation", report.evaluation.evaluationId], report);
    void queryClient.invalidateQueries({ queryKey: ["evaluations"] });
  };
  const createMutation = useMutation({ mutationFn: startEvaluation, onSuccess: syncReport });
  const resumeMutation = useMutation({
    mutationFn: (evaluationId: string) => resumeEvaluation(evaluationId),
    onSuccess: syncReport,
  });
  const report = reportQuery.data;
  const table = useTable({
    data: report?.evaluation.capability.attempts ?? [],
    columns: attemptColumns,
    features: attemptTableFeatures,
  });
  const chartData = useMemo(
    () => report?.summary.capability.scenarios.map((scenario) => ({
      name: scenarioLabels[scenario.scenarioId], successes: scenario.successes,
    })) ?? [],
    [report],
  );
  const busy = createMutation.isPending || resumeMutation.isPending;

  if (!report) {
    return (
      <div className="mt-10 border-y-2 border-stone-900 py-10">
        <h2 className="font-serif text-3xl">No evaluation has been committed.</h2>
        <button
          className="mt-6 inline-flex min-h-12 items-center gap-2 bg-blue-700 px-6 font-mono text-xs font-bold tracking-[0.08em] text-white disabled:opacity-50"
          disabled={busy}
          onClick={() => createMutation.mutate()}
          type="button"
        >
          <Play aria-hidden size={16} /> {busy ? "PREPARING 42 ATTEMPTS…" : "START RELEASE EVALUATION"}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-10">
      <div className="flex flex-wrap items-center gap-3 border-y-2 border-stone-900 py-4">
        <label className="grid w-full gap-2 font-mono text-[0.62rem] font-bold tracking-[0.08em] sm:w-auto sm:grid-cols-[auto_minmax(16rem,1fr)] sm:items-center">
          EVALUATION
          <select
            className="min-h-11 min-w-0 max-w-full border border-stone-600 bg-stone-50 px-3"
            onChange={(event) => setSelectedId(event.target.value)}
            value={report.evaluation.evaluationId}
          >
            {listQuery.data.map(({ evaluation }) => (
              <option key={evaluation.evaluationId} value={evaluation.evaluationId}>
                {evaluation.evaluationId} · {evaluation.status}
              </option>
            ))}
          </select>
        </label>
        <button
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 bg-blue-700 px-6 font-mono text-xs font-bold tracking-[0.08em] text-white disabled:opacity-50 sm:ml-auto sm:w-auto"
          disabled={busy || report.evaluation.status === "completed"}
          onClick={() => resumeMutation.mutate(report.evaluation.evaluationId)}
          type="button"
        >
          <RefreshCw aria-hidden className={busy ? "animate-spin" : ""} size={16} />
          {busy ? "CHECKING EVIDENCE…" : report.evaluation.status === "awaiting_approval" ? "CHECK AFTER APPROVAL" : "RESUME NEXT ATTEMPT"}
        </button>
      </div>
      <p className="mt-3 min-h-6 text-sm text-stone-600" aria-live="polite">
        {report.evaluation.status} · updated {formatDistanceToNow(new Date(report.evaluation.updatedAt), { addSuffix: true })}
        {resumeMutation.isError ? ` · ${resumeMutation.error.message}` : ""}
      </p>

      <dl className="mt-8 grid gap-x-7 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="CAPABILITY" value={`${report.summary.capability.successes}/18`} />
        <MetricCard label="MEDIAN / P95 TOKENS" value={`${report.summary.capability.medianTokens} / ${report.summary.capability.p95Tokens}`} />
        <MetricCard label="MEDIAN / P95 COST" value={`$${report.summary.capability.medianCostUsd.toFixed(2)} / $${report.summary.capability.p95CostUsd.toFixed(2)}`} />
        <MetricCard label="MEDIAN / P95 WALL TIME" value={`${(report.summary.capability.medianWallTimeMs / 1000).toFixed(1)}s / ${(report.summary.capability.p95WallTimeMs / 1000).toFixed(1)}s`} />
      </dl>

      <section className="mt-10 grid gap-8 lg:grid-cols-[minmax(20rem,0.7fr)_minmax(0,1.3fr)]">
        <div>
          <h2 className="font-serif text-3xl">Successes by scenario</h2>
          <div className="mt-5 h-72" role="img" aria-label="Bar chart of successful attempts per scenario, out of three">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ left: -18, bottom: 58 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" angle={-35} textAnchor="end" interval={0} />
                <YAxis allowDecimals={false} domain={[0, 3]} />
                <Tooltip />
                <Bar dataKey="successes" fill="#1d4ed8" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="overflow-x-auto">
          <h2 className="font-serif text-3xl">Attempt evidence</h2>
          <table className="mt-5 w-full min-w-[70rem] border-y-2 border-stone-900 text-left text-sm">
            <thead className="font-mono text-[0.6rem] uppercase tracking-[0.08em]">
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id}>{group.headers.map((header) => <th className="p-3" key={header.id}>{header.isPlaceholder ? null : <table.FlexRender header={header} />}</th>)}</tr>
              ))}
            </thead>
            <tbody className="divide-y divide-stone-300">
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id}>{row.getAllCells().map((cell) => <td className="max-w-xs p-3 align-top" key={cell.id}><table.FlexRender cell={cell} /></td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <CodingGuard report={report} />
    </div>
  );
}
