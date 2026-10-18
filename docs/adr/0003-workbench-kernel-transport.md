---
status: accepted
---

# 工作台与内核通过本地 HTTP/SSE 通信

Windows 上的 Electron 工作台通过 `wsl.exe` 启动 WSL 中的内核；内核监听 `127.0.0.1`
的随机端口，以 HTTP 提供服务、以 SSE 推送事件。被拒绝的方案：用 `wsl.exe`
的 stdio 传 JSON（需要自造协议，并受编码与进程退出语义影响）、把内核放到 Windows（脱离用户的 WSL 项目环境）。该决定补全
[ADR-0001](0001-windows-ui-wsl-execution.md) 中“实现设计时选择”的通信方式。
