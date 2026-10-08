# 补充证据实验执行报告

日期：2026-10-05。延续浏览器环境契约主线；独立输出目录为
`work/codex-prism-supplement-2026-10-05/`。旧192次模型记录、旧协议、产品源码均未改写。
本轮真实模型请求 **0**；自主 Agent 任务 **0**。不能将下面的零模型动作或 mock 称为自主接入成功。

## 结论

已新增13个完整评分的零模型条件格：7个观察/执行/oracle/拒绝检查，6个独立来源的关系资格格。
两项稳定任务的 oracle 标定及固定禁用调度通过；真实 Codex host 尚未通过网络部署门槛。
请求硬计数器和隔离 host 的本地失败路径通过预检。

新增页面证据进一步收窄了关系贡献：W3C 地址示例需要“控件属于哪一组”的信息，
但当前 local context 已表达这层关联。不能将它用作“仅移除 relations 字段”的有效信息消融。
jQuery UI 的横向/纵向 Rental Car 区分没有暴露到当前目标观察，保留为不支持条件。

这些结果补强接口边界与资格审计。它们仍不足以证明外部 Agent 自主使用，或构成独立的新颖性证据。

## 1. 本轮计划、源码与执行方式

沿用 `codex-h1-v2-protocol.md` 的两个稳定目标及一个观察后禁用条件。
先做零模型准备，所有条件和方法在各 block 调用前保存 plan.json / freeze.json。
准备失败后只在新目录运行新的方法版本；失败记录和原源码保留，未自动重试模型或动作。
本报告、analysis.json 是事后分析；本地源码冻结不是外部预注册。

研究代码：

- `codex-supplement.ts`：独立部署、自动记录原样 CLI 回复、原生事件、固定扰动。
- `codex-host.py`：Codex standalone command/exec bridge 与本地 mock；真实调用有单独开关。
- `prism-host-entry.py`：CLI 字节透传，在交付观察前同步通知私有 fixture；不选择 ref/evidence。
- `request-gate.py`：单一 Responses 模型入口，转发前计数，六次后拒绝，零转发重试。
- `independent-relation-check.ts`：两项来源任务的关系资格与正确/错误/未执行标定。
- `analyze-supplement.py`：保留所有准备失败，按原始事件复算结果。

Prism 0.1.6、Node v22.23.2、Codex CLI 0.160.0；浏览器版本和二进制/构建哈希见各 freeze。
研究构建包加入 CommonJS require 入口以打包已有依赖，产品源代码没有变化。
build 与 build-v2 都保留。编译器 tsup 8.5.1，未安装新依赖。

## 2. 零模型机制结果

原始结果：`mechanism-precheck/records.jsonl`。研究者预设命令直接执行 Prism；不是 Codex。

| 条件 | observation / offered | execution / receipt | native goal |
|---|---|---|---|
| MDN message 正确输入 | 正确 fill 控件 offered | 正确输入，INPUT_ACKNOWLEDGED | true |
| MDN message 错误控件 | from 控件也 offered | 错误输入也 ACK | false |
| MDN message 未执行 | 有观察，无 act | 无输入、无 act receipt | false |
| Dropdown 正确选项 | Option 2 offered | 实际值2，ACK | true |
| Dropdown 错误选项 | Option 1 offered | 实际值1，也 ACK | false |
| Dropdown 未执行 | 有观察，无 act | 无输入、无 act receipt | false |
| message 观察后禁用 | 原样旧观察仍 offered | TARGET_CHANGED / not_executed；无输入 | false |

正确/错误/未执行 oracle 在两个任务上各可区分；这不等于总体成功率。
disabled 在第一次观察采集完成后、CLI 回复交付调用器前设置；记录原始回复 hash、
具体 observation、实际 disabled 状态、同步返回顺序。它是固定 fixture 调度，非产品事务保证。
这只验证环境的拒绝与回执，尚未验证 Codex 是否能解释拒绝或避免虚报完成。

错误控件/选项是有意的标定输入，不能报告成 Agent 错误。它们直接表明：环境 ACK 不校验意图。
Dropdown 的两个 selector 指向同一 select 元素；正确/错误必须按实际选项值区分，
不能依据事件中的 correct/wrong 布尔值计数。分析已明确处理这一点。

