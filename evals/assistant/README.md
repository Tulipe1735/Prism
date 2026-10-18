# 普通问答与深入研究对照

固定问题、资料快照、基础模型和起始研究状态；对照方法覆盖、差异准确性、比较条件、引用正确性。每项人工评为0/1/2分，必须记录具体证据，同时保留改进与退步。轮数和token增加不证明质量提高。

输入 `snapshot.json`：

```json
{
  "question": "比较这些资料中处理同一问题的路线，说明假设、实验条件、成本与限制。",
  "documents": [
    {
      "id": "paper-a",
      "title": "原始论文标题",
      "url": "https://example.com/paper",
      "version": "固定版本或文件摘要",
      "content": "实际读取的原文片段，包含章节/页码；请替换此示例。"
    }
  ],
  "state": [{ "id": "research-goal", "text": "本次固定研究问题" }]
}
```

运行前先准备真实快照，勿把示例当论文证据。执行会使用配置的DeepSeek API并计入生产预算：

```bash
node --env-file=.env --experimental-strip-types evals/assistant/run.ts --fixture snapshot.json --output .scratch/assistant-eval-2026-10-18
```

评测先写入 `conditions.json`
与快照，再分别运行普通/深入任务；只允许固定资料检索，停止在线来源变化。输出两个任务的报告、进度、耗时、用量与估算费用，以及待人工评分的
`comparison.json`。未做人工核对时不宣称深入模式更优。

实现：[run.ts](run.ts)。主任务契约测试：[../../tests/assistant](../../tests/assistant)。
