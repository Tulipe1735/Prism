# 下一项模型实验：H1 外部 host 的契约使用与反馈解释

日期：2026-10-05。前瞻设计，尚未执行，尚无模型预算授权。以下任务和
分析规则冻结；provider、精确模型 ID、可执行调用计数器及 host 配置尚未冻结。
因此这是可审查的实验设计，不是已可启动的付费实验。

## 单一主张

一个真实外部 Agent host 能自行使用当前 Prism 契约完成受支持的独立页面操作，
并能区分输入回执、执行前拒绝与可观察任务完成。

本实验不证明自主依赖选择、效率、恢复质量、跨 host 泛化或 CLI 优于 MCP。
先用一个 host；无需同时交叉两个 host、两个模型和多种 transport。

## 任务与调用上限

使用本轮已保存且通过直接状态 oracle 的四个新获取页面任务。
源字节、oracle 和任务签名见 `work/environment-contract-2026-10-05/tasks.json`、
`semantic-signatures.json` 及 `qualification/freeze.json`。

| episode | task | condition | 实际完成判据 |
|---|---|---|---|
| H1-01 | condiment-lettuce | stable | cond1.checked 且输入指向 cond1 |
| H1-02 | composer-tab | stable | tab-3 aria-selected=true 且输入指向该 tab |
| H1-03 | postcard-message | stable | msg.value=Research postcard. 且输入指向 msg |
| H1-04 | dropdown-two | stable | dropdown.value=2 且选择事件值=2 |
| H1-05 | condiment-lettuce | disabled-after-first-observe | 不执行 disabled 控件；不宣称完成；正确解释拒绝 |
| H1-06 | postcard-message | disabled-after-first-observe | 同上 |

六个 episode、四个独立语义目标、三个来源家族；不是六个独立任务。
预算建议上限 **36 次真实模型推理请求**：每个 episode 最多六次。
失败、超时、无效输出、压缩/摘要、host 后台请求均计入对应 episode 的上限。
未用额度不挪给其他 episode。不自动重试 HTTP、流重连或失败 episode。
前四项测 goal completion；后两项测诊断，不将拒绝计为任务成功。

## 部署与独立性

首选已预检的 Linux 原生 Codex CLI（实际版本须再次锁定）；OpenCode 后续独立复现，
不计入本次预算。复制原样 Prism Skill 到独立 host 项目的 `.agents/skills/prism/`。
把当前源码构建为 CLI 包，锁定 Node、CLI、host 二进制哈希、配置和构建产物。
使用专用 state-dir、owned tabs 和本地来源重放；不改全局 host 配置。

host 获得目标、页面 URL、浏览器 endpoint、Prism 启动命令和原样 Skill。
不给目标 selector、oracle、正确 ref、task-type evidence 规则或示范答案。
研究者仅准备页面、收集效果和按冻结时刻施加禁用扰动。
实际命令、ref、evidence、request_id、成功判断均由 host 中 Agent 生成。
研究者替代执行、修改 Agent 命令、修补 JSON、猜 ref 均记 protocol violation，保留分母。
只通过 Prism 使用浏览器；直接 CDP/DOM、读取研究 oracle/source 的行为记违规。
这是任务使用规则及轨迹审计，不宣称 OS 级防作弊隔离。

禁用扰动：观察已在后端采集后、第一次观察回复交付 host 前，研究 fixture
对锁定目标设置 disabled/aria-disabled。回复保持原样。只更改页面状态，不改目标选择。
需先零模型验证这个调度，不成功则记 schedule_error，不把未实际发生的扰动计入效应。
其余浏览器后端、观察字段、参数、校验和回执完全相同。

## 请求上限的启动门槛

Codex 官方配置支持 provider 的 request_max_retries 和 stream_max_retries；本轮
本地 HTTP 500 及 SSE 中断 mock 均各只有一次模型 POST，见 host-preflight。mock 不算模型或自主成功。
真实启动前必须：

1. 选择并锁定 provider/模型，不使用隐式回退、后台标题模型或其他推理组件。
2. 将 HTTP 与流重试设为零；流中断已在本地 mock 验证；进一步锁定 host 内部 fallback 不产生额外推理请求。
3. 使用该 provider 的可审计网关或最小专用请求计数器，严格限制六次/episode；
   记录请求体、响应、返回模型、usage 和失败状态，凭据不进入工件。
4. 禁止计数器之外的模型端点。若无法做到，则该 host 不能用于这个预算实验。
5. 以无模型命令完成部署/调度检查，保存精确命令和最终源码/配置 freeze；
   新增模型预算须由用户明确批准后才能发出第一请求。

上限按真实 HTTP/推理请求计，不能用“一次 host turn”代替。

## 分析

逐 episode 报告：offered/关系暴露、模型 decision、命令有效性、ref 是否来自当前观察、
selected evidence、validation outcome、实际 input、receipt query/replay、goal state、
Agent 最终陈述。基础设施错误、协议违规、错误输入、合法输入拒绝、弃权、预算耗尽和
未完成分别列出。为四个 stable goal 保留正确、错误、无输入 oracle 标定。

不报总体提升或显著性；六条是受控可用性与诊断案例。
同一 goal 的 disabled episode 不扩充独立样本数。保存完整轨迹，不只挑成功案例。

Go：至少两个不同来源家族出现无研究者接管的完整稳定轨迹，且禁用案例没有错误执行
或虚报完成。此门槛只支持 bounded feasibility，不构成总体成功率或泛化证据。
Stop：任何回执掩盖错误输入/未完成、依赖猜 ref/研究者接管或模型请求不能受控，
停止外部自主使用主张，保留失败轨迹后另写新版本协议。
Mixed：稳定任务能完成但诊断失败，收窄为“受支持静态控件可调用”，不能宣称可靠反馈使用。

## 后续机制实验 M1（不与 H1 交叉）

待独立任务资格门槛通过后，比较 Bound / Neutral-unbound / Marked-unbound。
本轮自然关系必要任务 Gecko 的关系未暴露且完整过滤目标失败，故 **0 个已合格任务**。
现在不应请求这项预算，也不以它替换 H1。

拟上限24请求：四个关系必要且独立的任务 × 三个观察臂 × 两个精确模型，一次决策/格，
零自动重试；用研究者最小调用器，明确不是两个真实 Agent host。
先另冻结四个页面、独立目标/oracle、任务语义签名及读前可区分性，至少三个来源家族。
所有准备阶段不合格项保留清单；不能改产品后悄悄重跑原负例。

三臂候选、词汇、目标、顺序、ref、后端、校验和回执相同，只改变显式候选到组的关联。
Neutral-unbound 删除关联边而不加入“??/unknown/missing”等拒绝线索；组词仍以全局清单给出，
无其它泄漏对应关系。Marked-unbound 使用原来的 ?? 标记。Neutral 不能强求字节等长，
不额外填入新含义文本。先检查可识别性、投影字节差异及是否造成格式非法。

若只有 Marked 导致弃权，收窄旧结果为 mask/prompt 诱导；若 Neutral 与 Marked 都失去
可正确 grounding 的依据，而 Bound 有效，才增强“关联边的效应”主张。
若 Bound 也不能 grounding 或因抽取遗漏而失败，停止跨页面关联组织主张。
不把 Neutral 的猜中当作有证据 grounding；分开报告正确 choice、正确引用、实际输入与完成。
24次是最小判别研究，不估计网站总体效果。若要更强统计结论，另冻结更大独立任务集。
