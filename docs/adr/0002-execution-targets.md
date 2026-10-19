---
status: accepted
---

# 执行目标：单内核在 WSL，同时支持 Windows

Prism 内核在 WSL 中以单实例运行，命令工具可以显式选择 WSL 或 Windows 作为执行目标；Windows 目标通过 WSL
interop 调用 Windows 程序，文件经 `/mnt/c`
访问。选择单内核而不是“WSL 与 Windows 各一个内核”，是因为会话、审批与配置必须保持一处权威；选择 interop 而不是把内核搬到 Windows，是因为用户的项目环境在 WSL。代价：跨边界文件访问慢、文件监听不可靠、Windows 命令的工作目录与输出编码需要转换，Windows 目标在性能上属于次等环境。

背景见
[ADR-0001](0001-windows-ui-wsl-execution.md)；需求见[首版需求](../requirements-2026-10-18-coding-agent.md)；两个目标的边界、限制与错误行为见[执行目标](../execution-targets.md)。
