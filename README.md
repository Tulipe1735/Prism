# Prism

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/Tulipe1735/Prism)

[English](README.en.md) | 简体中文

**Prism 是面向 Windows 和 WSL 的可扩展个人 Agent 工作台。**

你在桌面工作台中提出任务，Agent 通过文件、命令、浏览器和外部工具推进工作，并留下可查看的执行过程与结果。内核采用 Cordis；开启
**Creator Mode**
后，可以直接用自然语言许愿新能力，让 Agent 创建、安装和验证插件，无需重启应用。

[下载 Windows 安装版](https://github.com/Tulipe1735/Prism/releases/latest) ·
[使用指南](docs/README.md) · [Creator Mode](docs/guide/creator-mode.md) ·
[插件开发](docs/develop/plugins.md)

## 开始使用

1. 从 [Releases](https://github.com/Tulipe1735/Prism/releases/latest) 下载并安装
   `Prism-<版本>-Setup-x64.exe`。
2. 打开 Prism，选择 **Windows 原生**或已设置好的 **WSL 发行版**，完成运行环境准备。
3. 在设置中填写模型端点、名称和密钥，选择当前环境中的工作区，开始对话。

Windows 原生模式无需 WSL，也无需另外安装 Node。WSL 模式使用所选发行版的 Linux 工具链。默认模型为 DeepSeek，可配置 OpenAI 兼容端点。首次下载浏览器需要联网。安装、运行环境切换、数据位置和更新方法见[工作台指南](docs/guide/workbench.md)。

## 现在能做什么

- **开发与文件任务**：读取和编辑文件、搜索仓库、执行命令和测试，查看改动与产物。
- **浏览器操作**：观察页面、获取目标上下文、校验目标引用、执行动作和检查输入回执；支持 Chromium、Firefox、WebKit，以及接管已登录的 Chrome
  / Edge。
- **按需扩展**：Creator
  Mode 创建和热加载本地插件；MCP 接入外部工具；skills 提供按需读取的工作流说明。
- **连续会话**：保留本地会话历史，支持恢复、取消任务和上下文压缩。
- **可见的执行过程**：桌面工作台展示流式回复、工具调用、改动、审批和设置。
- **Windows 与 WSL**：同一套内核运行在所选环境，工作区、会话和插件保存在该环境中。

文件与命令工具按只读、工作区可写、完全访问三档权限执行；工作区外写入需要一次性审批。插件运行可信的本地代码，MCP 工具的能力由服务器自身控制。具体范围见[权限指南](docs/guide/permissions.md)。

## Creator Mode：用对话许愿插件

在 **设置 → Creator Mode** 开启“允许 Agent 创建和更新插件”，然后直接说：

> 给我做一个统计文本字数的插件，安装后用一段中文和英文验证它。

Agent 可以检查能力并准备多文件 Bundle，单独启用后在下一轮调用新工具。插件支持受控 npm 依赖、十个 UI
Slot 和开发热重载；Excalidraw 已使用同一契约。设置中可查看、启用、停用、重载和移除；更新失败恢复旧版本。

Creator
Mode 默认关闭。关闭后，已启用的插件继续工作。Bundle 支持后端工具、事件和 UI；DSH 插件需要核对宿主接口。完整用法见[Creator Mode](docs/guide/creator-mode.md)，代码契约见[插件开发](docs/develop/plugins.md)。

## 给其他 Agent 使用的浏览器 CLI

Prism 还提供独立的 `prism` browser-use
CLI：外部 Agent 负责规划和判断结果，CLI 负责观察浏览器、校验引用和执行单步动作，无需模型密钥。

```bash
npm install -g @tulipe1735/prism
prism --help
```

[浏览器 CLI 指南](docs/guide/browser-cli.md) · [Agent skill](skills/prism/SKILL.md)

## 发展方向

Prism 希望让 CLI
agent 结合浏览器、应用 CLI 和应用对象接口，覆盖更多真实的软件操作任务。后续探索包括 CLI-Anything 集成、WPS 等应用的对象级操作，以及借鉴 Harness²、根据执行证据改进 Harness。
**这些集成和自动迭代尚未实现**；当前可使用的是工作台、内置工具、MCP、skills、浏览器 CLI 与 Creator
Mode。

## 文档与开发

文档按使用指南、开发指南和接口参考组织：

- [文档入口](docs/README.md)
- [从源码运行、验证和发布](docs/develop/README.md)
- [插件开发](docs/develop/plugins.md)
- [架构](docs/reference/architecture.md) ·
  [内核 HTTP/SSE 接口](docs/reference/kernel.md)
- [Cordis 插件生命周期](docs/reference/plugins.md) · [领域词汇](GLOSSARY.md)

需要 Node.js ≥22.23.2 和 pnpm：

```bash
pnpm install
pnpm build
pnpm workbench
```

源码入口：[内核](src/kernel) · [工作台](src/workbench) ·
[浏览器 CLI](src/interfaces/cli.ts)

插件设计与文档组织参考
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。Creator
Mode 的出发点见[《DeepSeek Harness》课程幻灯片](https://jyywiki.cn/GSE/2026/slides9.html)。

MIT License。
