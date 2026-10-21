# 工作台

工作台是 Prism 的桌面界面：Electron 壳 + 本地 Web
UI。它承担工作区选择、会话、聊天、工具执行过程、代码改动与产物查看、审批交互和设置展示；不直接访问文件系统、模型或会话日志，所有行为经[内核接口契约](../reference/kernel.md)发生。

## 运行

### Windows 安装版

从 [GitHub Releases](https://github.com/Tulipe1735/Prism/releases/latest) 下载
`Prism-<版本>-Setup-x64.exe`，按安装向导选择目录。安装程序会创建桌面与开始菜单快捷方式。

需要 Windows x64。可以直接原生运行；选择 WSL 模式时，另需完成首次用户设置的 x86_64 WSL
Linux 发行版。

首次打开 Prism：

1. 选择 Windows，或选择 WSL 及发行版，点击「准备并开始」。两种模式都无需检出仓库或另装 Node。
2. 默认同时下载 Chromium；也可以取消勾选，稍后按 `Alt`
   打开「运行环境」菜单，准备所需浏览器。
3. 在自动展开的设置中填写模型端点、名称与 API 密钥，再选择当前环境中的工作区：Windows 使用
   `C:\Users\you\project`，WSL 使用 `/home/you/projects/demo`。

运行模式与发行版选择保存在 Windows 的
`%APPDATA%/Prism/desktop.json`。Windows 原生内核使用 Electron 自带的 Node 运行时，会话和模型设置默认位于
`%USERPROFILE%/.prism/`；WSL 运行时保存在所选发行版的
`~/.local/share/prism/runtime/`（遵循 `XDG_DATA_HOME`），会话和设置位于该发行版的
`~/.prism/`。

升级和卸载不会删除会话与设置。通过「运行环境 → 切换运行环境」重新选择模式或发行版；先完成或取消现有任务。各环境的数据保持独立。

浏览器首次下载需要联网；Linux 缺少浏览器系统依赖时，按准备日志中的 Playwright 提示在所选发行版中安装。当前安装包没有代码签名，Windows 可能显示发布者未知。

### 账号与更新

左下角的账号按钮打开个人信息、工作台设置、检查更新和退出登录菜单。左侧栏收起后，顶部保留圆形新建会话按钮，底部保留账号头像。两侧栏均可独立折叠，设置和输入草稿在折叠时保留。

登录使用 Clerk 官方 Electron
SDK（当前为 Beta，锁定版本），支持中文登录和个人资料弹窗；第三方登录通过系统浏览器完成，并通过
`prism://workbench/`
返回应用。Windows 使用系统加密保存登录凭据。账号用于身份与个人信息，工作区、会话和模型配置仍保存在本机。

Clerk 实例需要启用 Native API，将 `prism://workbench` 加入 allowed origins，并将
`prism://workbench/` 加入移动 SSO 回调白名单。公开配置位于
`src/workbench/electron/identity-config.ts`；当前使用开发实例的 `pk_test`
公钥。发布生产实例时更换公钥与 Frontend API 域名。Secret
Key 不进入源码、渲染进程或安装包。配置方法见
[Clerk Electron 文档](https://clerk.com/docs/electron/getting-started/quickstart)。

Windows 安装版从 GitHub
Releases 检查更新。用户先点击下载，下载完成后选择「重启并安装更新」。安装前检查所有会话是否仍有任务运行，有任务时拒绝安装。更新不会在退出应用时自行安装。

v0.2.1 及更早版本需要手动安装本次新版一次，之后可使用左下角更新入口。

### 从源码运行

产品入口是 Electron 工作台：原生模式直接拉起内核，WSL 模式经 `wsl.exe`
拉起所选发行版中的内核，然后启动 UI 服务器并打开窗口；退出时先 `POST /shutdown`
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

- 跨平台启动计划见 `src/workbench/kernel-process.ts`。原生模式使用
  `src/workbench/native-runtime.ts`；WSL 模式使用 `src/workbench/wsl-runtime.ts`
  展开并校验 Linux 运行时。Windows 源码开发可直接运行原生模式；测试 WSL 安装包准备时先执行
  `pnpm package:win` 生成 `.packaging/resources`。
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
Node，打包内核与 Playwright，再用 electron-builder 生成 NSIS 安装包。Windows 端携带工作台及原生内核，WSL 端携带相同内核与完整 Linux
Node 运行时；两种模式都不依赖源码目录。构建缓存位于
`.packaging/cache/`，构建内容与安装包目录已从版本控制中排除。

发布 GitHub Release 时，必须一并上传安装程序、对应的 `.exe.blockmap`、`latest.yml`
与校验文件；更新检查依赖
`latest.yml`，下载由 electron-updater 校验。构建只生成文件，正式发布沿用 GitHub
Releases 流程。

在同时具有 Windows
Node 和 WSL 的本机上，可从 WSL 运行默认目录与显式目录的真实跨系统回归检查：

```bash
PRISM_WINDOWS_RUNTIME=1 pnpm exec vitest run tests/workbench/windows-runtime.integration.test.ts
PRISM_WINDOWS_NATIVE=1 pnpm exec vitest run tests/kernel/windows-native.integration.test.ts
```

## 一个来源

普通浏览器只跟 UI 服务器同源通信：UI 服务器把
`/kernel/...`（含 SSE）转发给内核。这样内核不需要处理 CORS，UI 在 Electron 和普通浏览器里是同一份代码。

Electron 工作台使用固定的 `prism://workbench`
地址，由主进程转发到同一 UI 服务器，避免随机端口改变登录来源。主窗口仅允许工作台自身页面导航，其他网页交给系统浏览器，防止外部页面获得登录桥接能力。

```
浏览器 ── /（index.html, app.js, app.css）──▶ UI 服务器 ── /kernel/* ──▶ 内核
        ── /kernel/events（SSE）────────────▶            ──▶ HTTP/SSE
```

## UI 结构

前端使用 React + Tailwind
CSS。界面以中性冷灰、细分隔线与蓝色强调为基础，中文使用思源宋体（Source Han Serif
SC），英文使用 Inter，代码块、行内代码与等宽字段使用 JetBrains
Mono。字体文件随应用打包，无需联网或预先安装；启动页和账号弹窗使用同一字体设置。

左侧是工作区与会话，中间是任务对话，右侧是产物与设置。左右面板可独立折叠；左栏收起后默认显示 Logo，悬停 Logo 或通过键盘聚焦时显示展开按钮，触屏直接显示展开按钮。窄窗口使用浮层。任务运行时，发送按钮原位显示为蓝底白色停止图标，不显示文字。

折叠有 300ms 的宽度过渡，侧栏内容会保留 120ms 再隐藏；工具卡片的收起会先停留 40ms，再用 240ms 折起。

`src/workbench/ui/main.tsx` 挂载 React，`app.tsx` 组合各区域；`use-workbench.ts`
管理内核连接和操作，继续复用 `client.ts`、`state.ts` 与
`derive.ts`。流式更新由 React 更新对应节点，设置草稿和工具卡片的展开状态不会随事件重画而丢失。工作台资源随应用打包；Clerk 登录与个人资料界面按官方 SDK 从实例域名加载，需要联网。

`pnpm build` 分别构建 Node 与浏览器代码，再通过 Tailwind CLI 生成
`dist/workbench-ui/app.css`。浏览器依赖随前端打包，Electron 仍使用运行时提供的模块。

| 区域     | 内容                                                                                                     | 来源                                             |
| -------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 顶栏     | 内核连接、状态、版本、数据目录                                                                           | `kernel.status` 事件与 `/status`                 |
| 工作区   | 选择当前环境中的目录或从最近使用中选择                                                                   | 本地记忆 + 会话列表中的工作区                    |
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
- Electron 使用原生目录选择器；普通浏览器入口仍由用户输入路径或从最近使用中选择。
- 产物视图只包含本次会话的工具改动，不是仓库级 diff。
