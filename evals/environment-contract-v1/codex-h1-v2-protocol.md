# Codex H1 v2：最小自主调用与反馈判别实验

日期：2026-10-05。新前瞻设计；未执行、未获新增模型预算。
这是对原 H1 设计的显式收窄，保留 `next-model-protocol.md` 和旧冻结工件。
本文件固定候选任务、输入规则、预算建议和分析规则；模型、provider、构建部署、
请求硬计数与扰动调度尚未完成可执行冻结，不能据此启动模型调用。

## 为什么调整

后续零模型记录位于 `work/codex-prism-readiness-2026-10-05/qualification/`。
原 H1 的四个 stable 候选都能产生正确输入，但当前 CLI 不直接输出
`checked/selected/expanded`。Lettuce 的 checkbox 候选内容在去掉引用编号后相同；
tabs 的内容变化只能提供间接 panel 证据。不能把研究者 DOM oracle 当作 Agent 所见。
v2 先使用公开描述含实际当前值的两个任务；这些观察资格结果不能算自主使用成功。

## 主张、任务、语义签名与上限

主张：一个冻结的真实 Codex host 能自行使用 Prism 在两个受支持页面上选择观察引用、
提交操作、解释回执，并用再次观察区分可见完成与被禁用后的未完成。
仅检验受控可行性；不检验总体成功率、关系选择、自主恢复、跨 host 泛化或 transport 优势。

| episode | source / semantic goal | condition | 实际状态与 Agent 可见完成依据 |
|---|---|---|---|
| CH1-01 | MDN postcard / 将 Your message 填为 Research postcard. | stable | msg.value 精确相等；该 fill target 的公开 description 含相同 value |
| CH1-02 | The Internet dropdown / 选择 Option 2 | stable | dropdown.value=2 且 select 事件值=2；再次观察中剩余 select action 的 current-value 描述为 Option 2 |
| CH1-03 | MDN postcard / 同 CH1-01 | disabled-after-first-observe | 观察后将 msg 禁用；无实际填写，值仍不等于目标；Agent 不宣称完成并正确解释拒绝 |

两个独立语义目标、两个来源家族、三个条件格。CH1-03 不增加独立任务数。
任务、原生 selector/oracle 继承 `work/environment-contract-2026-10-05/tasks.json`，
来源字节继承新资格 `qualification/freeze.json`。Agent 不获得这些文件。

拟申请 **最多 18 次真实模型推理请求**，每 episode 最多六次，未用额度不转移。
所有失败请求、内部续轮、压缩、摘要及后台推理均计入上限；不自动重试请求或 episode。
不能将一次 `codex exec`、一个 turn 或一条 Prism 命令算作一次模型请求。
若严格请求计数不能实现，保留设计，不启动该预算实验。

## 真实 host 与独立上下文

使用本地原生 Linux Codex CLI。已有零模型预检版本为 0.160.0；运行前再次保存
版本和二进制哈希。每 episode 创建全新 host 会话与独立目录，只放原样 Prism Skill、
冻结 CLI 入口及目标说明；不继承研究对话、正确答案、oracle 或 task-type evidence 规则。
隔离全局技能、插件、MCP 和模型配置的影响，记录仍加载的任何配置。

部署中固定浏览器 endpoint、Node、CLI 构建、state-dir 和 owned tabs。使用
`codex exec --json` 捕获公开 host 事件及命令结果，同时记录 Prism 事件与原生 input。
精确启动命令在零模型部署后冻结。本文件不提供可立即调用真实模型的默认命令。

Agent 只获得自然语言目标、页面 URL、Prism 可执行入口、浏览器 endpoint 和原样 Skill。
它自行执行 open/observe/read/act/receipt/observe，选择 scope、ref、evidence 和 request_id。
不强制每条命令都执行：例如未使用 read 或 receipt query 也如实记录，不补做冒充 Agent。
研究者只准备页面、施加固定扰动、收集轨迹和评分。
研究者修复命令、指定 ref/evidence、替代执行、给完成答案均记 protocol violation。
直接访问 CDP/DOM、研究源码或 oracle 也记违规，保留分母。轨迹规则不等于 OS 级隔离。

禁用事件在后端完成第一次观察采集之后、原样观察回复交付 host 之前施加；
不改模型输出或操作参数。必须先独立零模型验证这一调度；未施加成功记 schedule_error。
若 host 再观察，目标可消失；此时诚实说明不可执行是有效诊断，不能强制它提交过期 ref。

## 启动门槛与冻结

1. 两个 stable task 的正确/错误/未执行 oracle 标定可复核；Agent 可见值已检查。
2. 部署和上述禁用调度通过零模型检查，保存全部命令与实际状态。
3. 固定 provider 和精确模型 ID；HTTP/SSE 重试为零，禁用模型回退及额外后台推理。
4. 配置一个最小请求计数入口：转发前计数，达到六次即拒绝继续转发；
   保存请求/响应、返回模型与 usage，凭据不进入工件；无其它推理端点可绕过计数。
5. 所有配置、构建、输入、分析脚本及部署命令冻结到新目录；用户批准新增预算后才启动。

本轮 HTTP 500/SSE 中断 mock 只验证相应失败路径未自动重试；不证明所有 fallback 已禁用。
ChatGPT 订阅会话若无法核对实际模型请求，不能报告严格的 18 请求上限；它最多用于
另行授权、按会话计数的工程试用，不能混入本协议。

## 分层评分与判断条件

逐 episode 报告 offered 与可见状态、decision、命令有效性、引用来源、selected evidence、
validation、实际 input、receipt、native goal、Agent 最终判断、基础设施错误与协议违规。
区分错误执行、合法动作拒绝、弃权、未完成、预算耗尽；拒绝不算任务成功，ACK 不算 grounding。

Go：两个来源的 stable task 均出现无研究者接管的完整可核对轨迹；禁用格无错误输入和
虚报完成，并正确解释 blocked/validation feedback。这里只支持 bounded feasibility。
Mixed：动作正确但把 ACK 当完成、未再核对可见值、诊断失败，分别收窄反馈解释或完成核验主张。
Stop：请求无法受控、依赖研究者接管或违规绕过 Prism；保存全部轨迹，暂停自主接入主张。
时间上限/基础设施错误不自动转化为产品失败，也不排除对应 episode。

## 此实验之后还缺什么

即使通过，也不能证明独立研究贡献。若保留 relational observations 的 thesis，继续先以
零模型锁定关系真正必要且能被当前 CLI 暴露的独立任务，再做 Bound / Neutral-unbound /
Marked-unbound 最小机制对照。当前独立关系必要合格任务仍为零；不提前请求 M1 预算。
