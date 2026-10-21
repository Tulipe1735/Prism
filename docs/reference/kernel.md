# 内核接口契约

内核可原生运行于 Windows，也可运行于 WSL；内置能力由
[Cordis 插件](plugins.md)装配。本文件描述内核接口：HTTP 端点、SSE 事件形状与启动方式。实现见
`src/kernel/`；事件类型定义见 `src/kernel/events.ts`（本文件不复制其 TypeScript 定义）。

接口变更必须同步更新本文件、相关类型定义与工作台调用方。

## 传输

- 内核监听 `127.0.0.1` 的随机端口（可用 `--port` 固定），只服务本机客户端。
- HTTP 提供请求/应答；SSE 推送事件。工作台按事件渲染，不轮询。
- 所有请求与应答均为 JSON（`content-type: application/json`），`/events` 除外。

### 启动与关闭

启动方式（开发期脚本入口，打包后为 `dist/kernel.js`）：

```bash
node --experimental-strip-types --disable-warning=ExperimentalWarning \
  src/interfaces/kernel.ts [--port <n>] [--data-dir <path>]
```

`--data-dir` 缺省时依次取 `PRISM_DATA_DIR`、`~/.prism`（与 `src/kernel/config.ts`
一致）。

监听成功后，内核向 stdout 写一行机器可读 JSON，供工作台取得端口；其余日志写 stderr：

```json
{
  "type": "kernel.ready",
  "url": "http://127.0.0.1:41234",
  "port": 41234,
  "version": "0.3.0",
  "dataDir": "/home/demo/.prism"
}
```

全部内置插件初始化完成后才监听端口。初始化或监听失败时释放已创建的插件与连接，写 stderr 并以退出码 1 结束。`POST /shutdown`
应答后内核发出
`kernel.status: stopping`，关闭 SSE 连接，等待任务日志与插件资源清理，然后以退出码 0 结束。

### 错误应答

非 2xx 应答统一为：

```json
{ "error": { "code": "SESSION_NOT_FOUND", "message": "Session abc does not exist" } }
```

| code                 | HTTP | 含义                                   |
| -------------------- | ---- | -------------------------------------- |
| `INVALID_REQUEST`    | 400  | 路径、查询或请求体不合法               |
| `SESSION_NOT_FOUND`  | 404  | 会话 id 不存在                         |
| `APPROVAL_NOT_FOUND` | 404  | 审批请求不存在、已应答或已失效         |
| `TASK_RUNNING`       | 409  | 该会话已有任务在运行，不能并发再发消息 |
| `CREATOR_DISABLED`   | 403  | Creator Mode 未开启，拒绝安装插件      |
| `PLUGIN_NOT_FOUND`   | 404  | 插件不存在                             |
| `PLUGIN_FAILED`      | 422  | 插件加载或更新失败                     |
| `INTERNAL_ERROR`     | 500  | 未预期错误；内核继续服务，不退出       |

## 端点

| 方法   | 路径                                 | 用途                    |
| ------ | ------------------------------------ | ----------------------- |
| GET    | `/status`                            | 内核状态                |
| GET    | `/settings`                          | 读取设置                |
| PUT    | `/settings`                          | 修改设置                |
| GET    | `/plugins`                           | 插件列表与加载状态      |
| POST   | `/plugins`                           | 插件安装、检查与启停    |
| GET    | `/sessions?workspace=<path>`         | 会话列表                |
| POST   | `/sessions`                          | 新建会话                |
| GET    | `/sessions/:id`                      | 继续会话（摘要 + 条目） |
| PATCH  | `/sessions/:id`                      | 重命名会话（title）     |
| DELETE | `/sessions/:id`                      | 删除会话                |
| POST   | `/sessions/:id/messages`             | 发送用户消息            |
| POST   | `/sessions/:id/cancel`               | 取消运行中的任务        |
| POST   | `/sessions/:id/compact`              | 手动压缩上下文          |
| POST   | `/sessions/:id/approvals/:requestId` | 应答审批                |
| GET    | `/events`                            | SSE 事件流              |
| POST   | `/shutdown`                          | 关闭内核                |

### GET /status

```json
{
  "status": "ready",
  "version": "0.3.0",
  "dataDir": "/home/demo/.prism",
  "runningTasks": 0
}
```

`status` 取 `start` 时用的内核状态字面量：`starting` | `ready` | `stopping` | `error`。

### GET /plugins 与 POST /plugins

`GET /plugins` 返回 `{ "plugins": [...] }`。每项包括
`name`、`description`、`enabled`、`state`、`tools`，加载失败时附带 `error`。 `state` 为
`active`、`disabled` 或 `failed`。这里不返回源码。

