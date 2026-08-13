import {
  ArrowRight,
  Camera,
  FolderGit2,
  Gauge,
  ShieldCheck,
  Waypoints,
} from "lucide-react";
import Link from "next/link";

import { RecentRuns } from "@/components/field-desk/recent-runs";
import { RepairComposer } from "@/components/field-desk/repair-composer";
import { PrismMark } from "@/components/prism-mark";
import { listRecentRuns } from "@/lib/server/run-repository";
import { getConfiguredWorkspace } from "@/lib/server/workspace-policy";

/** Field Desk 默认浏览器视口（提交请求时写入 Run 清单）。 */
const defaultViewport = {
  width: 1280,
  height: 720,
  deviceScaleFactor: 1,
} as const;

/** 每次请求都动态渲染，确保最近 Run 与服务端存储一致。 */
export const dynamic = "force-dynamic";

/**
 * Field Desk 首页（服务端组件）。
 *
 * 服务端读取配置工作区与最近 Run 摘要后渲染：
 *  - 页眉：Prism 标识 + 导航；
 *  - 主区：修复请求编辑器（RepairComposer）+ 规划运行流程说明；
 *  - 活跃字段：最新已提交 Run 的入口 + 最近 Run 侧栏。
 */
export default async function FieldDeskPage() {
  const workspace = getConfiguredWorkspace();
  const recentRuns = await listRecentRuns();
  const activeRun = recentRuns[0];

  return (
    <main className="min-h-screen px-5 pb-20 text-stone-900 sm:px-8 lg:px-[4.5vw]">
      <header className="grid min-h-20 grid-cols-[1fr_auto] items-center border-b-2 border-stone-900 lg:grid-cols-[1fr_auto_1fr]">
        <PrismMark />
        <nav
          aria-label="Primary navigation"
          className="hidden items-center gap-8 lg:flex"
        >
          <Link
            className="border-b border-stone-900 py-2 font-mono text-[0.67rem] font-bold tracking-[0.14em]"
            href="/"
          >
            FIELD DESK
          </Link>
          <Link
            className="py-2 font-mono text-[0.67rem] font-bold tracking-[0.14em] text-stone-500 transition hover:text-stone-900"
            href="/runs"
          >
            RUNS
          </Link>
          <span className="py-2 font-mono text-[0.67rem] font-bold tracking-[0.14em] text-stone-400">
            EVALUATIONS
          </span>
        </nav>
        <div className="flex items-center justify-end gap-3">
          <span className="inline-flex items-center gap-2 font-mono text-[0.65rem] font-bold tracking-[0.13em] text-stone-600">
            <i className="size-1.5 rounded-full bg-emerald-600 shadow-[0_0_0_3px_rgba(5,150,105,0.13)]" />
            LOCAL
          </span>
        </div>
      </header>

      {/* 主区：文案 + 请求编辑器 + 规划运行流程 */}
      <section className="grid items-start gap-9 py-14 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(27rem,1.35fr)_minmax(14rem,0.65fr)] lg:gap-[3.5vw] lg:py-24">
        <div>
          <span className="inline-block bg-stone-900 px-2 py-1 font-mono text-[0.64rem] font-bold tracking-[0.14em] text-stone-50">
            NEW REPAIR / LOCAL WORKSPACE
          </span>
          <h1 className="mt-5 max-w-xl font-serif text-5xl leading-[0.91] tracking-[-0.055em] sm:text-6xl lg:text-[5.25rem]">
            What should Prism repair?
          </h1>
          <p className="mt-6 max-w-md font-serif text-sm leading-7 text-stone-600">
            Describe the visible problem. Prism validates both boundaries and commits a
            durable Run now. The round-button Tracer Bullet inspects, repairs, and
            returns rendered proof through the live dual-runtime seam.
          </p>
        </div>

        <RepairComposer workspace={workspace} viewport={defaultViewport} />

        {/* 规划中的运行流程：Understand → Reproduce → Repair & prove */}
        <aside className="rotate-[0.35deg] bg-blue-600 p-6 text-blue-50 shadow-[-7px_7px_0_rgba(41,37,36,0.14)]">
          <div className="flex items-center justify-between border-b border-blue-100/50 pb-4 font-mono text-[0.63rem] font-bold tracking-[0.13em]">
            <span>LIVE RUN FLOW</span>
            <Waypoints aria-hidden size={19} />
          </div>
          <ol className="divide-y divide-blue-100/25">
            {[
              ["01", "Understand", "Normalize the request into verifiable predicates."],
              ["02", "Reproduce", "Capture a browser baseline before source mutation."],
              [
                "03",
                "Repair & prove",
                "Patch through Pi, then verify through Agent Plan.",
              ],
            ].map(([number, title, detail]) => (
              <li className="grid grid-cols-[2rem_1fr] gap-2 py-4" key={number}>
                <span className="font-mono text-[0.64rem] font-bold">{number}</span>
                <p className="text-xs leading-5 text-blue-100/80">
                  <strong className="block text-sm text-white">{title}</strong>
                  {detail}
                </p>
              </li>
            ))}
          </ol>
          <div className="mt-5 flex gap-3">
            <ShieldCheck aria-hidden size={18} />
            <p className="font-mono text-[0.6rem] leading-4 text-blue-100/75">
              <strong className="block text-[0.68rem] text-white">
                Safe by default
              </strong>
              Local workspace · scoped access · no effect before a Run
            </p>
          </div>
        </aside>
      </section>

      {/* 活跃字段：最新已提交 Run + 最近 Run 侧栏 */}
      <section className="border-t-2 border-stone-900 py-12">
        <div className="mb-9 grid gap-3 md:grid-cols-[minmax(15rem,0.75fr)_minmax(20rem,1fr)]">
          <div>
            <span className="font-mono text-[0.65rem] font-bold tracking-[0.15em]">
              ACTIVE FIELDWORK
            </span>
            <h2 className="mt-2 font-serif text-4xl">Continue where you left off.</h2>
          </div>
          <p className="max-w-lg self-end font-serif text-sm leading-6 text-stone-600">
            The entry stays visible above. Detailed evidence unfolds in a second-level
            Run dossier only after a Run is durably created.
          </p>
        </div>

        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <article className="min-h-72 border-y border-stone-400 bg-white/30 p-7">
            <div className="flex size-11 items-center justify-center border border-stone-500 bg-stone-50">
              <FolderGit2 aria-hidden size={20} />
            </div>
            <p className="mt-9 font-mono text-[0.64rem] font-bold tracking-[0.14em] text-stone-500">
              {activeRun ? "LATEST COMMITTED RUN" : "NO ACTIVE RUN"}
            </p>
            <h3 className="mt-2 max-w-lg font-serif text-3xl">
              {activeRun?.title ?? "No durable fieldwork has been committed yet."}
            </h3>
            <p className="mt-4 max-w-xl text-sm leading-6 text-stone-600">
              {activeRun
                ? `Status ${activeRun.status}; journal position ${activeRun.lastSequence}; integrity ${activeRun.integrity}.`
                : "Create a Run above. This desk shows only state committed to the manifest and journal."}
            </p>
            {activeRun ? (
              <Link
                className="mt-8 inline-flex items-center gap-2 font-mono text-[0.64rem] font-bold tracking-[0.08em] underline underline-offset-4"
                href={`/runs/${encodeURIComponent(activeRun.id)}`}
              >
                OPEN RUN DOSSIER <ArrowRight aria-hidden size={14} />
              </Link>
            ) : (
              <div className="mt-8 flex flex-wrap gap-3 font-mono text-[0.64rem] font-semibold text-stone-600">
                <span className="inline-flex items-center gap-2 border border-stone-300 px-3 py-2">
                  <Camera aria-hidden size={14} /> Browser evidence pending
                </span>
                <span className="inline-flex items-center gap-2 border border-stone-300 px-3 py-2">
                  <Gauge aria-hidden size={14} /> Budget not allocated
                </span>
              </div>
            )}
          </article>

          <RecentRuns initialRuns={recentRuns} />
        </div>
      </section>

      <footer className="mt-4 flex flex-wrap items-center gap-4 border-y-2 border-t-stone-900 border-b-stone-400 py-5">
        <PrismMark compact />
        <p className="font-mono text-[0.63rem] font-bold tracking-[0.12em]">
          VISUAL SWE HARNESS / DURABLE RUN BOUNDARY / VERIFIED
        </p>
        <Link
          className="ml-auto inline-flex items-center gap-2 font-mono text-[0.63rem] font-bold tracking-[0.1em] underline decoration-stone-400 underline-offset-4"
          href="/runs"
        >
          OPEN RUN HISTORY <ArrowRight aria-hidden size={14} />
        </Link>
      </footer>
    </main>
  );
}
