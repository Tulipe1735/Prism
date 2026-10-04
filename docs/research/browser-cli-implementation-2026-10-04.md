# Browser-use CLI for agents：首版实现与研究边界

日期：2026-10-04。方法标识：browser-cli-v1。性质：已实现的接口与无模型调用的契约验证；不是新的模型性能研究。

## 已完成的方向改变

Prism 从 URL+goal 的内部浏览器 agent，改为外部 agent 可以分步调用的浏览器 CLI。外部 agent 拥有 decision、planning、字段文本与 termination；工具拥有 observation、representation、引用校验和执行回执。

这落实了研究对象的改变：**面向 agent 的浏览器工具，其观察与执行契约如何影响关系依赖的 grounding？**
研究对象包含接口提供的信息及其生命周期。CLI 是实现与实验载体；没有证据支持 CLI
transport 优于 MCP，也不把帮助、JSON 或幂等请求本身作为科学创新。

## 实现边界

| 模块                            | 职责                                                           | 明确不承担的判断                  |
| ------------------------------- | -------------------------------------------------------------- | --------------------------------- |
| `src/interfaces/cli.ts`         | 分层帮助、严格参数、stdin、stdout JSON、启动后台与离线回执查询 | 选择目标与内部模型调用            |
| `src/interfaces/daemon.ts`      | 本地 IPC、会话生命周期、关闭时等待正在处理的请求               | agent policy                      |
| `src/cli/protocol.ts`           | 命令与回执 schema                                              | 成功 oracle                       |
| `src/cli/sessions.ts`           | 会话串行化、观察/证据引用、执行前检查、request-id 去重         | goal 语义判断与自动 retarget      |
| `src/cli/receipts.ts`           | 输入前 pending 回执与最终回执的落盘                            | 证明浏览器任务成功                |
| `src/browser/evidence.ts`       | 同一次同步页面读取中采集 snapshot 与可见上下文                 | 读取 fixture oracle               |
| `src/browser/representation.ts` | Local、Structural、有限的 group relations                      | 自动决定 minimal sufficient scope |
| `src/browser/session.ts`        | 已有 CDP 执行器和自建 tab                                      | 对观察与输入提供原子事务          |
| `skills/prism/SKILL.md`         | 外部 agent 的接口使用说明                                      | 已证明跨 agent 集成效果           |

首版的 representations 从已审计的研究提取规则复制为独立产品方法；`evals/runners/representation.ts`
与旧 relation-ablation 的 extractor 没有就地改写。公共分组字段只有可见文本和 scope；不暴露
`data-correct`、goal 或 oracle。控件角色/状态来自原来的浏览器 snapshot。

原生产任务入口、MCP 入口、MCP
SDK 依赖、对应测试及旧 MCP 配置已删除。仍被历史研究 runner 使用的模型循环模块保留在源码中，不进入打包后的 CLI。首版没有新增依赖。

## 契约的具体意义

`observe`
产生新的 observation 和 evidence；每个动作引用包含 observation 标识。只有最新观察可用于新动作。`context`
为某个目标产生新 evidence。`act` 显式声明依据哪个 evidence 执行哪个目标及哪个操作。

检查顺序是：命令合法性 → 观察/目标/evidence 成员资格 → 操作与 value 规则 → 文档与控件 freshness
→ 重读展示的上下文/关系 → 再检查目标 → 保存 pending 回执 → 执行 → 保存最终回执。不同 session 可以并行，同一 session 的操作串行。

关系一致性检查是 goal-blind 的。如果 agent 只取得 Local，就没有绑定未展示的 group
relation；若取得 relations，就会检查它展示的分组文本与 scope。已展示的分组变化不等于当前任务必然失效：entity-based
goal 可能仍然允许点击原对象。这是需要测量的过度拒绝边界，不是已解决的问题。

动作回执分为
`not_executed`、`executed`、`unknown`。wait 的 executed 表示等待完成；其他操作表示输入序列确认，不表示成功 oracle 通过。unknown 不能自动重放；同一 request-id 只返回已保存的结果。最终写入失败也必须保留/报告不确定性。

证据检查与 CDP 输入间仍有竞态窗口。当前实现不能宣称关系在实际执行瞬间一定不变，也不能宣称 exactly-once
browser effects。它防止同一请求再次发送输入，并将丢失确认保守地记为 unknown。

## 已经验证的事实

新增单元测试覆盖：严格参数、目标/evidence 成员资格、操作类型、文档变化、关系变化、只校验所选 scope、重复请求、并发重复请求、执行前 pending 落盘、未知结果不重放、关闭后回执、损坏确认处理，以及包入口符号链接。

真实 Chrome 的 CLI 测试将每条命令作为独立短进程调用。源码入口和打包入口都验证：