`POST /plugins` 要求 `Content-Type: application/json`，接受与模型工具 `plugin_manager`
相同的动作：

- `list`：返回摘要列表。
- `inspect` + `name`：返回完整持久记录，包括 `source`。
- `install` + `name`、`description`、`source`：创建或更新并立即启用；要求 Creator
  Mode 已开启。
- `enable`、`disable`、`reload`、`remove` + `name`：管理已有插件。

响应为 `{ "result": ... }`：`inspect`
返回记录，其余动作返回当前摘要列表。管理操作依次执行。失败更新恢复旧版本；启动时单个插件失败不会阻止内核服务。具体源码契约见[插件开发](../develop/plugins.md)。

### GET /settings

只读。工作台展示当前生效设置；模型密钥只报告是否已设置，不回传明文。

```json
{
  "dataDir": "/home/demo/.prism",
  "model": {
    "baseUrl": "https://api.deepseek.com/v1",
    "model": "deepseek-chat",
    "hasApiKey": true
  },
  "browser": { "engine": "chromium", "actionsNeedApproval": false },
  "search": { "provider": "deepseek" },
  "permissions": { "scope": "workspace-write" },
  "creator": { "enabled": false }
}
```

- `permissions.scope` 取 `read-only` | `workspace-write` | `full-access`，默认
  `workspace-write`；可用 `PUT /settings` 切换。
- `browser.engine` 取 `chromium` | `firefox` | `webkit`；可用 `PUT /settings`
  切换，下一次 `browser_open` 使用新引擎。
- `browser.actionsNeedApproval` 取布尔值，默认 `false`：为 `true`
  时每个浏览器动作都要一次审批。工作台入口由工作台消费本契约出卡片。
- `search` 报告当前来源；配置了 `search.baseUrl` 时一并报告（缺省时省略该键）。
- `creator.enabled` 默认 `false`；开启后向模型提供 `creator_inspect` 和
  `plugin_manager`。关闭不会停用已安装插件。

### PUT /settings

修改设置。请求体只允许出现要改的字段；未列出的键返回 400 `INVALID_REQUEST`
（而不是静默忽略）：

```json
{ "permissions": { "scope": "read-only" } }
```

```json
{ "browser": { "engine": "firefox", "actionsNeedApproval": true } }
```

```json
{ "model": { "baseUrl": "https://api.deepseek.com/v1", "model": "deepseek-chat" } }
```

```json
{ "model": { "apiKey": "<新密钥>" } }
```

```json
{ "search": { "provider": "gateway", "baseUrl": "https://gateway.example.com" } }
```

```json
{ "creator": { "enabled": true } }
```

→ 200，应答体与 `GET /settings` 相同，即修改后生效的全部设置。内核同时把修改合并进
`<dataDir>/config.json`，下次启动沿用（未写过的字段保持原值）。

| 段            | 可改的键                        | 生效时机                         |
| ------------- | ------------------------------- | -------------------------------- |
| `permissions` | `scope`                         | 下一次工具调用                   |
| `browser`     | `engine`、`actionsNeedApproval` | 下一次 `browser_open` / 动作判定 |
| `model`       | `baseUrl`、`model`、`apiKey`    | 下一次模型请求                   |
| `search`      | `provider`、`baseUrl`           | 下一次 `web_search`              |
| `creator`     | `enabled`                       | 当前工具列表与下一次模型请求     |

- `model.apiKey` 只写不回传：应答只带 `model.hasApiKey: true`。
- 以上字段都必须是非空字符串（或枚举值）；`browser.endpoint` 与 `compaction`
  等启动期设置不在本端点内，`PUT` 它们返回 400。
- 范围切换立即生效：正在运行的任务，其下一次工具调用就按新档位判定。
- 未知来源名加显式 `search.baseUrl` 时按 DeepSeek 兼容端点处理；没有 `baseUrl`
  的未知来源会在调用 `web_search` 时报错，不影响内核启动。
- 本轮不新增事件：修改方以本应答更新界面；其他客户端在需要时读 `GET /settings`。

### 会话

会话摘要（列表、新建、详情共用）：

```json
{
  "id": "6f1c9a3e-...",
  "workspace": "/home/demo/project",
  "title": "修复登录",
  "createdAt": "2026-10-18T09:00:00.000Z",
  "updatedAt": "2026-10-18T09:04:11.000Z",
  "entryCount": 7,
  "leafId": "b0a1..."
}
```

`title` 缺省时省略。

- `GET /sessions?workspace=<path>` → `{ "sessions": [<摘要>, ...] }`，按 `updatedAt`
  降序；`workspace` 省略时返回全部工作区。
