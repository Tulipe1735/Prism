# 内核接口契约

本文件冻结工作台（08）与权限审批（04）并行开发所依赖的内核接口：HTTP 端点、SSE 事件形状与启动方式。实现见
`src/kernel/`；事件类型定义见 `src/kernel/events.ts`（本文件不复制其 TypeScript 定义）。

契约变更必须同时修改本文件与 `src/kernel/events.ts`，并通知依赖它的 ticket。

## 传输

- 内核监听 `127.0.0.1` 的随机端口（可用 `--port` 固定），只服务本机客户端（ADR-0003）。
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
  "version": "0.1.6",
  "dataDir": "/home/demo/.prism"
}
```

监听失败时写 stderr 并以退出码 1 结束。`POST /shutdown` 应答后内核发出
`kernel.status: stopping`，关闭 SSE 连接并以退出码 0 结束。

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
| `INTERNAL_ERROR`     | 500  | 未预期错误；内核继续服务，不退出       |

## 端点

| 方法   | 路径                                 | 用途                    |
| ------ | ------------------------------------ | ----------------------- |
| GET    | `/status`                            | 内核状态                |
| GET    | `/settings`                          | 读取设置                |
| GET    | `/sessions?workspace=<path>`         | 会话列表                |
| POST   | `/sessions`                          | 新建会话                |
| GET    | `/sessions/:id`                      | 继续会话（摘要 + 条目） |
| DELETE | `/sessions/:id`                      | 删除会话                |
| POST   | `/sessions/:id/messages`             | 发送用户消息            |
| POST   | `/sessions/:id/cancel`               | 取消运行中的任务        |
| POST   | `/sessions/:id/compact`              | 手动压缩上下文          |
| POST   | `/sessions/:id/approvals/:requestId` | 应答审批                |
| GET    | `/events`                            | SSE 事件流              |
| POST   | `/shutdown`                          | 关闭内核                |

### GET /status

```json
{ "status": "ready", "version": "0.1.6", "dataDir": "/home/demo/.prism" }
```

`status` 取 `start` 时用的内核状态字面量：`starting` | `ready` | `stopping` | `error`。

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
  "browser": { "engine": "chromium" },
  "search": { "provider": "deepseek" },
  "permissions": { "scope": "workspace-write" }
}
```

- `permissions.scope` 取 `read-only` | `workspace-write` | `full-access`，默认
  `workspace-write`（ADR-0005）。
- 设置的**修改**端点由 04（权限范围）与后续 ticket 定义；工作台在本轮只读。

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

- 每个 `requestId` 只接受一次应答；重复应答或未知 id 返回 404
  `APPROVAL_NOT_FOUND`（ADR-0005：只允许一次，不记忆）。
- 内核在应答后发 `approval.resolved`，且不再为该 `requestId` 发 `approval.requested`。
- 请求的产生方是 04（权限范围与审批）：工具执行前经内核注册待审批请求，再触发
  `approval.requested`。02 提供端点与登记/应答机制。

### 关闭

`POST /shutdown` → 202 `{ "stopping": true }`。内核发出 `kernel.status: stopping`
后关闭 SSE 与 HTTP 服务并退出。

## SSE 事件流

`GET /events`，`content-type: text/event-stream`。每条事件写成：

```
event: tool.started
data: {"type":"tool.started","sessionId":"...","callId":"...","name":"echo","arguments":{"text":"hi"}}

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

工具按 `src/kernel/tool.ts` 的 `Tool` 形状注册进注册表，模型可见的
`name`/`description`/`parameters` 直接取自注册项。02 接入：

- `skill`：`{ "name": "<技能名>" }` 时返回该技能正文；省略 `name`
  时列出可用技能（名称、描述、来源）。技能发现与读取用
  `src/skills/loader.ts`，根目录优先级见
  `docs/skills.md`。技能的名称与描述同时写入系统提示，供模型选择。
- `echo`：占位工具，返回入参文本；03 接入真实文件与命令工具后保留用于自测。

工具收到的 `ToolContext` 里，`noteExplored(path)`
由文件与命令工具在解析每个要读、写、列出或作为工作目录的路径时调用（集中在
`src/kernel/tool-support.ts` 的 `gatePath`）；内核据此把该路径目录链上的嵌套 `AGENTS.md`
加入上下文，工作区外的路径被忽略。未调用不影响其他行为。

03（文件与命令）、04（权限）、06（浏览器）、07（联网检索）、09（MCP）向同一注册表追加工具；外部工具与内置工具形状相同（PRD
Implementation Decisions）。

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