- fill、select、click、wait、scroll 操作与页面状态。
- 同一个 click 请求并发发送两次，只产生一次页面点击。
- 重观察后旧 ref 失效；同名按钮替换为新节点后旧目标不能执行。
- 按钮本身保持不变时，已展示的分组标题改变会拒绝输入。
- 目标关系未变而无关 section 的标题变化，不拒绝执行。
- Local 未展示分组关系时，分组变化不会被该证据检查捕获。
- 关闭 session/broker 后，可以离线查询回执；正常关闭仅移除工具自建 tab。

这些是程序行为与机制条件的验证，不是独立任务上的模型统计证据。所有此阶段测试和修改均没有真实模型调用。

测试日志、重构前源码和完整性记录位于本地
`work/browser-cli-v1-2026-10-04/`。最终机器可读检查结果见
`verification.json`。测试浏览器为当前可用的 Chrome/153.0.8010.52；这不是历史实验固定的 .12 浏览器，不能称历史环境完全复现。

## 历史证据的隔离

修改前保存了 `pre-refactor-source.tar.gz` 与 `baseline.json`。旧 raw
JSONL、三份主要研究 archive 及前一阶段 relation
freeze 按修改前 hash 核对；没有改写旧结果、manifest、cohort 或 freeze。

当前工作树含新 CLI、删除的任务/MCP 入口和新 package
lock，不能通过旧源码 inventory。历史 dispatch 的严格检查仍保留，并应拒绝在此工作树启动旧冻结研究。测试中的历史完整性验证改为：先验证冻结 archive 的 hash，再逐个验证 archive 内原方法文件与 archive 外原证据，共 226 个 inventory 条目。这不把新源码冒充旧方法。

未来复现旧研究，要在独立目录恢复 archive 中的源码及原 lock，保留它没有包含的 fixture/外部 source 材料，使用对应固定 Node、Chrome 和 cohort。不要给历史 cohort 追加新 CLI 数据，也不要为了通过检查更新旧 freeze。下一项 CLI 研究需要自己的 method
hash、cohort、任务、agent prompt 与协议。

## 现有结果怎么用

旧 Structural vs Local 结果可以作为观察表示的动机与先导证据，尤其是受控 structural
ambiguity 条件。已有 external
validation 的差异小且不确定，不能用来支持普遍浏览器能力。旧 Adaptive 的 representation
token 降幅也不能套到新 CLI：新接口增加 id、schema、交互及反馈，需要测量完整 agent 输入、调用数和推理使用量。

新的脚本验证表明：“目标引用仍存在”与“它所属的已展示关系仍一致”是不同条件。它支持把关系 freshness 作为研究变量，但没有证明该变量提高端到端成功率。界面的保守拒绝可能换来额外观察、延迟和误拒绝。

现阶段可使用的 thesis 是研究目标，而非结果声明：

> We study how agent-facing browser observation and execution contracts shape
> relation-dependent grounding: which relations are exposed, how they bind to targets,
> and when their validity expires between observation and action.

旧 static 表示发现是主证据。动态关系失效是边界实验。完成新受控研究后，才可以将目标句改为 “We
show that …”，并填入真实效果与边界。

## 接下来只做会改变结论的实验

1. **静态关系绑定，P0。**
   在相同外部 agent、任务和执行行为下比较 Local、token/关系事实匹配的 Unbound 与 Bound。固定字数、候选集合与顺序，避免把关系绑定收益混成信息量收益。使用已准备的独立模板/反平衡任务；若改为实际 CLI
   agent 调用，必须另设新协议和 cohort，不沿用旧冻结的内部 runner。至少两个模型，按 task
   family 聚合 paired
   effects。正结果支持关系绑定；负结果应撤回“绑定而非更多信息”的解释。
2. **观察到执行的关系变化，P0。**
   保持同样的关系表示与 agent 决策，研究 harness 内比较 identity-only 与 evidence-consistency
   gate。生产 CLI 不开放不安全 bypass
   flag。使用同节点、同角色、同名控件；分别扰动 goal-required group
   relation、entity-based
   goal 下仍正确的 relation 和无关文本。主指标是错误执行、拒绝、误拒绝和独立 goal
   oracle；对未尝试执行的样本不能冒充成功。若减少错执行却过度拒绝，应报告 trade-off，而非普遍 robust。
3. **关系匹配的外部任务，P1。**
   只选择有真实分组/行列/label-control 关系的少量独立页面家族，预先锁定任务与 oracle，运行同一 CLI
   agent 协议。若外部效果消失，论文限定受控任务条件，不能继续堆平均分替代机制解释。

现在值得开始写 motivation、接口契约和旧 evidence 的范围。新的 agent 性能结果仍未取得，额度恢复或用户选择新的可用 provider 后再运行；本次没有发生费用。