- `POST /sessions`，请求体 `{ "workspace": "<绝对路径>", "title": "<可选>" }` → 201
  `{ "session": <摘要> }`。
- `GET /sessions/:id` → 200
  `{ "session": <摘要>, "entries": [<会话条目>, ...] }`。条目形状见
  `src/kernel/session.ts`（`header`
  以外的日志行，按文件顺序）。工作台重连后由此恢复聊天与工具过程。
- `PATCH /sessions/:id`，请求体 `{ "title": "<非空>" }` → 200
  `{ "session": <摘要> }`，并发 `session.updated`。会话有运行中的任务时返回 409
  `TASK_RUNNING`（日志正在被追加，重写头部不安全）；条目不受影响。
- `DELETE /sessions/:id` → 200
  `{ "deleted": true }`；若该会话有任务在运行，先取消再删除。

### 发送消息

`POST /sessions/:id/messages`，请求体 `{ "text": "..." }` → 202
`{ "entryId": "<用户消息条目 id>" }`。

内核把用户消息追加到会话日志后立即应答，任务在后台运行，进展经 SSE 推送。该会话已有任务运行时返回 409
`TASK_RUNNING`。

一次任务的消息形状（每轮）：`message(assistant)` 文本 → `tool_call` 条目 → `tool_result`
条目 → 下一轮，直到模型不再调用工具。条目由 `session.updated` 事件与 `GET /sessions/:id`
双路可见。

- 模型的工具调用参数按原样（JSON 文本）存入 `tool_call.arguments`；
  `tool.started.arguments` 是解析后的 JSON 值，解析失败时是原始字符串。
- `tool_call.effects`
  记录这次调用声明的动作（`Tool.effects`，见「工具」），供工作台区分文件改动与读取；工具不声明 effects 时该键省略（含义是「未知」，不是「无动作」）。
- 工具结果超过 8 000 字符时截断，并在末尾附
  `\n[result truncated after 8000 characters]`；模型看到的是截断后的文本。
- 模型或传输失败：不伪造助手回复，改为追加一条 `role: "system"`
  的消息条目说明失败原因，经 `session.updated`
  可见。模型请求不自动重试；失败即进入该路径。
- 一轮任务最多 25 次模型往返，超出后以 `system` 条目说明并结束。

### 取消

`POST /sessions/:id/cancel` → 200 `{ "cancelled": true }`；该会话没有运行中的任务时返回
`{ "cancelled": false }`。

取消后：模型流立即中止；已流出的助手文本按已收到的内容落盘；未执行的工具调用写入结果
`"Task cancelled before this tool ran."`（`isError: true`），使日志保持「每个
`tool_call` 都有 `tool_result`」；随后写入一条 `system`
消息说明任务被用户取消。取消后该会话不再产生本次任务的任何事件。

### 压缩

`POST /sessions/:id/compact` → 200。压缩把上下文里较早的部分替换为一条模型写的摘要，写进
`compaction` 条目；原始条目一条不删。

```json
{ "compacted": true, "entryId": "<compaction 条目 id>" }
```

整个上下文仍在保留窗口内时返回 `{ "compacted": false }`
（没有可压缩的内容，端点不改动会话）。该会话有任务在运行时返回 409 `TASK_RUNNING`。

`compaction` 条目形状见 `src/kernel/session.ts`：`summary` 是摘要正文，
`firstKeptEntryId` 是其之前全部条目被摘要取代的那条日志条目（`null`
表示上下文里没有逐字保留的条目）；上下文重建见 `rebuildContext`。

- **自动压缩**：每一轮模型请求前估算当前上下文（约 4 字符 1 token）；超过
  `compaction.triggerTokens` 时先生成摘要、写入条目，再用压缩后的上下文继续本轮任务。
- **保留窗口**：最近 `compaction.keepTokens` 估算大小的消息逐字保留；起点不会落在 `tool`
  结果上，避免留下找不到对应工具调用的消息。
- **摘要请求**：用会话模型发一次不带工具的内部请求，要求按「目标、决策、进行中、下一步、相关文件」分节；摘要内容就是
  `summary`。
- **摘要失败**：不中断任务、不写 `compaction` 条目；追加一条 `system`
  消息说明失败原因，本次任务沿用完整历史，不再重试压缩。
- **配置**：`<dataDir>/config.json` 的 `compaction` 段，缺省
  `{ "triggerTokens": 100000, "keepTokens": 15000 }`；`GET /settings` 不报告这两个值。

