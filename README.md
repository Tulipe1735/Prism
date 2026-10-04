# Prism

[English](README.en.md) | 简体中文

Prism 是供外部 agent 使用的 browser-use
CLI。外部 agent 负责规划、选择目标、填写内容和判断任务是否完成；Prism 负责观察浏览器、返回目标上下文、校验动作引用和执行单步输入。

当前首版支持 `click`、`fill`、`select`、`scroll`、`wait`。它不需要模型 API
key，也不会自行调用模型。Node.js 要求 ≥22.19.0。

## 架构

![Prism browser-use CLI for agents 架构](docs/architecture.svg)

外部 agent 负责决策；Prism 提供观察与关系证据，检查引用及证据是否仍有效，再执行输入并保存回执。`executed`
表示输入确认，不表示任务成功。回执查询可以直接读取持久文件，不要求后台进程继续运行。

[可编辑 Excalidraw 源图](docs/architecture.excalidraw)

## 安装

```bash
npm install -g @tulipe1735/prism
```

也可以使用 `pnpm add -g @tulipe1735/prism`。包提供 `prism` 可执行入口。 `prism --help`
显示当前接口。

npm 上的 0.1.4 早于本文描述的接口。要使用本文的命令，先从源码构建。

## 连接 Chrome

先启动带独立用户配置目录的 Chrome，并启用远程调试。例如 Linux：

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.prism-chrome"
```

已经运行的 Chrome 可以用 `--browser-url http://127.0.0.1:9333` 指定。

## 使用

以下命令直接使用 `prism`。从源码构建时改用 `node dist/cli.js`。

```bash
prism session open --url https://example.com --browser-url http://127.0.0.1:9222
prism observe --session <返回的-session> --scope local
prism context --session <session> --observation <observation> --target <ref> --scope relations
prism act --session <session> --observation <observation> --target <ref> --evidence <evidence> --operation click --request-id decision-1
prism receipt --session <session> --request-id decision-1
prism session close --session <session>
prism daemon stop
```

尖括号字段必须替换成上一条输出中的真实值。`act` 的 `evidence` 使用 `observe` 或该目标的
`context` 返回的标识。一个 select 选项对应一个动作引用；复制其 `ref`，使用
`--operation select`，不额外传 value。`fill` 必须传 `--value`，允许空字符串。

## 从源码运行

贡献者需要 Node.js ≥22.19.0 与 pnpm：

```bash
pnpm install
pnpm build
node dist/cli.js --help
```

`pnpm dev` 直接在源码上运行命令，不生成 `dist/`。

## 观察与执行契约

| 范围         | 展示信息                                                          | 用途             |
| ------------ | ----------------------------------------------------------------- | ---------------- |
| `local`      | 角色、名称、当前值和最多 80 字符的局部上下文                      | 局部辨别         |
| `structural` | 容器类型、最多 120 字符的邻近文本及 48 字符的 section/legend 标题 | 较大范围的上下文 |
| `relations`  | Local 加上从可见祖先提取的分组文本与 scope，最多遍历 6 层         | 显式分组关系     |

`relations` 是有限的分组提取规则，不是完整 DOM 图或任意语义关系推理。表示模块在
[src/browser/representation.ts](src/browser/representation.ts)。首版观察以可执行控件为中心，不提供完整正文阅读、截图、跨 frame 或 shadow
DOM 遍历接口。

一次 `observe` 返回新的 observation、evidence 和 target refs；旧观察立即失效。`context`
为同一观察中的单个目标返回新的 evidence，不替 agent 选择目标。每次观察最多保留 32 个证据视图。

执行前分别检查命令、目标成员资格、操作类型、文档、控件状态和所选证据中展示的上下文字段。字段变化会返回失效回执。只有 Local 证据的动作不会校验它未展示的分组关系。校验不接收 goal，也不判断 agent 是否选对目标。

执行成功或结果未知后，需要重新 observe。执行失败不会按标签自动换目标、自动点击或自动重试。读取证据与 CDP 输入不是浏览器事务；页面仍可能在最后一次检查后变化。不能宣称完全消除了观察到执行之间的竞态。

## 输出与回执