没有真实 Agent decision、没有模型弃权样本、没有合法动作误拒绝样本；这些不是零值性能估计。

## 3. 独立任务、语义签名与资格

原始结果：`independent-relation-check-v3/records.jsonl`。任务在 plan.json 中先锁定。

| task | 来源与语义目标 | 公共关联 | oracle 标定 | 资格判定 |
|---|---|---|---|---|
| h71-postal-address | W3C H71 Example 3：填写 Postal Address 的 Address，保持 Residential Address 为空 | 同名 Address 需要组区分；local 与 relations 均给出组名称 | 正确true，错误false，未执行false | 语义关系候选可用；explicit-relations-only 消融不合格，local 有泄漏 |
| jquery-vertical-book | jQuery UI controlgroup/default：点击纵向组 Book Now! | 两个按钮同名；两个 fieldset 同为 Rental Car，观察未区分横向与纵向 | 正确true，错误false，未执行false | 当前关联资格不支持；正确点击由私有 selector 指定，不能证明 grounding |

W3C 来源原始 HTML 已下载并保存出处/hash。只将官方 Example 3 的 HTML 片段原样放入
最小页面外壳，没有改动片段。这是标准示例的重放，不是完整独立网站或生产应用。
jQuery UI 是旧档案中的独立上游 demo，属于来源复用；不能计为新增来源家族。
Book Now! 的目标仅是点击正确控件，没有预订业务完成判据，不能扩张为完成租车任务。

本轮评分共4个语义目标：message、dropdown、Postal Address、vertical Book Now。
前两个是上一轮候选的再次资格检查；后两个是新增语义目标。
13个条件格、临时 URL、UUID、host 目录均不增加独立目标数。
W3C 两个 Address candidate 的关系不等于两个任务；相同任务的三种输入也不增加任务数。

对于当前 M1 的严格消融设计，仍为 **0 个满足“移除显式关联后其它公开字段不泄漏组对应”
条件的合格任务**。现在不能启动四任务×三臂×两模型的24请求机制实验。
如改用删除所有公开关联的投影实验，需另写协议，明确操纵 local 与 relations，
不能事后把它描述为原始 CLI 的 relations 字段独立收益。

## 4. Codex 接入预检与真实状态

实际使用 Linux 原生 Codex 0.160.0，未更换成研究者最小调用器来冒充 host。
部署目录位于独立 `/tmp/prism-host-*`，放原样 Skill、冻结 CLI 包与透明回复记录入口。
未继承本研究对话。当前有效配置关闭插件、apps、browser/computer tools、multi-agent、
记忆与 hooks，并关闭模型与流的重试。技能禁用项在本版本须引用实际 SKILL.md 路径；
官方配置描述与本地行为需分别核对。skills/list 最终只显示 Prism enabled。

隔离配置下本地 HTTP500 fixture 收到一次 `/v1/responses` mock POST，33577 bytes；
没有发现本轮检查的已知 oracle/其它技能标记。该 marker 检查不是全面的保密证明。
它验证失败请求不重试，未产生模型回答或浏览器自主行为。

受限 Codex sandbox 不能创建/连接本次 Prism Unix sockets。单一 Unix socket 白名单及
管理网络代理配置未解决当前 Linux 执行路径。公开文档也提示 executor 支持依路径而异。
因此仅有 Skill 发现与接口预检，**未完成可工作的自主浏览器接入**。

拟扩大 Unix socket 权限的修改被自动审批拒绝，理由是所有本地 socket 访问会扩大安全边界，
现有授权只覆盖受限单一 socket。该修改没有执行，也未使用间接方式绕过拒绝。
所有 broker/owned tab 在退出时关闭；崩溃 block 的残留 owned session 已专门关闭并恢复日志。

## 5. 请求计数和真实模型协议

`request-gate-precheck/result.json`：六次本地转发成功，第七次返回429；错误模型与错误入口403，
假上游只收到六次。凭据未加载到预检、未写入工件。
这不是六次真实模型请求，也不证明 host 在所有配置下没有其它推理入口。