写入 `compaction` 条目后内核先发 `session.updated`（`entryCount` 已含该条目），再发
`session.compacted`。

### 审批应答

`POST /sessions/:id/approvals/:requestId`，请求体 `{ "approved": true }` → 200
`{ "approved": true }`。

- 每个 `requestId` 只接受一次应答；重复应答或未知 id 返回 404 `APPROVAL_NOT_FOUND`。
- 内核在应答后发 `approval.resolved`，且不再为该 `requestId` 发 `approval.requested`。
- 请求的产生方是 04（权限范围与审批）：工具执行前经内核注册待审批请求，再触发
  `approval.requested`。02 提供端点与登记/应答机制。

### 权限执行

范围在**工具执行前**由内核判定，不在工具内部各自实现（`src/kernel/permissions.ts`）。工具用
`Tool.effects` 声明一次调用会做什么，内核逐项判定后才调用
`execute`：任何一项被拒绝，工具根本不运行，`tool_result` 是一条 `isError: true` 的说明。

| 动作           | `read-only` | `workspace-write` | `full-access` |
| -------------- | ----------- | ----------------- | ------------- |
| 读文件         | 允许        | 允许              | 允许          |
| 写工作区内文件 | 拒绝        | 允许              | 允许          |
| 写工作区外文件 | 拒绝        | **审批**          | 允许          |
| 命令           | 拒绝        | 允许              | 允许          |
| 浏览器动作     | 允许\*      | 允许\*            | 允许\*        |

- 只读档是硬上限：它直接拒绝，不发审批请求（US-14 由用户切换档位，不由模型请求越权）。
- 路径按解析后的字符串比较，不跟随符号链接，也没有 OS 级沙箱。工作区外写的审批只对本次调用生效，不复用。
- \* 浏览器动作不受三档范围约束（范围只管文件效果）：默认自动执行，仅在
  `browser.actionsNeedApproval` 为 `true` 时逐个审批。该开关与档位正交。
- MCP 工具（09）不纳入三档范围：它们的 `Tool.effects` 为空，内核不判定。理由与边界见
  `docs/guide/permissions.md`。

`Tool.effects` 返回 0..n 个动作；同一次调用中重复的动作只判定一次、只请求一次审批。

### 关闭

`POST /shutdown` → 202 `{ "stopping": true }`。内核发出 `kernel.status: stopping`
后关闭 SSE 与 HTTP 服务并退出。

## SSE 事件流

`GET /events`，`content-type: text/event-stream`。每条事件写成：

```
event: tool.started
data: {"type":"tool.started","sessionId":"...","callId":"...","name":"read_file","arguments":{"path":"README.md"}}

```

- `event:` 为事件类型，`data:` 为 `KernelEvent` 的 JSON；两种字段内容一致，客户端可任选
  `EventSource` 的 `onmessage` 或按类型 `addEventListener`。
- 连接建立后立即推送一条当前 `kernel.status`（迟到的订阅者据此显示状态与版本）。
- 每 15 秒发送一行注释 `: keep-alive` 保活。
- 不重放历史事件：重连后工作台用 `GET /sessions/:id` 取回状态。事件只用于增量。
- 事件不带 `id:`，客户端不需要 `Last-Event-ID`。

事件类型（定义见 `src/kernel/events.ts`，共 9 种）：

| 类型                 | 载荷（除 `type` 外）                                           | 语义                                                     |
| -------------------- | -------------------------------------------------------------- | -------------------------------------------------------- |
| `message.delta`      | `sessionId`, `entryId`, `delta`                                | 助手文本增量；`entryId` 是该消息落盘后的条目 id          |
| `tool.started`       | `sessionId`, `callId`, `name`, `arguments`                     | 工具开始执行                                             |
| `tool.completed`     | `sessionId`, `callId`, `result`                                | 工具成功结束（`result` 已按上限截断）                    |
| `tool.failed`        | `sessionId`, `callId`, `error`                                 | 工具失败结束                                             |
| `approval.requested` | `sessionId`, `requestId`, `tool`, `reason`, `target`, `impact` | 需要用户逐次审批                                         |
| `approval.resolved`  | `sessionId`, `requestId`, `approved`                           | 审批已应答                                               |
| `session.updated`    | `session`（会话摘要）                                          | 会话日志已变化，含最后 `entryCount`/`leafId`             |
| `session.compacted`  | `sessionId`, `entryId`, `reason`                               | 已写入 `compaction` 条目；`reason` 为 `auto` 或 `manual` |
| `kernel.status`      | `status`, `version`, `dataDir`                                 | 连接建立时与状态切换时                                   |

顺序保证（可断言）：

