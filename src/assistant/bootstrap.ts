import type { AssistantStore } from "./store.ts";

export function initializeResearch(store: AssistantStore): void {
  const entries = [
    {
      id: "research:seeds",
      kind: "preference" as const,
      text: "研究起点是导师建议的 The Path to Recursive Self-Improving Agents: Foundation, Framework, and Future Directions（RSI综述，https://self-improving-agent.com/，原文 https://www.preprints.org/manuscript/202608.0051）和 SimWorld Studio（https://arxiv.org/abs/2605.09423）。目标是调研不同方法并比较机制、假设、实验、成本与局限；这些起点不等于已经读懂或复现。",
    },
    {
      id: "research:projects",
      kind: "preference" as const,
      text: "关注 Agent/AI 工程。已有 Prism 浏览器执行项目，正在实现自己编写任务循环的个人助手。可以把研究方法与工具反馈、执行回执、研究状态和评测联系起来；不能假定已掌握所有相关技术。",
    },
    {
      id: "research:brief",
      kind: "preference" as const,
      text: "每天北京时间10:00，5–10分钟研究晨报，少量高质量推荐，不凑数；允许重要旧论文、成熟项目；推送不等于已读或掌握。",
    },
    {
      id: "learning:boundary",
      kind: "correction" as const,
      text: "学校是西北工业大学，课程信息来自翱翔门户或用户确认；nwpu-cram只提供社区学习资料。修过课、成绩、简历中的项目或收到晨报都不是掌握证据。说明已知事实、推断和待验证想法；引用未读附件时要明确未读。",
    },
  ];
  const existing = new Set(store.listMemory().map((m) => m.id));
  const now = new Date().toISOString();
  for (const entry of entries)
    if (!existing.has(entry.id))
      store.upsertMemory({
        ...entry,
        status: "confirmed",
        createdAt: now,
        updatedAt: now,
      });
}
