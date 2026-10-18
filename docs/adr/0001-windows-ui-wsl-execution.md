---
status: accepted
---

# 首版在 Windows 展示界面，在 WSL 执行任务

Prism 首版使用 Windows 上的 Electron 轻量工作台，agent 在 WSL 中执行项目文件操作、命令和测试。用户的当前开发仓库位于 WSL，因此选择让 agent 与现有项目环境保持一致，而不是将执行环境改为 Windows。界面与执行端通过明确接口交互，具体通信方式在实现设计时选择。

用户已在需求对齐中明确选择这一运行方式，需求见
[首版需求](../requirements-2026-10-18-coding-agent.md)。执行目标后来扩展到 Windows（[ADR-0002](0002-execution-targets.md)），通信方式见
[ADR-0003](0003-workbench-kernel-transport.md)。
