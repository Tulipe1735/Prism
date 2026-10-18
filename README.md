# Prism

[English](README.en.md) | 简体中文

一个长期自用的个人 coding
agent。桌面工作台运行在 Windows，agent 在 WSL 中围绕你的仓库工作：读代码、改文件、执行命令与测试，并核查任务结果。

Prism 自己运行任务循环，内置 Prism 浏览器能力、MCP、skills、联网检索与跨会话记忆，默认使用 DeepSeek。

代码：[浏览器能力](src/browser) · [浏览器 CLI](src/interfaces/cli.ts) ·
[回执与会话](src/cli/sessions.ts)

## 状态

重构中。旧的个人研究助手已移除；新的 agent 内核与 Electron 桌面端尚未实现。

当前可用：`prism` 浏览器 CLI，用法见[浏览器指南](docs/browser-cli.md)。

## 首版目标

- **桌面工作台**：Windows 上的 Electron 界面，包含工作区、会话、聊天、工具执行过程、代码改动与任务产物查看。不含内置代码编辑器、文件树与交互终端。
- **完整开发闭环**：在 WSL 工作区中读写文件、执行命令与测试，结果可核查。
- **预置能力**：
  - Prism 浏览器能力：观察、目标引用、动作校验与输入回执；先服务内置 agent，之后可能开放给外部 agent。
  - MCP：接入外部工具服务器，配置见 [MCP 客户端](docs/mcp.md)。
  - Skills：按目录约定按需加载。
  - 联网检索：内置 `web_search` 与 `web_fetch`，默认使用 DeepSeek，可配置其他来源。
  - 跨会话记忆：会话历史持久化，可继续、可恢复。
- **权限边界**：三档范围（只读 / 工作区可写 / 完全访问）加越界审批，授权只生效一次；参考
  [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的权限模型。
- **模型**：默认 DeepSeek API，兼容任意 OpenAI 兼容端点。

## 架构

![Prism 架构](docs/architecture.svg)

Electron 界面运行在 Windows，内核运行在 WSL，两者通过本地 HTTP/SSE 通信，由桌面端通过
`wsl.exe` 启动内核。运行边界见 [ADR-0001](docs/adr/0001-windows-ui-wsl-execution.md)。

[可编辑 Excalidraw 源图](docs/architecture.excalidraw) · [领域词汇](GLOSSARY.md) ·
[首版需求](docs/requirements-2026-10-18-coding-agent.md)

## 开发

需要 Node.js ≥22.19 和 pnpm。

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

已有浏览器 CLI 的 agent skill 见
[skills/prism](skills/prism/SKILL.md)；内核的 skills 目录约定与优先级见
[docs/skills.md](docs/skills.md)。

MIT License。README 的组织方式参考
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。
