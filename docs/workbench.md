# 工作台

工作台是 Prism 的桌面界面：Electron 壳 + 本地 Web
UI。它承担工作区选择、会话、聊天、工具执行过程、代码改动与产物查看、审批交互和设置展示；不直接访问文件系统、模型或会话日志，所有行为经[内核接口契约](kernel-contract.md)发生。

## 运行

### Windows 安装版

从 [GitHub Releases](https://github.com/Tulipe1735/Prism/releases/latest) 下载
`Prism-<版本>-Setup-x64.exe`，按安装向导选择目录。安装程序会创建桌面与开始菜单快捷方式。

需要 Windows x64，以及已完成首次用户设置的 x86_64 WSL
Linux 发行版（推荐 Ubuntu）。没有 WSL 时，应用会显示安装说明。

首次打开 Prism：

1. 选择 WSL 发行版，点击「准备并开始」。内核和 Node 随安装包提供，无需检出仓库或另装 Node。
2. 默认同时下载 Chromium；也可以取消勾选，稍后按 `Alt`
   打开「运行环境」菜单，准备所需浏览器。
3. 在自动展开的设置中填写模型端点、名称与 API 密钥，再选择 WSL 工作区，例如
   `/home/you/projects/demo`。

发行版选择保存在 Windows 的 `%APPDATA%/Prism/desktop.json`；内核运行时保存在所选发行版的
`~/.local/share/prism/runtime/`（遵循 `XDG_DATA_HOME`），会话和模型设置保存在
`~/.prism/`。升级和卸载不会删除会话与设置。更换发行版时，退出 Prism 后删除
`desktop.json`，再重新打开。

浏览器首次下载需要联网；Linux 缺少浏览器系统依赖时，按准备日志中的 Playwright 提示在所选发行版中安装。当前安装包没有代码签名，Windows 可能显示发布者未知。

### 从源码运行

产品入口是 Electron 工作台：它经 `wsl.exe`（Windows）或本地
`node`（Linux 开发环境）拉起内核、起 UI 服务器、打开窗口；退出时先 `POST /shutdown`
再关闭 UI 服务器。

```bash
pnpm build
pnpm workbench:electron
```

`pnpm workbench` 是同一份 UI 的**开发/测试辅助入口**：自己拉起内核（或对着 `--kernel`
指定的内核），打印一行 JSON 与可点开的 URL，供普通浏览器打开。它不改变行为，只是换承载方式；验收以 Electron 窗口为准。

```bash
pnpm build
pnpm workbench                       # 自己拉起内核，打印一行 JSON 与可点开的 URL
pnpm workbench --kernel http://127.0.0.1:41234      # 对着已有内核跑
```

要点：

- 跨平台的内核命令见 `src/workbench/kernel-process.ts`；Windows 先通过
  `src/workbench/wsl-runtime.ts`
  展开并校验随应用提供的 WSL 运行时，再启动内核。Windows 源码开发时，先在 WSL 中执行
  `pnpm package:win` 准备 `.packaging/resources`。
- Electron 运行时由 `electron` 包在 `pnpm install`
  时下载；被环境拦住时（`pnpm approve-builds` 未批准或缺网）可在 `node_modules/electron`
  里手动 `node install.js`。
- 准备失败时，启动页面显示可重试的错误与日志，stderr 也保留一份。

### 构建 Windows 安装包

在 Windows 中使用 Node.js ≥22.23.2 和 pnpm（Linux / WSL 构建还需要 Wine）：

```bash
pnpm install --frozen-lockfile
pnpm package:win
```

输出为 `release/Prism-<版本>-Setup-x64.exe`。构建脚本下载并校验 Linux
Node，打包内核与 Playwright，再用 electron-builder 生成 NSIS 安装包。Windows 端只携带工作台，WSL 端携带完整 Node 运行时；两端都不依赖源码目录。构建缓存位于
`.packaging/cache/`，构建内容与安装包目录已从版本控制中排除。

## 一个来源

浏览器只跟 UI 服务器同源通信：UI 服务器把
`/kernel/...`（含 SSE）转发给内核。这样内核不需要处理 CORS，UI 在 Electron 和普通浏览器里是同一份代码。

```
浏览器 ── /（index.html, app.js, app.css）──▶ UI 服务器 ── /kernel/* ──▶ 内核
        ── /kernel/events（SSE）────────────▶            ──▶ HTTP/SSE
```

## UI 结构

前端使用 React + Tailwind
CSS。浅色界面以瑞士风格的网格、留白、细分隔线与朱红色强调为基础：左侧是工作区与会话，中间是任务对话，右侧是产物与设置。窄窗口通过顶栏按钮展开两侧面板。

`src/workbench/ui/main.tsx` 挂载 React，`app.tsx` 组合各区域；`use-workbench.ts`
管理内核连接和操作，继续复用 `client.ts`、`state.ts` 与
`derive.ts`。流式更新由 React 更新对应节点，设置草稿和工具卡片的展开状态不会随事件重画而丢失。界面只用本地打包资源，无需从 CDN 下载脚本、字体或样式。

`pnpm build` 分别构建 Node 与浏览器代码，再通过 Tailwind CLI 生成
`dist/workbench-ui/app.css`。浏览器依赖随前端打包，Electron 仍使用运行时提供的模块。

| 区域     | 内容                                                                                                     | 来源                                             |
| -------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 顶栏     | 内核连接、状态、版本、数据目录                                                                           | `kernel.status` 事件与 `/status`                 |
| 工作区   | 输入或从最近使用中选一个 WSL 路径                                                                        | 本地记忆 + 会话列表中的工作区                    |
| 会话列表 | 按工作区分组、新建、继续、重命名、删除、搜索                                                             | `/sessions*` 与 `session.updated`                |
| 聊天     | 助手文本流式增量、工具卡片（参数、结果、diff）、压缩提示、手动「压缩上下文」                             | `message.delta`、`tool.*` 与 `GET /sessions/:id` |
| 审批     | 逐次审批卡片：工具、理由、目标、影响，按钮只有「允许一次」与「拒绝」                                     | `approval.requested` 与 `/approvals/:requestId`  |
| 产物     | 本次会话触碰过的文件、最新状态与最新 diff（内核没给 diff 时回退到写入内容）                              | 由会话日志推导（见下）                           |
| 设置     | 模型端点/名称/密钥（密钥只写不回传）、浏览器引擎、搜索来源与端点、数据目录；权限范围与浏览器动作审批可切 | `GET /settings` 与 `PUT /settings`               |

事件驱动，不轮询：界面只按 SSE 事件重画。事件流断开时自动重连，重连后按契约用
`GET /sessions/:id` 取回日志，因为内核不重放历史事件。

## 推导规则

工作台不解析内核内部结构，只用契约形状：

- **时间线**：会话条目按文件顺序渲染；`tool_call` 与其 `tool_result` 按 `callId`
  配对，没有结果的调用显示为「执行中」。`message.delta` 的 `entryId`
  一旦出现在日志里，以日志为准。
- **任务状态**：日志的最后一条是模型消息（assistant）或系统消息（system）时任务已结束，其它情况（用户消息、工具调用、工具结果、压缩）视为运行中。这是从 02 循环的落盘顺序推出的唯一判据，不额外请求内核。
- **代码改动与产物**：`tool_call` 条目带
  `effects`（内核在调用前判定并记录）时以它为准：声明了 `file-write`
  的调用算一次文件改动，其它 effect（命令、浏览器动作）不算。没有 effects 的条目（MCP 工具与旧日志）回退到旧判据：JSON 参数里有
  `path` / `file` / `filePath` / `file_path` / `filename`
  这类路径字段，且工具名不像只读工具（`read`、`grep`、 `web_*` 等）。`write_file`
  的结果自带内核生成的有界 unified diff（`diff --git`、`--- `、`@@`
  形状），界面直接渲染；只有没带 diff 的结果（文件过大、二进制、旧日志）才回退显示工具调用的
  `content`
  参数（本次写入的内容）。产物按路径归并，状态取最新一次，diff 取最近一次带 diff 的结果。
- **压缩**：`session.compacted`
  触发一次日志重读并提示原因（手动或自动），压缩条目本身随日志进入时间线。

## 测试

```bash
pnpm typecheck
pnpm test                            # 默认跳过需要浏览器/显示器的用例
PRISM_WORKBENCH_BROWSER=1 pnpm vitest run tests/workbench/browser.smoke.test.ts
PRISM_ELECTRON_SMOKE=1 pnpm vitest run tests/workbench/electron.smoke.test.ts
```

- `tests/workbench/derive.test.ts`、`state.test.ts`：视图与状态推导，另有一条用真实内核日志驱动的推导。
- `tests/workbench/ui/render.test.tsx`：React 组件渲染，覆盖不可信文本转义、会话、工具 diff、审批与设置。
- `tests/workbench/client.integration.test.ts`：真内核 + 脚本化模型，覆盖会话 CRUD、重命名、取消、设置写入、审批通过与拒绝（含 04 对工作区外写入的真实审批）与事件流。
- `tests/workbench/ui-server.integration.test.ts`：UI 服务器与 `/kernel`
  代理（含 SSE 与内核断开）。
- `tests/workbench/workbench-cli.test.ts`：命令行入口，自己拉内核与对着已有内核两种模式。
- `tests/workbench/browser.smoke.test.ts`：真实 Chromium 跑完整验收路径（工作区 → 新会话 → 流式消息 → 工具过程与 diff
  → 一次审批 → 产物 → 权限范围切换 → 重命名/搜索/删除）。需要
  `pnpm build`，且构建产物必须比源码新。
- `tests/workbench/electron.smoke.test.ts`：Electron 壳冒烟，需要 Electron 运行时与显示器。
- `tests/workbench/electron-bundle.test.ts`：Electron 壳的构建产物契约（`electron`
  保持外部依赖、UI 根目录指向 `dist/workbench-ui`），不需要 Electron 运行时。

## 本版限制

- 设置里模型（端点、名称、密钥）、浏览器引擎、搜索来源与端点、权限范围与浏览器动作审批都可写（`PUT /settings`）；`browser.endpoint`、上下文压缩阈值等启动期设置仍写在
  `<dataDir>/config.json`。
- 没有原生目录选择器：工作区路径由用户输入或从最近使用中选择，因为工作台不接触文件系统。
- 产物视图只包含本次会话的工具改动，不是仓库级 diff。
