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

Pi 官方不做 MCP，集成 Pi 需要一个很小的 extension 去调用 `prism` CLI；该适配器尚未实现。

## 一次运行的过程

1. **观察。** 注入的 DOM reader 生成一张带编号的可见控件表（`[1] button 保存`、
   `[2] textbox 邮箱`……），以及可见文本、页面指纹和每个元素的新鲜度 guard。
2. **决策。** 一次 TypeSafe SystemOne 请求同时回答操作问题（`CLICK`、`TYPE_TEXT`、
   `SELECT`、`SCROLL_UP`、`SCROLL_DOWN`、`WAIT`、`DONE`、`BLOCKED`）和对应的目标问题。响应必须是对候选 id 的有限概率分布，且选中的 id 必须是最大值；否则不执行任何动作。
3. **执行。**
   选中的编号会解析回观察时的真实 DOM 节点。输入前 Prism 会重新检查连接性、可见性、遮挡和 disabled/read-only 状态。永远不会使用模型生成的 selector 或坐标。
4. **判定。** `DONE`
   需要可见证据；随后 Prism 让 judge 模型判断目标是否满足（可选附带最终截图）。不满足时以非零码
   `UNVERIFIED` 退出。

预算是硬性的：`--max-steps`
次动作、两倍的决策调用、同一时刻只有一个动作在执行。连续三次动作页面没有变化会以
`BLOCKED` 结束。

## 录制

默认不写任何文件。`--record <dir>`
会为每次观察写一张 JPEG（以耗时毫秒命名）、每条执行动作写一行 `steps.jsonl`，以及一份
`final.json`。截图是尽力而为的：后台标签页可能限制渲染，因此某张截图可能被跳过，但步骤日志始终完整。

## 退出码

| 码  | 含义                            |
| --- | ------------------------------- |
| `0` | 目标完成且 judge 验证通过       |
| `1` | blocked、unverified、失败或中断 |
| `2` | 配置或浏览器连接错误            |

## 安全

Prism 对任何站点都可用，没有白名单，也不逐步审批；它使用所连接 Chrome
profile 的会话。页面内容被视为不可信数据而非指令，但 agent 仍能读取你的 profile 能读到的内容，并以你的身份提交表单。请使用独立 Chrome
profile，避免让它接触你不想被访问的账号或数据。输入的值会打印到终端，并包含在 `--record`
的输出中。

## 开发

```bash
pnpm typecheck
pnpm lint
pnpm test        # 单元测试；不需要 Chrome 或 API key
pnpm build
```

浏览器集成测试需要 Chrome 在 9222 端口：

```bash
PRISM_IT_CHROME=1 PRISM_IT_BROWSER_URL=http://127.0.0.1:9222 \
  pnpm vitest run tests/regression.integration.test.ts
```

它用脚本化决策驱动 `fixtures/regression/index.html`，不需要模型 key。

## 限制

继承自上游 snapshot reader：shadow
root、iframe、canvas、文件上传、弹窗新标签、嵌套滚动、任意键盘控件均不在范围内。DOM
reader 覆盖常见 HTML 与 ARIA 控件，而非完整的 accessible-name 规范。

## 致谢

`src/browser/snapshot.js` 来自
[browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast)，以 MIT
License 使用。详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
