import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { PrismMark } from "@/components/prism-mark";

/**
 * Run 卷宗布局：页眉 + 面包屑导航 + 子页面内容。
 *
 * 从路由参数解析 runId 用于面包屑末级展示。
 */
export default async function RunDossierLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ runId: string }>;
}>) {
  const { runId } = await params;

  return (
    <main className="min-h-screen px-5 pb-20 sm:px-8 lg:px-[7vw]">
      <header className="flex min-h-20 items-center justify-between border-b-2 border-stone-900">
        <PrismMark />
        <span className="font-mono text-[0.62rem] font-bold tracking-[0.1em] text-stone-500">
          RUN DOSSIER
        </span>
      </header>
      {/* 面包屑：Field Desk / Runs / 当前 Run ID */}
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-2 border-b border-stone-400 py-4 font-mono text-[0.63rem] font-semibold"
      >
        <Link className="hover:underline" href="/">
          Field Desk
        </Link>
        <ChevronRight aria-hidden size={13} />
        <Link className="hover:underline" href="/runs">
          Runs
        </Link>
        <ChevronRight aria-hidden size={13} />
        <span aria-current="page" className="text-stone-500">
          {runId}
        </span>
      </nav>
      {children}
    </main>
  );
}