1. 同一 `callId` 的 `tool.started` 一定先于它的 `tool.completed` 或
   `tool.failed`，且只出现一次。
2. 一次工具调用的 `tool.started`/结束事件之后才有下一条
   `session.updated`——工具过程在日志中可见，事件与日志顺序一致。
3. 助手文本的 `message.delta` 先于该消息的 `tool.started` 事件；`message.delta` 的
   `entryId` 与该会话日志中的 `message` 条目 id 一致。
4. `approval.requested` 先于同一 `requestId` 的 `approval.resolved`；同一 `requestId` 的
   `approval.requested` 只出现一次。
5. 取消之后不再出现本次任务的事件。
6. `session.compacted` 一定在该 `entryId` 对应的 `session.updated` 之后出现。

## 工具

工具按 `src/kernel/tools.ts` 的 `Tool` 形状注册进注册表，模型可见的
`name`/`description`/`parameters` 直接取自注册项。内核启动时注册的内置工具：

| 工具                                                                                               | 用途                                                | `effects`                                             |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------- |
| `read_file` `write_file` `list_directory` `glob` `grep`                                            | 工作区内读写与查找（03）                            | 仅 `write_file` 声明 `file-write`                     |
| `run_command`                                                                                      | 执行 shell 命令（03）                               | `command`                                             |
| `skill`                                                                                            | 列出或读取技能（见下）                              | 无                                                    |
| `browser_open` `browser_observe` `browser_context` `browser_act` `browser_receipt` `browser_close` | Playwright 浏览器（06）：观察、引用、单步动作与回执 | `browser_open` 与 `browser_act` 声明 `browser-action` |
| `web_search` `web_fetch`                                                                           | 联网检索（07）：检索与抓取，不改工作区              | 无                                                    |
| `mcp__<服务器>__<工具>`                                                                            | 配置的 MCP 服务器提供的工具（09），出厂 0 个        | 无                                                    |

02 接入：

- `skill`：`{ "name": "<技能名>" }` 时返回该技能正文；省略 `name`
  时列出可用技能（名称、描述、来源）。技能发现与读取用
  `src/skills/loader.ts`，根目录优先级见
  `docs/guide/skills.md`。技能的名称与描述同时写入系统提示，供模型选择。

测试不经过生产注册表：`tests/kernel/harness.ts` 自己注册占位工具 `echo`
驱动任务循环，内核出厂不包含它。

工具收到的 `ToolContext` 里，`noteExplored(path)`
由文件与命令工具在解析每个要读、写、列出或作为工作目录的路径时调用（集中在
`src/kernel/tool-support.ts` 的 `resolveToolPath`）；内核据此把该路径目录链上的嵌套
`AGENTS.md` 加入上下文，工作区外的路径被忽略。未调用不影响其他行为。

03（文件与命令）、04（权限）、06（浏览器）、07（联网检索）、09（MCP）向同一注册表追加工具；外部工具与内置工具形状相同（PRD
Implementation Decisions）。

工具执行前，内核用 `Tool.effects`（可选）判定权限：

- 会写文件、跑命令、驱动浏览器的工具必须声明这些动作（`{ kind: "file-write", path }`
  等）；路径按上下文里的工作区解析后交给内核。
- 不声明 `effects` 的工具不进三档范围判定：`skill` 与 MCP 工具（09）属此类。
- 判定顺序：`tool.started` 事件先出，判定不通过时该次调用以 `tool.failed`
  结束，模型读到一条 `isError: true` 的拒绝说明（含拒绝原因与「不要重试」的指引）。

## 指令文件

`AGENTS.md` 按「外层在前、内层在后」写入系统提示，每条都带文件路径：

1. 全局文件 `<home>/.agents/AGENTS.md`（`home` 为运行内核的用户目录）。
2. 工作目录的祖先目录链，从文件系统根到工作区根（含）。
3. 工作区内嵌套的 `AGENTS.md`：文件工具经 `ToolContext.noteExplored`
   上报探索到的路径后，其目录链上的嵌套文件从下一次模型请求起进入上下文，以紧随对话的
   `system` 消息给出，每个文件只出现一次，跨任务保留。

文件在每次请求前重新读取，因此修改在下一次请求生效；缺失或空文件不产生提示内容。

## 测试接缝

测试经真实内核进程/实例的 HTTP/SSE 接口发起会话、消息与工具调用，配脚本化的假 OpenAI 兼容模型（PRD
Testing
Decisions）。测试断言事件序列、会话日志落盘与取消行为，不测内部模块结构。假模型服务只需实现
`POST <baseUrl>/chat/completions`（`stream: true`，SSE 分块应答）。
