import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { RunHistory } from "@/components/field-desk/run-history";
import { PrismMark } from "@/components/prism-mark";
import { listRecentRuns } from "@/lib/server/run-repository";

export const metadata: Metadata = {
  title: "Runs",
};

/** 每次请求都动态渲染，确保列表与服务端存储一致。 */
export const dynamic = "force-dynamic";

/**
 * Run 历史页面（服务端组件）：渲染 RunHistory 客户端组件。
 *
 * 服务端预取全部 Run 摘要作为初始数据，客户端用 TanStack Query
 * 刷新与筛选。状态筛选是纯临时 UI 状态，绝不改变规范 Run 状态。
 */
export default async function RunsPage() {
  const runs = await listRecentRuns();

  return (
    <main className="min-h-screen px-5 pb-20 sm:px-8 lg:px-[10vw]">
      <header className="flex min-h-20 items-center justify-between border-b-2 border-stone-900">
        <PrismMark />
        <Link
          className="inline-flex items-center gap-2 font-mono text-[0.65rem] font-bold tracking-[0.1em]"
          href="/"
        >
          <ArrowLeft aria-hidden size={15} /> FIELD DESK
        </Link>
      </header>
      <section className="py-16">
        <span className="font-mono text-[0.65rem] font-bold tracking-[0.15em] text-stone-500">
          RUN HISTORY
        </span>
        <h1 className="mt-3 font-serif text-6xl tracking-[-0.04em]">
          Committed fieldwork.
        </h1>
        <p className="mt-5 max-w-xl text-sm leading-6 text-stone-600">
          TanStack Query reconciles this view with the server. The status filter is
          intentionally ephemeral and never changes canonical Run state.
        </p>
        <RunHistory initialRuns={runs} />
      </section>
    </main>
  );
}
