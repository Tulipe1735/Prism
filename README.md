# Prism

[English](README.en.md) | 简体中文

一个为长期自用构建的个人研究 Agent。每天筛选值得读的论文与项目，围绕研究问题比较不同方法，并把讨论中的进展带到下一次任务。

Prism 自己运行任务循环，使用 DeepSeek 调用工具、核查来源和保存成果。飞书中的情报与问答角色共用研究状态；已登录的本地浏览器负责翱翔门户任务。

代码：[任务循环](src/assistant/runtime.ts) · [角色提示词](src/assistant/prompts.ts) ·
[编排](src/assistant/service.ts)

## 能做什么

- **研究晨报**：北京时间10:00，结合 Gmail 论文订阅与 GitHub
  Trending；质量优先，无推荐则静默。
- **深入研究**：查找替代路线，比较机制、假设、实验、成本与限制；核查、修订，最长20分钟。
- **个人资料**：Notion 同步为 Markdown，手动导入 Markdown、文本 PDF 和简历；引用原始位置。
- **持续使用**：两个角色共享进展、偏好和纠正规则；推送、已读与掌握分别记录。
- **课程学习**：结合课程记录与 nwpu-cram；本地门户操作保留观察、确认和执行回执。

代码：[来源](src/assistant/connectors.ts) · [资料](src/assistant/library.ts) ·
[状态](src/assistant/store.ts) · [课程](src/assistant/courses.ts) ·
[本地工作端](src/assistant/local.ts)

## 运行

需要 Node.js ≥22.19 和 pnpm。

```bash
pnpm install
pnpm build
cp .env.example .env
# 填写 DeepSeek API、实际固定月费及需要的接入配置
node --env-file=.env dist/agent.js init
node --env-file=.env dist/agent.js doctor
node --env-file=.env dist/agent.js ask "比较我的研究资料中的不同 Agent 路线" --deep
node --env-file=.env dist/agent.js serve
```

首次接入飞书、Notion、Gmail 与云端部署，见[运行指南](docs/assistant.md)。固定费用与模型调用共用每月50元预算上限；用量按配置价格估算，账单需定期核对。

代码：[入口](src/assistant/cli.ts) · [配置](src/assistant/config.ts) ·
[飞书](src/assistant/feishu.ts) · [部署](compose.assistant.yaml)

## 架构

![Prism 个人研究助手架构](docs/architecture.svg)

[可编辑 Excalidraw 源图](docs/architecture.excalidraw) ·
[代码索引](docs/architecture.md) · [领域词汇](GLOSSARY.md)

代码：[核心模块](src/assistant) · [浏览器 CLI](src/interfaces/cli.ts) ·
[回执与会话](src/cli/sessions.ts)

## 开发状态

[验收记录](docs/assistant-verification.md)列出离线覆盖范围与待接入项目。

当前为开发预览。受控集成测试覆盖任务、引用、共享状态、同步、预算和交付。真实账号收发、云端常驻、个人 Notion/Gmail 导入与翱翔门户查询仍须配置凭据后实测，尚未上线。

已有浏览器 CLI 通过 `prism` 使用，参见[浏览器指南](docs/browser-cli.md)与
[agent skill](skills/prism/SKILL.md)。

代码：[集成测试](tests/assistant) · [研究对照评测](evals/assistant/README.md) ·
[浏览器测试](tests/cli)

## 开发

```bash
pnpm typecheck
pnpm test
pnpm build
```

MIT License。README 的组织方式参考
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。

代码：[测试配置](vitest.config.ts) · [构建入口](tsup.config.ts)
