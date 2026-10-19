# 首版验收：用真实任务走一遍

结论：产品入口是
**Electron 工作台**（`pnpm build && pnpm workbench:electron`）。打开窗口，把仓库路径填成工作区，新建会话，发送你指定的真实任务。助手在任务中途会流式输出、逐个工具调用；越界写工作区外的文件、以及打开「浏览器动作需审批」后的每个浏览器动作，都会先出一张审批卡片，你逐次允许或拒绝。

`pnpm workbench`
是**开发/测试辅助入口**，不是交付形态：它把同一份 UI 跑在普通浏览器里，便于快速自测与排查；验收以 Electron 窗口为准。

本文是用户指定真实任务时的操作步骤。自动化证据见
`tests/kernel/end-to-end.test.ts`（内核 HTTP/SSE 接缝上的五项能力），步骤本身不设自动化。

## 0. 一次性准备

- **内核侧**（WSL 或 Linux）：Node.js ≥22.19 与 pnpm。
  ```bash
  pnpm install
  pnpm build          # 产出 dist/kernel.js、dist/workbench-ui 与 dist/snapshot.js
  ```
- **浏览器引擎**：默认 Chromium。
  ```bash
  npx playwright install chromium            # 默认引擎
  npx playwright install firefox webkit      # 想切换引擎时
  npx playwright install --with-deps webkit  # WebKit 缺系统库时（需要 root）
  ```
- **模型**：可以在工作台设置面板里填端点、模型与密钥（保存后立即生效，密钥只写不回传）；也可以直接写数据目录里的
  `config.json`（默认 `~/.prism/config.json`），重启内核后生效。
  ```json
  {
    "model": {
      "baseUrl": "https://api.deepseek.com/v1",
      "model": "deepseek-chat",
      "apiKey": "<你的 key>"
    }
  }
  ```
  任何 OpenAI 兼容端点都可以；`GET /settings` 只报告密钥是否已设置，不回传明文。
- **MCP（可选）**：在数据目录写 `mcp.json`，格式见
  [MCP 客户端](mcp.md)。不写文件就是 0 个服务器；启动失败的服务器会在内核 stderr 上留一行原因，其他工具照常工作。
- **数据目录**：默认 `~/.prism`（会话、配置、浏览器回执）。用 `--data-dir`
  可以改到别处，便于分开试跑与正式数据。

## 1. 启动工作台

| 方式                 | 命令                                               | 定位                                                  |
| -------------------- | -------------------------------------------------- | ----------------------------------------------------- |
| **Electron 工作台**  | `pnpm build && pnpm workbench:electron`            | **产品入口**：与 Windows 使用环境一致                 |
| 浏览器 UI（辅助）    | `pnpm build && pnpm workbench`                     | 开发/测试辅助：同一份 UI 跑在普通浏览器，自己拉起内核 |
| 对着已有内核（辅助） | `pnpm workbench --kernel http://127.0.0.1:41234`   | 内核已单独启动，或要观察内核 stderr                   |
| 仅内核               | `node dist/kernel.js --port 0 --data-dir ~/.prism` | headless 调用与接口自测                               |

Electron 窗口内嵌同一份本地 Web UI；`pnpm workbench` 只替换承载方式，不改变行为。

Windows 上 Electron 经 `wsl.exe` 启动 WSL 里的内核，路径无法推导，必须先给出：

```bash
PRISM_KERNEL_ENTRY=/home/you/prism/dist/kernel.js   # WSL 内的内核入口
```

辅助入口 `pnpm workbench` 会打印一行 JSON（`url` 是 UI 地址，`kernelUrl`
是内核地址）；UI 顶栏显示内核连接状态、版本与数据目录。退出工作台时内核一起干净关闭。

## 2. 工作区与会话

1. 在**工作区**输入框填目标仓库的绝对路径（WSL 内路径，例如
   `/home/you/project`），点「使用」。
2. 在该工作区下**新建会话**；会话列表按工作区分组，可重命名、删除、搜索。
3. 输入真实任务并发送。助手文本流式出现，每个工具调用显示名称、参数与结果；写文件的调用带内核生成的真实 diff，产物面板按路径归并本次会话碰过的文件。
4. 需要整理上下文时，点会话标题旁的「压缩上下文」：较早的上下文换成一条摘要，原始条目保留；运行中的任务结束后才能压缩。

## 3. 权限档与审批

三档范围在设置面板里随时可切，立即生效（同一任务的下一次工具调用就按新档位判定）：

| 档位               | 文件写                         | 命令 | 浏览器动作               |
| ------------------ | ------------------------------ | ---- | ------------------------ |
| 只读               | 直接拒绝，不发审批             | 拒绝 | 允许（受下面的开关约束） |
| 工作区可写（默认） | 工作区内允许，工作区外逐次审批 | 允许 | 同上                     |
| 完全访问           | 全部允许                       | 允许 | 同上                     |