除帮助和版本外，每条命令在 stdout 返回一个 JSON 对象。`--json` 可省略。诊断写入 stderr。

```json
{
  "schema_version": 1,
  "ok": true,
  "data": {
    "receipt": { "outcome": "executed", "code": "INPUT_ACKNOWLEDGED" },
    "replayed": false
  }
}
```

上面只展示关键字段，完整回执还包含 session、observation、target、evidence、request_id、时间、阶段和 next_command。

| outcome        | 含义                         | 下一步                          |
| -------------- | ---------------------------- | ------------------------------- |
| `not_executed` | 校验拒绝，未发送输入         | 根据 error 和新观察重新决定     |
| `executed`     | 浏览器确认输入序列           | observe，独立检查任务状态       |
| `unknown`      | 输入可能已发送，确认结果未知 | 查询 receipt 并检查页面，再决定 |

同一 session 内，相同 `request-id`
与完整动作请求只执行一次；重复调用返回保存的回执。更改动作却复用 id 会返回
`REQUEST_ID_CONFLICT`。未知结果也不会重放。输入前先保存 pending/unknown 回执；后台进程中断后仍可离线查询。会话本身不在后台重启后恢复。未找到回执不能证明从未请求过输入。

Exit code：0 表示命令被接受或查询成功；1 表示拒绝或结果未知；2 表示参数错误。查询一份
`unknown` 回执可以 exit 0，因此必须读取 outcome。`executed` 不等于任务成功。

复杂填值可以用 stdin，避免手工拼接 shell 引号：

```bash
prism act --stdin < action.json
```

`action.json` 是完整命令对象：

```json
{
  "command": "act",
  "session": "<真实session>",
  "observation": "<真实observation>",
  "target": "<真实ref>",
  "evidence": "<真实evidence>",
  "operation": "fill",
  "value": "text",
  "request_id": "decision-2"
}
```

## 会话与 agent 接入

后台进程持有 CDP 连接和自建 tab，短命令可以操作同一会话。15 分钟没有命令时，后台关闭它拥有的 tab。`session close`
只关闭自己的 tab；`daemon stop` 等待正在处理的命令，再关闭全部自建 tab。

`--state-dir` 或 `PRISM_STATE_DIR`
指定私有状态目录。默认是系统临时目录中的当前用户目录。Linux 目录必须属于当前用户且权限为 700。所有命令必须使用同一目录。目录保存 socket、事件 JSONL、回执和后台日志；事件包含真实页面文本，可能包含已填写的值。

`PRISM_BROWSER_URL` 可指定默认 Chrome HTTP endpoint。CLI 不读取
`.env`。提供给外部 agent 的使用说明在
[skills/prism/SKILL.md](skills/prism/SKILL.md)，可复制或引用到所用 agent 的 skill 目录；没有自动安装到外部应用。

旧 URL+goal 命令、内置模型任务入口和 `prism-mcp` 已移除。

## 验证与研究

```bash
pnpm typecheck
pnpm test
PRISM_EVAL_CHROME=1 pnpm test -- tests/cli/browser-cli.browser.integration.test.ts
PRISM_EVAL_CHROME=1 PRISM_CLI_TEST_ENTRY=dist/cli.js pnpm test -- tests/cli/browser-cli.browser.integration.test.ts
```

浏览器测试默认使用 `http://127.0.0.1:9333`，可用 `PRISM_IT_BROWSER_URL`
修改。这些测试仅访问本地页面，不调用真实模型。

旧实验保留在
`evals/`。旧模型循环代码只服务于研究 runner，不属于打包后的 CLI。原始结果和冻结 archive 没有改写；当前源码已是新方法，不能当作历史冻结源码。重跑历史 cohort 应先恢复对应 archive、外部材料及固定环境，不能更新旧 freeze 来使当前源码通过。

研究主线是：面向 agent 的浏览器工具，如何通过关系信息的展示及其执行前一致性校验影响 relation-dependent
grounding。现有旧结果支持观察表示的一部分，不能作为新 CLI 或执行契约的效果证明。实现与证据边界见
[重构记录](docs/research/browser-cli-implementation-2026-10-04.md)。