可审查的下一轮候选：现有 OpenCode Go Responses 入口、模型 `gpt-6-luna`；
CH1-01 message stable、CH1-02 dropdown stable、CH1-03 message observed-then-disabled。
最多18次真实模型请求，每 episode 最多6次；失败、续轮、压缩、后台推理均计数，
未用额度不转移，无自动重试。候选是根据官方入口资料选定，真实服务兼容性尚未调用验证。

`ready-for-model.json` 目前明确为 blocked：host socket 门槛未过，真实 host 的网络计数门槛未过，
新增预算未确认。funded 模式在这些门槛通过前会退出，不读取模型凭据或发起模型请求。
不能将零模型预检的正确输入搬到自主实验分母中。

## 6. 全部准备失败与统计边界

| block | planned / raw | 结果 |
|---|---|---|
| deployment-precheck | 7 / 7 | 7基础设施错误：研究打包缺少 CommonJS require |
| deployment-precheck-v2 | 7 / 7 | 7基础设施错误：Codex Unix socket 被 sandbox 拒绝 |
| deployment-network-smoke | 1 / 1 | 1基础设施错误：单一 Unix 白名单未解决 |
| mechanism-precheck | 7 / 7 | 7完整评分格，直接 Prism 零模型控制 |
| independent-relation-check | 6 / 6 | 6配置错误：研究 state 路径超出 CLI 本地 socket 长度限制 |
| independent-relation-check-v2 | 6 / 0 | 服务器处理缺失资源时 headers 异常，block 中止；六个格未完成 |
| independent-relation-check-v3 | 6 / 6 | 6完整评分格，含不支持关联条件 |

共40个计划格、34条 raw、21条准备基础设施错误、13条完整评分格；另有6个未完成格。
这不是40个任务，不报告合并成功率。准备失败涉及研究工具/部署，不自动归因于产品或 Agent。
所有失败方法和原始日志保留。之后的版本手动修正研究配置并另冻结，不属于自动重试模型。
资源404也单独保存；没有把页面重放描述为完整原站无错误。

## 7. 复核与论文判断

`analysis.json` 从原始 native events 和 receipt 复算，oracle/回执问题列表为空。
每次执行的原产品文件和研究构建保持冻结哈希；后续改过的研究工具保留原方法版本，
没有无法解释的冻结文件差异。mechanism 工具在新增 funded 启动门槛前的原文按冻结哈希
恢复，provenance 明确标为事后恢复；不声称当前工具文本与旧版本相同。
TypeScript 和 Python 语法检查通过。报告保存后另生成最终工件清单，作为事后封存。

Go：后续两个稳定来源出现无接管的真实 Codex 完整轨迹，禁用条件没有错误输入或虚报完成。
Mixed：正确执行但只引用 ACK、无可见完成依据，收窄完成核验主张。
Stop：部署权限/请求计数不能满足、依赖研究者选择目标或接管，不启动/不宣称自主使用。
Pivot：自然页面中的组关联主要已在 local context 给出，优先研究关联可观察性与校验边界，
不宣称额外 relations 数组普遍提高成功率。

当前候选 thesis 仍是研究方向，不是已证成的完整论文结论。最少仍缺：真实外部 host 的
可核对闭环；若保留关系组织的经验贡献，还缺独立任务上的有效 neutral-unbound 机制复核。
本轮主要改变的是资格判据和主张范围，没有消除新颖性缺口，也不能保证论文录用层级。

## 原始资料

- [W3C H71](https://www.w3.org/WAI/WCAG22/Techniques/html/H71)：Example 3 用两个地址组区分重复字段；保存原始字节与出处。
- [OpenCode Go endpoints](https://opencode.ai/docs/go/)：当前文档列出 gpt-6-luna 的 Responses 入口；这只确认文档声明。
- [Codex configuration reference](https://developers.openai.com/codex/config-reference/)：网络要求与 Unix socket 规则取决于 executor 路径；实际运行失败单独保留。
- [先前推进报告](environment-contract-research-progress-2026-10-05.md)与[H1 v2 协议](../../evals/environment-contract-v1/codex-h1-v2-protocol.md)：主线与前瞻任务设计。
