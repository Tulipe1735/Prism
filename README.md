# Prism

[English](README.en.md) | 简体中文

Prism 是一个长期自用的个人 coding
agent。Windows 上的桌面工作台负责任务、会话、审批与产物；agent 在 WSL 中围绕你的仓库读代码、改文件、执行命令与测试，并核查结果。

Prism 自己运行任务循环，内置浏览器能力、MCP、skills、联网检索与跨会话记忆，默认使用 DeepSeek。

安装：[GitHub Releases](https://github.com/Tulipe1735/Prism/releases/latest)

文档：[工作台](docs/workbench.md) · [内核接口](docs/kernel-contract.md) ·
[浏览器 CLI](docs/browser-cli.md) · [架构](docs/architecture.svg)

## 状态

Windows 安装版从 [GitHub Releases](https://github.com/Tulipe1735/Prism/releases/latest)
下载。安装 `Prism-<版本>-Setup-x64.exe`
后打开 Prism，选择已设置好的 WSL 发行版，再填写模型设置。内核与 Node 随应用提供，无需检出仓库。完整步骤见[安装与运行](docs/workbench.md)。

Prism 仍在快速迭代，内核接口与界面可能随版本变化。

## 运行

### Windows 安装版

1. 从 [Releases](https://github.com/Tulipe1735/Prism/releases/latest) 下载并安装
   `Prism-<版本>-Setup-x64.exe`。
2. 打开 Prism，选择已设置好的 WSL 发行版。
3. 填写模型端点、名称与密钥，然后选择 WSL 工作区。

需要 Windows x64 和 x86_64 WSL
Linux 发行版（推荐 Ubuntu）。浏览器首次下载需要联网；缺少系统依赖时按准备日志的提示安装。

### 从源码运行

需要 Node.js ≥22.23.2 和 pnpm：

```bash
pnpm install
pnpm build
pnpm workbench
```

`pnpm workbench`
会自己拉起内核、打印本地 URL，适合开发与验收。Electron 桌面入口、Windows 打包与运行时准备见[工作台](docs/workbench.md)。

## 能力

- **桌面工作台**：工作区、会话、流式对话、工具过程、代码改动、任务产物、审批与设置。界面使用 React +
  Tailwind CSS、Inter 字体、中性冷灰与蓝色强调；不含内置编辑器、文件树或交互终端。
- **完整开发闭环**：在 WSL 工作区中读写文件、执行命令与测试，结果可核查。
- **浏览器能力**：观察、目标引用、动作校验与输入回执。内置 agent 直接使用，同时通过
  `prism` CLI 提供给外部 agent。
- **MCP**：接入外部工具服务器，配置见 [MCP 客户端](docs/mcp.md)。
- **Skills**：按目录约定按需加载，见 [skills](docs/skills.md)。
- **联网检索**：内置 `web_search` 与 `web_fetch`，默认使用 DeepSeek，可配置其他来源。
- **跨会话记忆**：会话历史持久化，可继续、可恢复、可压缩。
- **权限边界**：三档范围（只读 / 工作区可写 / 完全访问）加越界审批，授权只生效一次；参考
  [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的权限模型。
- **模型**：默认 DeepSeek API，兼容任意 OpenAI 兼容端点。

## 浏览器 CLI

`prism` 是供外部 agent 使用的 browser-use
CLI。它不调用模型，只负责观察浏览器、校验动作引用和执行单步输入。安装：

```bash
npm install -g @tulipe1735/prism
prism --help
```

用法与 agent 接入步骤见[浏览器指南](docs/browser-cli.md)；agent skill 见
[skills/prism](skills/prism/SKILL.md)。

## 架构

![Prism 架构](docs/architecture.svg)

Electron 界面运行在 Windows，内核运行在 WSL，两者通过本地 HTTP/SSE 通信，由桌面端通过
`wsl.exe` 启动内核。运行边界见 [ADR-0001](docs/adr/0001-windows-ui-wsl-execution.md)。

[可编辑 Excalidraw 源图](docs/architecture.excalidraw) · [领域词汇](GLOSSARY.md) ·
[首版需求](docs/requirements-2026-10-18-coding-agent.md)

代码：[工作台](src/workbench) · [内核](src/kernel) · [浏览器](src/browser) ·
[浏览器 CLI](src/interfaces/cli.ts)

## 开发

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

工作台的运行方式与结构见[工作台](docs/workbench.md)；用真实任务验收的步骤见[首版验收](docs/acceptance.md)。

内核可 headless 启动，监听 `127.0.0.1`
并把地址写成一行 JSON 输出（接口见[内核接口契约](docs/kernel-contract.md)）：

```bash
node --experimental-strip-types --disable-warning=ExperimentalWarning \
  src/interfaces/kernel.ts [--port <n>] [--data-dir <path>]
```

MIT License。README 的组织方式参考
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。
