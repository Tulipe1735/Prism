# Browser-agent interface mechanism：thesis 纳入评估

日期：2026-10-04。性质：研究方向评估，不启动产品重构，不改变冻结协议，不执行模型实验。

## 结论

可以纳入，建议作为研究框架。研究内容限定为两个机制：**观察中的关系绑定**，以及**动作执行前对观察依据的校验**。关系绑定保留为主要干预；动态关系变化保留为边界分析。命令发现、帮助文本、stdin、CLI vs MCP、主动上下文策略和恢复反馈的因果效果不同时升级为主贡献。

目前足以定位为 mechanism-oriented empirical study，尚不足以声称已有完整的 interface mechanism 因果证据。这里的 mechanism 指受控改变接口信息或执行规则引起可测行为差异，不意味着解释了模型内部推理或注意力过程。

## 相关工作对定位的约束

以下主要来源于 2026-10-04 核查。AgentOccam 检查了论文 HTML 的问题形式与设计部分；SWE-agent 与 AOI 在本轮核查了摘要；BrowserGym 检查了官方 action-space 文档。这不是完整的新颖性排查，不能根据摘要未提及某机制就断言该机制不存在。

| 来源 | 已有内容 | 对 Prism 的限制 |
|---|---|---|
| [SWE-agent](https://arxiv.org/abs/2405.15793)，2024 | 研究专门的 agent-computer interface 如何影响 agent 行为与表现 | agent-facing interface 作为科研对象不是新概念 |
| [AgentOccam](https://arxiv.org/html/2410.13825v1)，2024 | 通过规则映射调整观察与动作；涉及页面压缩、层级上下文和历史选择 | “优化观察/动作空间”或“保留 DOM 关系”不足以独立主张新颖性 |
| [BrowserGym 官方动作空间](https://browsergym.readthedocs.io/latest/core/action_space.html) | 提供元素 ID、坐标和其他浏览器动作原语 | 编号引用与统一动作接口不能作为原创贡献 |
| [Agent-Computer Observation Interfaces Enable Dynamic Computer Use](https://arxiv.org/abs/2606.29472)，2026-06-28 | 提出动态观察接口，摘要介绍关键帧、音频、持续文本及组件消融 | 动态观察与接口组件敏感性已被研究；需要核查其全文与 Prism 的实际差异 |

合理的差异化目标是一个更窄的干预问题：在相同词汇与候选条件下，显式 candidate–group binding 是否改变 relation-dependent grounding；以及节点级检查何时无法发现已展示 binding 的变化。不能先把这个目标写成“首次”。

## Interface 到底指什么

在本文中，它是 agent 与浏览器之间的信息与操作边界，包含观察字段、目标引用、动作参数、执行前检查和回执。CLI 是其产品入口；运输协议不是本论文的主要独立变量。

一个动作引用应能追溯到具体 session、document 和 observation；公开关系信息应能追溯到对应候选；执行与未执行需要明确区分。这些是工程契约。只有将某个契约规则单独操纵、固定其他因素并测量变化，才能研究它的效果。

## 机制与现有证据

| 项目 | 因果路径或不变量 | 当前证据 | 本文定位 |
|---|---|---|---|
| 关系绑定 | candidate–group 对应信息 → 模型选择 → 首次 grounding | 旧 Structural–Local 有受控 bundled 效果；Bound–Unbound 原子干预尚无真实模型结果 | 主要机制假设 |
| 观察与引用一致性 | agent 看到的候选引用，应映射到该观察中的目标 | actionSpace 与脚本化运行验证可检查映射；尚无独立机制效果实验 | 方法不变量，不单列科研贡献 |
| 关系证据失效 | 观察后的 binding 变化 → 原选择可能失去依据 → guard 接受/拒绝 → 当前目标正确性 | 一个独立页面反例：关系改变，节点级 freshness 仍接受；没有执行点击 | 边界假设 |
| 失效反馈 | 反馈内容 → 外部 agent 的重新观察/决策 → 恢复结果 | 没有 generic error vs structured feedback 的受控模型对比 | 工程能力；因果收益暂不主张 |
| 命令可发现性、JSON、stdin | 调用方式与命令使用错误 | 尚无受控行为实验 | 产品要求 |

动态反例见 [记录](/home/tulipe/projects/prism/work/cli-direction-2026-10-04/semantic-freshness-diagnostic.json)；对应当前校验见 [BrowserSession.fresh](/home/tulipe/projects/prism/src/browser/session.ts:121) 与 [comparableGuard](/home/tulipe/projects/prism/src/browser/session.ts:299)。旧实验核查见 [研究审计](/home/tulipe/projects/prism/docs/research/research-audit-2026-10-04.md)。

## 统一主线

同一个 target reference 在观察时关联某些公开关系信息，在执行时指向浏览器中的实际节点。论文研究这条链上的两种问题：

1. 观察没有表达需要的绑定，agent 无法可靠辨识目标。
2. 观察表达了绑定，但该绑定后来改变；节点校验仍可能通过。

这给固定关系表示与动态边界一个共同问题，而不是把两个独立 feature 拼在一起。它不等于界面能判断 agent 实际用了哪些证据，也不等于关系 guard 能保证全部任务意图。

## 必须保留的一个边界

**binding changed 与 decision invalidated 不相同。** 例如同一个 Item 7 从 Alpha 变为 Beta：

- goal 为“点击 Alpha 中的条目”时，原选择可能已经错误。
- goal 为“点击 Item 7”时，原选择仍可能正确。

因此，不能以“检出所有关系变化”作为可靠 grounding 的替代指标。校验规则可能同时降低错误执行并增加合法动作拒绝。先检验已经展示的固定关系字段；不要未经证据就声称目标无关提取器知道最小任务依赖，或要求构建新的 goal-aware 推理系统。

节点、关系与可操作性也各有范围：关系 guard 不能修复观察遗漏的控件、页面未准备、有效格式下的错误选择或不正确的 DONE。CDP 输入之前的检查还存在竞态，不能承诺原子语义提交。

## 最少证据补丁

### 1. 固定绑定干预

完成已有冻结的 [relation-ablation-v1 协议](/home/tulipe/projects/prism/evals/cohorts/relation-ablation-v1.protocol.md)。48 tasks × four arms × two models，共 384 cells。主对比为 group goals 的 Bound–Unbound；使用同状态配对与页面聚合，local goals 检查条件性。

它加强的是“显式绑定改变 grounding”，不证明 CLI 的传输优势，也不直接证明外部 coding agent 的行为。实际词汇、引用语法与 payload 一致性要保留审计；相同字节不保证相同 tokenizer 成本。

### 2. 动态边界诊断

在多个不同 DOM 上，先用固定策略验证工具。状态条件至少有：无变化、无关文本变化、公开 group-binding 变化、节点替换/失效；每个状态保留 entity goal 与 group goal。比较当前节点 guard、完整 scope guard、固定关系字段 guard。

记录 binding 变化、旧选择在当前 goal 下是否仍正确、guard 拒绝、实际错误执行与合法动作拒绝。binding 与目标正确性的真值由独立任务定义/已知映射记录提供，不复用待测 extractor 作为自身正确性 oracle。

这首先是受控边界与工具证据，不是模型泛化结果。若要宣称结构化反馈改善恢复，必须再比较同一 guard 下不同反馈；否则将恢复列为实现行为。若动态证据只有一个造例，保留它为 failure case，不放进主要效果 thesis。

### 3. CLI 迁移核查

用一个外部调用者验证观察字段、引用解析、执行与回执完整链路。第一阶段可用固定控制脚本，不需要模型额度；模型额度到位后再做小范围外部 agent 迁移。该检查确认机制通过 CLI 实现仍成立，不新增完整 transport benchmark。

历史结果和新 CLI 结果分开报告。对齐表示、候选和执行器，也仍需披露新 host 的 prompt、history、动作格式及 termination 差异。没有匹配这些因素，就不能把 host 更换后的成功率变化归因于接口机制。

## Thesis 分级

推荐现在采用研究目标句：

> We investigate how relational information and observation-bound action validation shape grounding in browser-agent interfaces, using a browser CLI to isolate relation visibility and changes before execution.

若固定消融成立，且动态边界在多个条件下复现，可使用结果句：

> We show that, in controlled browser interaction tasks, explicit target–group bindings improve relation-dependent grounding, while node-level freshness checks can miss changes to the relational evidence presented to the agent.

后者没有声称新 guard 的性能改善。只有额外比较漏检、误拒绝、实际错误执行与恢复之后，才能写选择性验证的收益。

若固定消融不成立，不能继续声称绑定是收益原因。论文需退回“表示整体的条件性效果与接口失效分析”，或围绕更有证据的失败机制转向。若动态部分不够稳定，保留为边界案例，关系表示主线仍可继续。

## 对论文范围的判断

纳入这一框架与已采用方向相符，不要求新增整套理论、学习型策略或多 agent 平台。真正增加的证据要求是：固定关系消融、对误拒绝敏感的动态边界诊断，以及一次 CLI 迁移核查。

主要贡献候选可以写为“对 browser-agent interface 中关系表达与执行前有效性校验的受控机制分析”。当前仍需补齐证据；CLI 工程实现、研究问题命名、框架图或单个反例不会自动让论文可发表。
