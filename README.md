# Prism

Prism 是一个 TypeScript 浏览器智能体 CLI。给它一个网址和一句目标，它会把页面读成一张带编号的可见控件表，让决策模型选择「对哪个元素执行哪个操作」，通过 Chrome
DevTools Protocol 执行，最后让独立的模型 judge 判定目标是否达成。

动作循环是 [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast)
的 TypeScript 移植：动态动作空间、用结构化 DOM 观察替代截图点击、模型输出永远不会变成 selector、坐标或 JavaScript。它既能独立运行，也能以
`prism-mcp`（任务级 MCP server）的形式接入。

## 环境要求

- Node.js >= 22.19
- 可通过 CDP 连接的 Chrome
- `TYPESAFE_API_KEY`（任务决策）
- 一个 OpenAI 兼容的 key（字段文本与 judge）

## 安装

```bash
pnpm install
pnpm build
node dist/cli.js --help
```

在仓库根目录执行 `pnpm link --global` 可把 `prism` 安装到 PATH。

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

Prism 会打开自己的后台标签页，并在运行结束时关闭；不会激活或关闭你的其他标签页。

## 使用

```bash
prism "https://en.wikipedia.org/wiki/Main_Page" \
  "打开关于哥德尔不完备定理的条目。"

prism "https://www.google.com/travel/flights" \
  "查找 2026 年 9 月 20 日苏黎世到伦敦的单程经济舱航班，一位成人。" \
  --max-steps 40
```

### 选项

| 选项                  | 含义                                     |
| --------------------- | ---------------------------------------- |
| `--max-steps <n>`     | 动作预算（默认 60）                      |
| `--step`              | 每步暂停，按回车确认执行                 |
| `--record <dir>`      | 写入截图、`steps.jsonl` 和 `final.json`  |
| `--json`              | 每行输出一个 JSON 事件                   |
| `--browser-url <url>` | CDP 端点（默认 `http://127.0.0.1:9222`） |
| `-h`, `--help`        | 显示帮助                                 |
| `-v`, `--version`     | 显示版本                                 |

### 环境变量

| 变量                   | 含义                                               |
| ---------------------- | -------------------------------------------------- |
| `TYPESAFE_API_KEY`     | TypeSafe 决策模型 key（必填）                      |
| `TYPESAFE_MODEL`       | TypeSafe 模型 id（默认 `jev-latest`）              |
| `TEXT_MODEL_API_KEY`   | 字段文本与 judge 使用的 OpenAI 兼容 key            |
| `TEXT_MODEL_BASE_URL`  | 字段文本端点（默认 `https://api.deepseek.com/v1`） |
| `TEXT_MODEL`           | 字段文本模型（默认 `deepseek-chat`）               |
| `TEXT_MODEL_REASONING` | 设为 `none` 可关闭 reasoning 参数                  |
| `PRISM_JUDGE_API_KEY`  | judge 的 key（默认取 `TEXT_MODEL_API_KEY`）        |
| `PRISM_JUDGE_BASE_URL` | judge 端点（默认取 `TEXT_MODEL_BASE_URL`）         |
| `PRISM_JUDGE_MODEL`    | judge 模型（默认取 `TEXT_MODEL`）                  |
| `PRISM_JUDGE_VISION`   | 设为 `1` 时把最终截图一并交给 judge                |

工作目录下的 `.env` 会被自动加载。

### 使用 OpenCode Go

OpenCode
Go 的大多数模型提供 OpenAI 兼容接口。把文本模型指向它并选一个 chat 模型即可；Prism 每次运行都会发送它要求的
`x-opencode-session` 头。

```bash
TEXT_MODEL_API_KEY=...
TEXT_MODEL_BASE_URL=https://opencode.ai/zen/go/v1
TEXT_MODEL=glm-5.3-flash
```

## 作为 MCP server 使用

`prism-mcp` 是一个 stdio MCP server，只暴露一个任务级工具：

| 工具           | 输入                                       | 返回                                                                                            |
| -------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `browser_task` | `url`、`goal`、`max_steps?`、`record_dir?` | `status`、`reason`、`final_url`、`final_title`、`final_text`、`steps`、`elapsed_ms`、judge 字段 |

宿主把整个浏览子任务委托出去；observe/decide/act 循环、新鲜度校验、预算和判定都由 Prism 自己负责。每步进度会以 MCP
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
