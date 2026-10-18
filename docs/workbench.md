# 工作台

工作台是 Prism 的桌面界面：Electron 壳 + 本地 Web
UI。它承担工作区选择、会话、聊天、工具执行过程、代码改动与产物查看、审批交互和设置展示；不直接访问文件系统、模型或会话日志，所有行为经[内核接口契约](kernel-contract.md)发生。

## 运行

工作台有两种跑法，UI 本身是普通网页。

纯浏览器（开发与测试的主要方式）：

```bash
pnpm build
pnpm workbench                       # 自己拉起内核，打印一行 JSON 与可点开的 URL
pnpm workbench -- --kernel http://127.0.0.1:41234   # 对着已有内核跑
```

Electron 壳（与用户环境一致的方式）：

```bash
pnpm build
pnpm workbench:electron
```

Electron 只做三件事：经 `wsl.exe`（Windows）或本地
`node`（Linux 开发环境）拉起内核、起 UI 服务器、打开窗口；退出时先 `POST /shutdown`
再关闭 UI 服务器。

要点：

- 跨平台的内核命令见
  `src/workbench/kernel-process.ts`；Windows 上的内核在 WSL 里，路径无法从 Windows 检出推导，用
  `PRISM_KERNEL_ENTRY=/home/you/prism/dist/kernel.js`
  明确指定，缺少时报错而不是静默降级。
- Electron 运行时由 `electron` 包在 `pnpm install`
  时下载；被环境拦住时（`pnpm approve-builds` 未批准或缺网）可在 `node_modules/electron`
  里手动 `node install.js`。
- 失败时 Electron 把内核输出放进错误对话框，stderr 也留一份。

## 一个来源

浏览器只跟 UI 服务器同源通信：UI 服务器把
`/kernel/...`（含 SSE）转发给内核。这样内核不需要处理 CORS，UI 在 Electron 和普通浏览器里是同一份代码。

```
浏览器 ── /（index.html, app.js, app.css）──▶ UI 服务器 ── /kernel/* ──▶ 内核
        ── /kernel/events（SSE）────────────▶            ──▶ HTTP/SSE
```

## UI 结构

| 区域     | 内容                                                                                                       | 来源                                             |
| -------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 顶栏     | 内核连接、状态、版本、数据目录                                                                             | `kernel.status` 事件与 `/status`                 |
| 工作区   | 输入或从最近使用中选一个 WSL 路径                                                                          | 本地记忆 + 会话列表中的工作区                    |
| 会话列表 | 按工作区分组、新建、继续、重命名、删除、搜索                                                               | `/sessions*` 与 `session.updated`                |
| 聊天     | 助手文本流式增量、工具卡片（参数、结果、diff）、压缩提示                                                   | `message.delta`、`tool.*` 与 `GET /sessions/:id` |
| 审批     | 逐次审批卡片：工具、理由、目标、影响，按钮只有「允许一次」与「拒绝」                                       | `approval.requested` 与 `/approvals/:requestId`  |
| 产物     | 本次会话触碰过的文件、最新状态与最新 diff（工具没给 diff 时显示写入内容）                                  | 由会话日志推导（见下）                           |
| 设置     | 模型端点与名称、密钥是否已设置、浏览器引擎、搜索来源、数据目录（只读）；权限范围与浏览器动作审批（可切换） | `GET /settings` 与 `PUT /settings`               |

事件驱动，不轮询：界面只按 SSE 事件重画。事件流断开时自动重连，重连后按契约用
`GET /sessions/:id` 取回日志，因为内核不重放历史事件。

## 推导规则

工作台不解析内核内部结构，只用契约形状：

- **时间线**：会话条目按文件顺序渲染；`tool_call` 与其 `tool_result` 按 `callId`
  配对，没有结果的调用显示为「执行中」。`message.delta` 的 `entryId`
  一旦出现在日志里，以日志为准。
- **任务状态**：日志的最后一条是模型消息（assistant）或系统消息（system）时任务已结束，其它情况（用户消息、工具调用、工具结果、压缩）视为运行中。这是从 02 循环的落盘顺序推出的唯一判据，不额外请求内核。
- **代码改动与产物**：工具调用的 JSON 参数里有 `path` / `file` / `filePath` /
  `file_path` / `filename` 这类路径字段，且工具名不像只读工具（`read`、`grep`、`web_*`
  等）时算一次文件改动；工具结果里含统一 diff（`diff --git`、`--- `、`@@`）时渲染成 diff，否则原样显示结果；一次写整个文件的工具（如
  `write_file`）没有 diff，界面改显示它的 `content`
  参数（本次写入的内容）。产物按路径归并，状态取最新一次，diff 取最近一次带 diff 的结果。
- **压缩**：`session.compacted` 只触发一次日志重读，压缩条目本身随日志进入时间线。

## 测试

```bash
pnpm typecheck
pnpm test                            # 默认跳过需要浏览器/显示器的用例
PRISM_WORKBENCH_BROWSER=1 pnpm vitest run tests/workbench/browser.smoke.test.ts
PRISM_ELECTRON_SMOKE=1 pnpm vitest run tests/workbench/electron.smoke.test.ts
```

- `tests/workbench/derive.test.ts`、`render.test.ts`、`state.test.ts`：视图与状态推导，纯函数断言 HTML 与状态，另有一条用真实内核日志驱动的推导。
- `tests/workbench/client.integration.test.ts`：真内核 + 脚本化模型，覆盖会话 CRUD、重命名、取消、设置写入、审批通过与拒绝（含 04 对工作区外写入的真实审批）与事件流。
- `tests/workbench/ui-server.integration.test.ts`：UI 服务器与 `/kernel`
  代理（含 SSE 与内核断开）。
- `tests/workbench/workbench-cli.test.ts`：命令行入口，自己拉内核与对着已有内核两种模式。
- `tests/workbench/browser.smoke.test.ts`：真实 Chromium 跑完整验收路径（工作区 → 新会话 → 流式消息 → 工具过程与 diff
  → 一次审批 → 产物 → 权限范围切换 → 重命名/搜索/删除）。需要
  `pnpm build`，且构建产物必须比源码新。
- `tests/workbench/electron.smoke.test.ts`：Electron 壳冒烟，需要 Electron 运行时与显示器。

## 本版限制

- 设置里只有权限范围与浏览器动作审批可写（04 的
  `PUT /settings`）；模型端点、浏览器引擎与搜索来源只读，改动写在
  `<dataDir>/config.json`。
- 没有原生目录选择器：工作区路径由用户输入或从最近使用中选择，因为工作台不接触文件系统。
- 产物视图只包含本次会话的工具改动，不是仓库级 diff。
