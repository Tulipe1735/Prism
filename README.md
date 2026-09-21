# Prism

Prism 是一个 TypeScript 浏览器智能体 CLI。给它一个网址和一句目标，它会把页面读成一张带编号的可见控件表，让决策模型选择「对哪个元素执行哪个操作」，通过 Chrome
DevTools Protocol 执行，直到决策模型判定目标达成。

```mermaid
flowchart TD
  subgraph group_interfaces["Interfaces"]
    node_cli["CLI<br/>[cli.ts]"]
    node_mcp["MCP Server<br/>[mcp.ts]"]
  end

  subgraph group_orchestration["Task Orchestration"]
    node_task["Task Runner<br/>[task.ts]"]
  end

  subgraph group_agent["Agent Runtime"]
    node_agent_loop["Agent Loop<br/>[agent.ts]"]
    node_action_space["Action Space<br/>[action-space.ts]"]
    node_decision["Decision Client<br/>[decision.ts]"]
    node_field_text["Field Text<br/>[text-helper.ts]"]
    node_records["Run Records<br/>[agent.ts]"]
  end

  subgraph group_browser["Browser Control"]
    node_connection["CDP Connection<br/>[connect.ts]"]
    node_session["Browser Session<br/>[session.ts]"]
    node_snapshot["DOM Snapshot<br/>[snapshot.js]"]
  end

  node_user(("User"))
  node_mcp_host(("MCP Host"))
  node_chrome["Chrome"]
  node_decision_api["Decision API"]
  node_text_api["Text Model API"]

  node_user -->|"submits task"| node_cli
  node_mcp_host -->|"calls tool"| node_mcp
  node_cli -->|"runs task"| node_task
  node_mcp -->|"delegates task"| node_task
  node_task -->|"connects browser"| node_connection
  node_task -->|"opens session"| node_session
  node_task -->|"runs agent"| node_agent_loop
  node_connection -->|"connects CDP"| node_chrome
  node_session -->|"sends commands"| node_chrome
  node_session -->|"evaluates snapshot"| node_snapshot
  node_session -->|"returns observation"| node_agent_loop
  node_agent_loop -->|"observes and acts"| node_session
  node_agent_loop -->|"requests choice"| node_decision
  node_decision -->|"builds choices"| node_action_space
  node_decision -->|"posts decision"| node_decision_api
  node_decision_api -->|"returns choice"| node_decision
  node_agent_loop -->|"requests value"| node_field_text
  node_field_text -->|"posts field context"| node_text_api
  node_text_api -->|"returns value"| node_field_text
  node_field_text -->|"returns text"| node_agent_loop
  node_agent_loop -->|"writes run data"| node_records
  node_agent_loop -->|"returns outcome"| node_task
  node_task -->|"returns result"| node_cli
  node_task -->|"returns result"| node_mcp

  click node_cli "https://github.com/tulipe1735/prism/blob/main/src/cli.ts"
  click node_mcp "https://github.com/tulipe1735/prism/blob/main/src/mcp.ts"
  click node_task "https://github.com/tulipe1735/prism/blob/main/src/task.ts"
  click node_agent_loop "https://github.com/tulipe1735/prism/blob/main/src/agent.ts"
  click node_action_space "https://github.com/tulipe1735/prism/blob/main/src/action-space.ts"
  click node_decision "https://github.com/tulipe1735/prism/blob/main/src/decision.ts"
  click node_field_text "https://github.com/tulipe1735/prism/blob/main/src/text-helper.ts"
  click node_records "https://github.com/tulipe1735/prism/blob/main/src/agent.ts"
  click node_connection "https://github.com/tulipe1735/prism/blob/main/src/browser/connect.ts"
  click node_session "https://github.com/tulipe1735/prism/blob/main/src/browser/session.ts"
  click node_snapshot "https://github.com/tulipe1735/prism/blob/main/src/browser/snapshot.js"

  classDef toneBlue fill:#dbeafe,stroke:#2563eb,stroke-width:1.5px,color:#172554
  classDef toneAmber fill:#fef3c7,stroke:#d97706,stroke-width:1.5px,color:#78350f
  classDef toneMint fill:#dcfce7,stroke:#16a34a,stroke-width:1.5px,color:#14532d
  classDef toneRose fill:#ffe4e6,stroke:#e11d48,stroke-width:1.5px,color:#881337
  classDef toneIndigo fill:#e0e7ff,stroke:#4f46e5,stroke-width:1.5px,color:#312e81

  class node_cli,node_mcp toneBlue
  class node_task toneAmber
  class node_agent_loop,node_action_space,node_decision,node_field_text,node_records toneMint
  class node_connection,node_session,node_snapshot toneRose
  class node_user,node_mcp_host,node_chrome,node_decision_api,node_text_api toneIndigo

  linkStyle default stroke:#94a3b8,stroke-width:1.2px
```

## 环境要求

- Node.js >= 22.19
- 可通过 CDP 连接的 Chrome
- `TYPESAFE_API_KEY`
- 一个 OpenAI 兼容的 key

## 安装

Prism 未发布到 npm，从源码构建。包管理器使用 pnpm（仓库锁定 9.15.9，执行
`corepack enable` 可自动匹配）：

```bash
git clone https://github.com/Tulipe1735/Prism.git
cd Prism
pnpm install
pnpm build
```

构建产物在 `dist/`，含两个可执行入口：`prism`（CLI）和 `prism-mcp`（MCP
server）。构建后可直接验证：

```bash
node dist/cli.js --help
```

在仓库根目录执行 `pnpm link --global` 可把 `prism` 和 `prism-mcp` 一并安装到 PATH：

```bash
pnpm link --global
prism --help
```

## 连接 Chrome

请以远程调试模式启动 Chrome。Chrome
136+ 默认 profile 不允许开启远程调试，因此使用独立 profile 并在其中登录一次：

```bash
# macOS
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --user-data-dir="$HOME/.prism-chrome"

# Linux
google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.prism-chrome"

# Windows
"%PROGRAMFILES%\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=9222 --user-data-dir="%USERPROFILE%\.prism-chrome"
```

## 作为 MCP server 使用

`prism-mcp` 是一个 stdio MCP server，只暴露一个任务级工具：

| 工具           | 输入                                       | 返回                                                                                |
| -------------- | ------------------------------------------ | ----------------------------------------------------------------------------------- |
| `browser_task` | `url`、`goal`、`max_steps?`、`record_dir?` | `status`、`reason`、`final_url`、`final_title`、`final_text`、`steps`、`elapsed_ms` |

宿主把整个浏览子任务委托出去；observe/decide/act 循环、新鲜度校验和预算都由 Prism 自己负责。每步进度会以 MCP
progress notification 上报；取消请求会中止运行并关闭标签页。

opencode（`opencode.json`）：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "prism": {
      "type": "local",
      "command": ["prism-mcp"]
    }
  }
}
```

`prism-mcp` 需要在 PATH 上（在仓库根目录执行 `pnpm link --global`），或把 `command` 指向
`["node", "/absolute/path/to/prism/dist/mcp.js"]`。其他 MCP 客户端同理。key 和
`PRISM_BROWSER_URL` 从 server 进程的环境变量及其工作目录下的 `.env` 读取。

注意：不要在配置里用 `"environment": { "TYPESAFE_API_KEY": "{env:TYPESAFE_API_KEY}" }`
传未设置的变量——空值会覆盖 `.env` 里的同名 key，导致加载失败。

## Respect

`src/browser/snapshot.js` 来自
[browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast)，以 MIT
License 使用。详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