- 越界写工作区外文件时，聊天里出现审批卡片：工具、理由、目标路径、影响说明；按钮只有「允许一次」与「拒绝」。**一次授权只对本次调用生效**，下一次同样的越界会再问一次。
- 拒绝后动作从未发生，模型收到一条说明，并要求换做法或如实汇报而不是重试。
- 只读档是硬上限：它直接拒绝，不提供「请求放宽」的入口；要写文件就由你切换档位。

## 4. 浏览器动作的审批开关

- 默认自动执行。设置面板里的「浏览器动作审批」开关打开后，**每个**浏览器动作（打开页面、点击、填写、选择、滚动、等待）都先出一次审批卡片；观察、读取回执不受影响。
- 等价接口：`PUT /settings`，请求体
  `{ "browser": { "actionsNeedApproval": true } }`；开关与档位正交，完全访问档下同样逐个审批。
- 浏览器标签页由内核管理、headless 运行，不抢你的焦点；要复用登录态时，先自己启动 Chrome/Edge：

  ```bash
  google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.prism-chrome"
  ```

  然后在 `config.json` 里给 `browser.endpoint` 填
  `http://127.0.0.1:9222`（仅 Chromium）。内核只关闭自己的标签页并断开，不关闭你的浏览器。

## 5. 逐项验收证据

| 能力       | 怎么试                                                                             | 看什么                                                                                                                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 浏览器     | 让助手「打开 <某页面>，观察后点/填 <某控件>，报告结果」                            | 工具卡片依次出现 `browser_open` → `browser_observe` → `browser_act`；动作后的观察里能看到页面新状态；卡片里的 receipt 为 `executed`，且明确写着「不验证任务是否完成」                                                            |
| 联网检索   | 让助手「查一下 <当前信息> 并给出来源链接」                                         | `web_search` 返回标题、链接与摘要；需要正文时继续 `web_fetch`；抓取私网地址（如 `http://127.0.0.1/`）直接报错拒绝                                                                                                                |
| MCP        | 在 `mcp.json` 配一个服务器并重启内核，让助手「用 <工具> 做 <事>」                  | 工具卡片里出现 `mcp__<服务器>__<工具名>`，参数与结果来自该服务器；未配置时模型看不到任何 MCP 工具                                                                                                                                |
| skills     | 让助手「按技能 <名字> 的方式做」                                                   | `skill` 工具列出可用技能；预置 `prism` 开箱可见，正文按需读取；项目级 `<工作区>/.agents/skills` 优先于全局                                                                                                                       |
| 跨会话记忆 | 长任务让它先做一半，再在原会话里追问「继续」；换一个会话问「这个仓库的约定是什么」 | 会话日志可继续/恢复；长会话接近上限时自动压缩（界面出现压缩提示），原始记录仍在日志里；`AGENTS.md`（全局、逐级、子目录）无需重复交代就生效。新会话不自动继承旧会话内容——跨会话延续靠继续会话、压缩摘要与 `AGENTS.md`（ADR-0004） |

会话日志在
`<数据目录>/sessions/<工作区目录名>-<哈希>/<会话 id>.jsonl`，压缩只追加一条摘要条目，原始条目一条不删。

## 6. 不想开界面时（可选）

内核 headless 也能跑完整流程，接口见[内核接口契约](kernel-contract.md)：

```bash
node dist/kernel.js --port 41234 --data-dir /tmp/prism-acceptance
curl -s http://127.0.0.1:41234/settings
curl -s -X POST http://127.0.0.1:41234/sessions \
  -H 'content-type: application/json' \
  -d '{"workspace":"/home/you/project"}'
curl -s -X POST http://127.0.0.1:41234/sessions/<id>/messages \
  -H 'content-type: application/json' -d '{"text":"跑一遍测试并修复失败"}'
curl -sN http://127.0.0.1:41234/events        # 事件流；审批请求也在这里
```

审批应答：`POST /sessions/<id>/approvals/<requestId>`，请求体
`{ "approved": true }`；每个请求只能答一次。

## 7. 故障排查

| 现象                                                | 原因与做法                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------ |
| 内核起不来，stderr 提示找不到浏览器页面脚本         | `pnpm build` 未跑或产物过旧：脚本由构建复制到内核包旁边                        |
| `browser_open` 报「browser build is not installed」 | 按提示 `npx playwright install <engine>`                                       |
| WebKit 报缺系统库                                   | `npx playwright install --with-deps webkit`（需要 root）                       |
| 模型请求失败、任务里出现 system 说明                | 检查 `config.json` 的端点与密钥；内核不自动重试，失败即如实汇报                |
| MCP 工具看不到                                      | 内核 stderr 里的 `MCP server "…" is unavailable: …`；配置文件缺省即 0 个服务器 |
| 抓取网页被拒绝                                      | `web_fetch` 只访问公网地址；内网、环回、保留地址在任何档位下都拒绝             |
