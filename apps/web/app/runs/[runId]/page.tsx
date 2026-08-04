import { notFound } from "next/navigation";

import { RunDossierView } from "@/components/field-desk/run-dossier";
import { getRunDossier } from "@/lib/server/run-repository";

/**
 * Run 卷宗页面（服务端组件）。
 *
 * 按路由参数 runId 读取卷宗；不存在时触发 404（由 not-found 页面呈现）。
 * 读取成功后把卷宗作为初始数据交给客户端组件 RunDossierView。
 */
export default async function RunDossierPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const dossier = await getRunDossier(runId);

  if (!dossier) {
    notFound();
  }

  return <RunDossierView initialDossier={dossier} runId={runId} />;
}
