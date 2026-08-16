"use client";

import type {
  EffectApprovalProposal,
  EffectDecisionRequest,
  RunDossier,
  WorkspaceRequest,
} from "@prism/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  FileKey2,
  FlaskConical,
  FolderSearch2,
} from "lucide-react";

import { ArtifactPreview } from "@/components/field-desk/artifact-preview";
import { Button } from "@/components/ui/button";
import {
  decideEffect,
  fetchRunDossier,
  runWorkspaceRequest,
  startOrchestration,
} from "@/lib/client/run-api";

/**
 * 判断 Run 是否仍在推进中（需要轮询）。
 *
 * 取最新 DAG 修订：只要存在任一节点尚无进度，或进度仍处于
 * running/ready/retrying 等未结束状态，就返回 true，从而启用轮询。
 */
function shouldPollRunDossier(dossier: RunDossier | undefined): boolean {
  if (!dossier) return false;
  if (
    ["awaiting_approval", "blocked", "cancelled", "completed"].includes(dossier.status)
  ) {
    return false;
  }
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

/** 构造产物下载 URL（按 Run ID + 产物哈希）。 */
function artifactUrl(runId: string, artifactHash: string): string {
  return `/api/runs/${encodeURIComponent(runId)}/artifacts/${artifactHash}`;
}

/**
 * Run 卷宗视图：详情页的核心组件，只读展示一次 Run 的全部持久化状态。
 *
 * 板块：
 *  - 头部：状态徽标 + 标题 + 终止性完整性错误提示；
 *  - 原始修复请求 + 持久化边界（清单创建时间/工作区/视口）；
 *  - 哈希产物清单（内容寻址存储的引用）；
 *  - 浏览器基线（观测前后的事实证据，含截图/trace/DOM 等产物链接）；
 *  - live 混合编排（Run DAG 节点进度 + 副作用租约），可启动 Run；
 *  - 受限工作区证据（inspect/test/patch 结果），可发起检查与测试。
 *
 * 数据通过 react-query 以 initialDossier 为初始值，Run 未结束时
 * 每 150ms 轮询刷新。
 */
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
  // 工作区请求（检查/测试）的变更
  const workspaceMutation = useMutation({
    mutationFn: (request: WorkspaceRequest) => runWorkspaceRequest(runId, request),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["runs", runId] });
    },
  });
  // 启动 live 编排的变更
  const orchestrationMutation = useMutation({
    mutationFn: () => startOrchestration(runId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["runs", runId] });
    },
  });
  const effectDecisionMutation = useMutation({
    mutationFn: (request: EffectDecisionRequest) => decideEffect(runId, request),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["runs", runId] });
    },
  });

  /** 发起一次受限工作区"检查"：读取 package.json + 发现源码文件。 */
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

  /** 发起一次受限工作区"测试"：运行允许列表内的 pnpm test。 */
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

  // 首次拉取中（无初始数据）时显示检查占位
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
  const pendingEffect = [...dossier.effectControls]
    .reverse()
    .find(
      (control): control is EffectApprovalProposal =>
        control.kind === "proposal" &&
        !dossier.effectControls.some(
          (decision) =>
            decision.kind === "decision" && decision.proposalId === control.proposalId,
        ),
    );

  function decidePendingEffect(decision: EffectDecisionRequest["decision"]) {
    if (!pendingEffect) return;
    effectDecisionMutation.mutate({
      schemaVersion: "prism.effect-decision-request/v1",
      proposalId: pendingEffect.proposalId,
      proposalDigest: pendingEffect.proposalDigest,
      decision,
    });
  }

  return (
    <section className="py-12">
      {/* 头部：Run 标识 + 完整性/状态徽标 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-[0.64rem] font-bold tracking-[0.14em]">
          COMMITTED RUN / JOURNAL #{dossier.lastSequence}
        </span>
        <span
          aria-live="polite"
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

      {/* 终止性完整性错误：拒绝加载不可信字节 */}
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

      {/* 原始修复请求 + 持久化边界 */}
      <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <article className="border-y-2 border-stone-900 py-7">
          <p className="font-mono text-[0.62rem] font-bold tracking-[0.12em] text-stone-500">
            ORIGINAL REPAIR REQUEST
          </p>
          <pre className="mt-4 whitespace-pre-wrap font-serif text-2xl leading-9">
            {dossier.prompt ?? "Prompt unavailable because the manifest is unreadable."}
          </pre>
        </article>

        {dossier.repairSpec && (
          <article className="border border-stone-500 bg-white/40 p-5 lg:col-span-2">
            <p className="font-mono text-[0.62rem] font-bold tracking-[0.12em]">
              COMMITTED FRONTEND REPAIR SPEC
            </p>
            <p className="mt-3 text-sm">
              {dossier.repairSpec.spec.target.role} /{" "}
              {dossier.repairSpec.spec.target.name}
              {" · "}
              {dossier.repairSpec.spec.predicates.map(({ kind }) => kind).join(" · ")}
            </p>
            <a
              className="mt-3 inline-block break-all font-mono text-[0.58rem] underline underline-offset-4"
              href={artifactUrl(runId, dossier.repairSpec.artifact.hash)}
              rel="noreferrer"
              target="_blank"
            >
              SPEC SHA-256 / {dossier.repairSpec.artifact.hash}
            </a>
          </article>
        )}

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

      {dossier.completion && (
        <section className="mt-10 border-2 border-emerald-800 bg-emerald-50 p-5 text-emerald-950">
          <p className="font-mono text-[0.62rem] font-bold tracking-[0.12em]">
            TASK COMPLETE / DUAL ORACLES PASSED
          </p>
          <p className="mt-3 text-sm leading-6">
            Terminal DAG revision {dossier.completion.terminalDagRevision}; code Oracle
            and Browser Verification report{" "}
            {dossier.completion.browserVerificationReportId} cite{" "}
            {dossier.completion.verificationRefs.length} committed artifacts.
          </p>
          <a
            className="mt-3 inline-block font-mono text-[0.58rem] underline underline-offset-4"
            href={artifactUrl(runId, dossier.completion.codeOracle.hash)}
            rel="noreferrer"
            target="_blank"
          >
            OPEN CODE ORACLE / {dossier.completion.codeOracle.hash.slice(0, 12)}
          </a>
        </section>
      )}

      <section className="mt-10 border-2 border-stone-900 bg-white/40 p-5">
        <p className="font-mono text-[0.62rem] font-bold tracking-[0.12em]">
          EFFECT AUTHORITY / SINGLE USE
        </p>
        {pendingEffect ? (
          <div className="mt-4">
            <h2 className="font-serif text-3xl">Review the exact proposed effect</h2>
            <dl className="mt-5 grid gap-3 text-xs sm:grid-cols-2">
              <div>
                <dt className="font-mono text-stone-500">RUN / NODE / ORIGIN</dt>
                <dd className="mt-1 break-all">
                  {pendingEffect.runId} / {pendingEffect.nodeId} /{" "}
                  {pendingEffect.origin}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-stone-500">EFFECT / TARGET</dt>
                <dd className="mt-1 break-all">
                  {pendingEffect.effectClass} /{" "}
                  {pendingEffect.target.kind === "workspace"
                    ? `${pendingEffect.target.displayName}: ${pendingEffect.target.paths.join(", ")}`
                    : `${pendingEffect.target.route}: ${pendingEffect.target.target.kind}`}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-stone-500">REDACTED PARAMETERS</dt>
                <dd className="mt-1">
                  {pendingEffect.parameters
                    .map(({ name, redactedValue }) => `${name}=${redactedValue}`)
                    .join("; ") || "none"}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-stone-500">PRECONDITIONS</dt>
                <dd className="mt-1 break-all">
                  observation {pendingEffect.preconditions.observationDigest} / fence #
                  {pendingEffect.preconditions.fencingToken} / expires{" "}
                  {pendingEffect.preconditions.expiresAt}
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-sm leading-6">{pendingEffect.reason}</p>
            <p className="mt-2 break-all font-mono text-[0.58rem] text-stone-500">
              PROPOSAL SHA-256 / {pendingEffect.proposalDigest}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                disabled={effectDecisionMutation.isPending}
                onClick={() => decidePendingEffect("approved")}
                type="button"
              >
                Approve once
              </Button>
              <Button
                disabled={effectDecisionMutation.isPending}
                onClick={() => decidePendingEffect("declined")}
                type="button"
                variant="secondary"
              >
                Decline
              </Button>
              <Button
                disabled={effectDecisionMutation.isPending}
                onClick={() => decidePendingEffect("cancelled")}
                type="button"
                variant="quiet"
              >
                Cancel Run
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-stone-600">
            No effect is awaiting authority. Decisions, consumption, and recovery stay
            visible in the durable log below.
          </p>
        )}
        {effectDecisionMutation.isError && (
          <p
            className="mt-4 border border-red-800 bg-red-50 p-3 text-sm text-red-900"
            role="alert"
          >
            The proposal changed or expired. Prism did not reuse its authority.
          </p>
        )}
        {dossier.effectControls.length > 0 && (
          <ol className="mt-5 space-y-2 border-t border-stone-300 pt-4 text-xs">
            {dossier.effectControls.map((control) => (
              <li className="break-all font-mono" key={control.controlId}>
                {control.kind.toUpperCase()} /{" "}
                {control.kind === "proposal"
                  ? control.proposalDigest
                  : control.kind === "decision"
                    ? `${control.decision}: ${control.reason}`
                    : control.kind === "consumption"
                      ? `fence #${control.fencingToken}: ${control.proposalDigest}`
                      : `${control.outcome} → ${control.action}: ${control.reason}`}
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* 哈希产物清单 */}
      <section className="mt-10 border-t border-stone-400 pt-7">
        <h2 className="inline-flex items-center gap-2 font-serif text-3xl">
          <FileKey2 aria-hidden size={22} /> Hashed artifacts
        </h2>
        <ul className="mt-5 space-y-3">
          {dossier.artifacts.map((artifact) => (
            <li
              className="grid items-center gap-2 border border-stone-400 p-4 font-mono text-[0.61rem] sm:grid-cols-[auto_1fr_auto_auto]"
              key={artifact.hash}
            >
              <strong>{artifact.algorithm}</strong>
              <span className="break-all">{artifact.hash}</span>
              <span>
                {artifact.mediaType} · {artifact.byteLength} bytes
              </span>
              <ArtifactPreview artifact={artifact} runId={runId} />
            </li>
          ))}
        </ul>
      </section>

      {/* 浏览器基线：变更前观测的事实证据 */}
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
                      {/* 其余证据产物：DOM / 无障碍 / 几何 / 控制台 / 网络 */}
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

      {/* 浏览器验证报告：意图链定谓词 + 补充性视觉判断 */}
      <section className="mt-10 border-t-2 border-stone-900 pt-7">
        <p className="font-mono text-[0.62rem] font-bold tracking-[0.12em] text-stone-500">
          KIMI K3 BROWSER VERIFICATION
        </p>
        <h2 className="mt-2 inline-flex items-center gap-2 font-serif text-3xl">
          <CheckCircle2 aria-hidden size={22} /> What the browser proved after repair
        </h2>
        {dossier.browserVerificationReports.length === 0 ? (
          <p className="mt-5 border border-dashed border-stone-500 p-5 text-sm text-stone-600">
            No Browser Verification Report is committed. A passing report requires an
            intent-linked deterministic predicate; model visual judgment alone can never
            pass.
          </p>
        ) : (
          <ol className="mt-5 space-y-4">
            {dossier.browserVerificationReports.map((report) => (
              <li
                className="border border-stone-500 bg-white/40 p-5"
                key={report.reportId}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <strong className="font-mono text-[0.68rem] tracking-[0.1em]">
                    {report.verdict.toUpperCase()} / {report.nodeId}
                  </strong>
                  <span className="font-mono text-[0.6rem] text-stone-500">
                    attempt {report.attempt}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6">{report.intent}</p>
                <ul className="mt-4 space-y-2 text-xs">
                  {report.assertions.map((assertion) => (
                    <li
                      className="flex flex-wrap items-center justify-between gap-2 border border-stone-300 p-3"
                      key={`${assertion.kind}-${assertion.assertion}`}
                    >
                      <span className="break-all">
                        <span className="font-mono">
                          {assertion.kind === "deterministic"
                            ? "DETERMINISTIC"
                            : "SUPPLEMENTAL"}
                          {assertion.intentLinked ? " / INTENT-LINKED" : ""}
                        </span>
                        {" · "}
                        {assertion.assertion}
                      </span>
                      <span className="font-mono text-[0.6rem] text-stone-600">
                        {assertion.status.toUpperCase()}
                      </span>
                    </li>
                  ))}
                </ul>
                {report.evidenceRefs.length > 0 && (
                  <p className="mt-4 flex flex-wrap gap-2 text-xs">
                    {report.evidenceRefs.map((evidence) => (
                      <a
                        className="border border-stone-400 px-2 py-1 font-mono text-[0.58rem] text-stone-700 hover:bg-stone-100"
                        href={artifactUrl(runId, evidence.hash)}
                        key={evidence.hash}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Open evidence · {evidence.hash.slice(0, 12)}
                      </a>
                    ))}
                  </p>
                )}
                {report.limitations.length > 0 && (
                  <p className="mt-3 text-xs text-stone-600">
                    Limitations: {report.limitations.join("; ")}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* live 混合编排：Run DAG + 副作用租约 */}
      <section className="mt-10 border-t-2 border-stone-900 pt-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[0.62rem] font-bold tracking-[0.12em] text-stone-500">
              LIVE HYBRID ORCHESTRATION / CANONICAL JOURNAL
            </p>
            <h2 className="mt-2 font-serif text-3xl">Dual-runtime Run DAG</h2>
          </div>
          {/* 启动是幂等的；未完成 Run 可在进程重启后从节点边界恢复。 */}
          <button
            className="min-h-11 border border-stone-900 px-3 font-mono text-[0.62rem] font-bold disabled:cursor-not-allowed disabled:opacity-50"
            disabled={
              orchestrationMutation.isPending ||
              ["completed", "awaiting_approval", "blocked", "cancelled"].includes(
                dossier.status,
              )
            }
            onClick={() => orchestrationMutation.mutate()}
            type="button"
          >
            {orchestrationMutation.isPending
              ? "Starting durable Run…"
              : dossier.status === "completed"
                ? "Run completed"
                : dossier.status === "awaiting_approval"
                  ? "Approval required"
                  : dossier.status === "blocked"
                    ? "Run blocked"
                    : dossier.status === "cancelled"
                      ? "Run cancelled"
                      : latestRevision
                        ? "Resume hybrid Run"
                        : "Start hybrid Run"}
          </button>
        </div>

        {orchestrationMutation.isError && (
          <p className="mt-5 border border-red-800 bg-red-50 p-4 text-sm text-red-900">
            Prism could not start the live Run. No source or browser effect was
            attempted.
          </p>
        )}

        {!latestRevision ? (
          <p className="mt-5 border border-dashed border-stone-500 p-5 text-sm text-stone-600">
            Start the bounded Run to observe durable node progress and effect fences.
          </p>
        ) : (
          /* 最新修订的节点列表：类型/状态/前驱/DAG 修订/运行时/进度 */
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

      {/* 受限工作区证据：检查 / 测试结果 */}
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
              className="inline-flex min-h-11 items-center gap-2 border border-stone-900 px-3 font-mono text-[0.62rem] font-bold disabled:cursor-wait disabled:opacity-50"
              disabled={workspaceMutation.isPending}
              onClick={inspectWorkspace}
              type="button"
            >
              <FolderSearch2 aria-hidden size={14} /> Inspect registered files
            </button>
            <button
              className="inline-flex min-h-11 items-center gap-2 bg-stone-900 px-3 font-mono text-[0.62rem] font-bold text-stone-50 disabled:cursor-wait disabled:opacity-50"
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

                {/* inspect 详情：读取清单 + 发现路径 */}
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

                {/* test 详情：命令、退出码、标准输出/错误 */}
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

                {/* patch 详情：改动前后哈希 */}
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
