# Research Audit Report — Prism 的观察与执行契约

日期：2026-10-05，Asia/Shanghai。对象：当前 Prism
0.1.6 源码 CLI，不是已安装 npm 包的远程版本。性质：源码审计、新的受控浏览器实验、两模型一次决策实验及下一阶段规划。

本轮最初约束为零模型调用。用户随后确认额度恢复，并授权 GLM 与 DeepSeek 总计最多 192 次请求、无自动重试。实际完成 192 次请求，未追加调用。先写协议并冻结，再执行；事后发现的统计单位问题另做 derived
audit，没有重写原协议或原始结果。

历史内部 harness 的完整库存、指标、失败和原假设审计见[前一份研究审计](research-audit-2026-10-04.md)。它对应当时源码，不能当成当前 CLI 的能力说明；本报告以新的 CLI 协议和执行记录为准，旧结果仅作限域动机。

## 1. Executive verdict

1. **存在值得推进的研究问题，但当前证据还不足以支撑一般 browser-agent 能力或一篇强泛化论文。**
   研究对象应是关系事实如何进入决策，并成为执行前可检查的依据；CLI 是载体。
2. 新模型实验给出了清晰的条件性结果：两模型在 group goals 上 Bound
   24/24 正确执行、Unbound 24/24 弃权；entity
   goals 上两臂均 24/24 正确执行。缺失绑定影响可作出有依据的选择，而不是本轮产生误点。
3. **同词汇、同字节不等于同语义信息。**
   Bound 提供了 U 缺少的对应事实；不能宣传“完全相同信息仍然更好”。未知标记和允许弃权的 prompt 也是干预解释的重要边界。
4. **192 次请求不是 192 个独立任务。**
   去掉临时 ID/URL 和干预值后只有 18 类语义输入，group/entity 各九类。DOM 多样性验证提取器，不能同时充当模型任务多样性。
5. 分组变化、节点不变时，identity-only 对 group goals 产生 24/24 错误执行；evidence
   consistency 拦住全部。但同一变化在 entity
   goals 下导致后者 24/24 合法动作拒绝。拒绝不算成功。
6. 校验有两种明确漏检：读取后发生的变化，以及被截断字段无法区分的变化。它验证已展示的字段，不保证完整事实或执行瞬间原子一致。
7. 当前 Structural 在四类普通 DOM 中只覆盖两类的分组信息；Relations 覆盖四类。scope 名称不能代替实际字段覆盖检查。
8. 已看过 Relations 再选择 Local
   evidence，能够改变执行校验。24 条独立 follow-up 表明：固定 task-type 规则可避免这次分组交换中的 entity 误拒绝；错误降级也能放行错误 group 动作。没有证据表明自主 Agent 会正确选择依赖。
9. **新颖性需下调。**
   ACI、关系理解、执行前校验、正常更新带来的不必要暂停和残余竞态均已有工作。不能把这些重新命名为新发现。当前差异化候选是精确的 goal-conditioned 契约分析，尚需独立任务验证。
10. 停止增加同一模板的 repeats。下一项有价值的实验是独立语义任务上的关系对照，并控制
    `??` 弃权提示；不是继续刷 100% 或增加一批 scope/模型。

## 2. Reconstructed research model

### 系统改变了什么

| 层                | 当前实现                                                                  | 本轮检验的内容                                     |
| ----------------- | ------------------------------------------------------------------------- | -------------------------------------------------- |
| Observation       | CDP snapshot 和公开上下文在一次同步页面读取中采集                         | 候选是否 offered，字段是否暴露 group/entity        |
| Representation    | Local、Structural、有限 ancestor group Relations                          | DOM 与截断/深度边界；模型实验的关系投影            |
| Grounding         | 外部调用者选择当前 observation 中的 ref                                   | 两模型一次首次选择；引用合法性与实际目标正确性分开 |
| Decision/planning | Prism 不拥有；本轮为一个最小外部模型调用者                                | 没有测试完整 coding agent、规划或工具发现          |
| Validation        | 观察成员资格、operation/value、document、target、所选 evidence 字段一致性 | identity 与 evidence comparison 的单因素对照       |
| Execution         | CDP 输入；输入前 unknown 回执，确认后 final 回执                          | 独立 click event 与 ACK 的一致性                   |
| Recovery          | 提示重新 observe；没有自动 retarget/retry/replan                          | 不宣称新的 recovery 性能收益                       |
| Evaluation        | 工具回执与研究 oracle 相互独立                                            | 不把 ACK、拒绝或没有 wrong input 当任务成功        |

关键代码：`src/browser/evidence.ts`、`src/browser/representation.ts`、`src/cli/sessions.ts`、`src/browser/session.ts`、`src/cli/protocol.ts`、`src/cli/receipts.ts`。`act`
检查提交的 evidence，不检查 Agent 实际在推理中使用了哪些事实，也不接收 goal。收窄 evidence 既提供灵活性，也构成信任边界。

### 真正操纵的变量

| 实验             | 操纵                                                | 固定项                                                    | 没有操纵/测量                             |
| ---------------- | --------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------- |
| O：字段覆盖      | Local/Structural/Relations；普通、深层、长前缀 DOM  | 同页面、候选、状态                                        | 模型理解与认知机制                        |
| E：执行门禁      | 是否使用 live evidence 比较；六种变化；两个 goal    | 相同 Relations、初始正确选择、节点/文档检查、执行器、回执 | Agent 自主选择、自然变化发生率            |
| M：关系绑定      | Bound/Unbound 对应引用；group/entity goal；两个模型 | 公共词汇、候选、格式、字节长度、prompt、单步预算          | CLI vs MCP、Adaptive、planning、DONE      |
| S：所选 evidence | always Relations、always Local、预设 task-type 规则 | 先观察 Relations、初始正确选择、同一 group swap           | 学习型依赖识别、通用 goal-aware validator |

Identity-only 只在研究依赖注入中返回原 evidence；两臂都实际重读，并保留相同其他检查。生产 CLI 没有 bypass
flag。该对照只支持这项明确的门禁机制，不等价于某个外部竞争产品。

### 因变量与单位

模型 primary：all-dispatched first-choice
correctness，弃权/无效输出算未正确选择。Secondary：valid
coverage、弃权、实际正确/错误输入、拒绝、usage。工具 primary：wrong
execution 与 eligible-goal-correct false refusal；diagnostic：receipt code、oracle
attainment、字段暴露、字节。

没有测量完整任务 success、strict agent success、partial
success、DONE 或自主恢复；也没有将其填为 0 或借用旧指标。720 条工具记录由 96 观察、576 主动作、16 截断边界、32
CLI
parity 构成，不是 720 独立任务。M 有 192 个调用记录，但只有 18 类规范化任务语义；重复的 DOM 应视为同一模型语义条件的实现/重复观察。新的 post-hoc 去重分析明确修正了这个 construct，保留原 bootstrap 输出但不以其退化区间作总体推断。

## 3. Evidence map

置信度针对表中明确的范围；不能从存在性证明外推发生率。M 的 causal
treatment 包含关系引用及未知标记语法，不能断言已隔离模型内部的“关系推理模块”。

| Claim                                      | Evidence / replication                                                                                 | 类型与 confidence                                           | 主要反驳 / 最小补证                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| 关系绑定影响 relation-dependent 首次选择   | M 两模型，各 group B24/24、U0/24 且 U 全弃权；去重后每模型九类条件效果相同                             | 受控干预；**Strong（此条件存在性）/Moderate（可推广机制）** | 缺信息当然无法判定；`??` prompt 导致弃权。独立语义任务加 neutral-unbound |
| 不使用 group binding 也能解决 entity goals | M 两模型 B/U entity 各24/24                                                                            | 受控描述；**Strong（该唯一实体条件）**                      | 不是所有 local ambiguity，也不是纯 Local CLI arm；不可扩写               |
| 关系收益取决于 goal 所需事实               | M group +100pp、entity 0；E 同一 mutation 目标正确性不同                                               | goal-condition 对照；**Moderate**                           | 两个很简单 goal classes。新增关系依赖的独立目标                          |
| Structural scope 普遍优于 Local            | 旧内部研究 structural stratum 稳定；新 O 在 ARIA group/table 未暴露 group                              | **Moderate（旧受控子集）/Unsupported（普遍）**              | 新 scope 内容不同、提取范围有限；按覆盖报告，删除普遍排序                |
| 校验关系能减少 stale 错执行                | E pre-read group swap：identity 24 wrong，evidence 0 wrong；四 DOM 家族、三状态                        | 受控工具因果；**Strong（此门禁条件）**                      | 拦截不是完成；自然发生率/自主恢复未知。动态部分保持边界定位              |
| evidence equality 保证任务正确             | E post-read swap 各24 wrong；prefix 两臂 group 各4 wrong；mock 预检有 valid-but-wrong 输入             | **Unsupported，已反证**                                     | 目标意图不是 validator 输入；明确删掉保证性主张                          |
| 拒绝关系变化没有代价                       | E entity swap 24 false refusals；local-note 两 goal 合计48 false refusals                              | **Unsupported，已反证**                                     | 所有字段变化不都是 goal 依赖变化；必须并报漏检和误拒绝                   |
| 选择 evidence 能改变执行语义               | S 24 production CLI cases；先见 Relations 后选 Local 会允许 group wrong；规则避免 entity false refusal | 受控接口机制；**Strong（程序行为）/Weak（自主策略）**       | 预设 goal-type 是特权条件，不是模型选择能力；P1 测实际 Agent             |
| Adaptive 降成本且保持性能                  | 当前生产没有 Adaptive；旧 representation token proxy 与 strict 负结果保留                              | **Unsupported（新 CLI）**                                   | IDs/feedback/history 新成本；不沿用 35% 或 non-inferiority               |
| stale recovery 普遍提高 robustness         | 新 CLI 是拒绝并给提示，旧内部 recovery 另有 injected stale 证据                                        | **Unsupported（新自主恢复）**                               | 拒绝不等于 recovery；若未来 claim 恢复须闭环实验                         |
| validation 防止所有 wrong target           | S always-local group 4/4 wrong；E race/prefix 漏检；预检16次错误控制 ACK                               | **Unsupported（一般）**                                     | 成员资格不是语义 oracle；正确 schema 可以选择错误目标                    |
| Raw selector 比此 CLI 差                   | 本轮无等信息 raw baseline；旧 raw-selector 实验保留原身份                                              | **Unsupported（当前比较）**                                 | 不加无关 baseline，不写 transport/interface 全面优越                     |
| 单一成功指标能掩盖不同层                   | 重建840旧summary；M弃权0 wrong≠goal完成，E拒绝0 wrong≠goal完成，ACK可wrong                             | **Strong（存在性）/Moderate（方法论）**                     | 不同 estimand 本来回答不同问题；不称所有 E2E metric 错误                 |

## 4. Strongest empirical findings

### 4.1 新 CLI 模型实验：可用绑定与弃权

| Requested model     | Goal   | Bound：正确执行 | Unbound：正确执行 | Unbound 弃权 | 任一 wrong input |
| ------------------- | ------ | --------------: | ----------------: | -----------: | ---------------: |
| GLM-5.3-flash       | group  |           24/24 |              0/24 |        24/24 |                0 |
| DeepSeek-v4.1-flash | group  |           24/24 |              0/24 |        24/24 |                0 |
| GLM-5.3-flash       | entity |           24/24 |             24/24 |         0/24 |                0 |
| DeepSeek-v4.1-flash | entity |           24/24 |             24/24 |         0/24 |                0 |

192/192 valid JSON；192/192 provider usage；没有 provider/infra/membership
error 或 receipt–click
mismatch。组条件结果体现有依据的执行与保守弃权，不能描述为“U 误点100%”或“B减少错误动作”。新 fixed
binding effect 在两模型相同；没有新的 Adaptive 对比，也不能据此推出 fixed
policies 普遍比 adaptive 更能跨模型泛化。

Provider 报告 prompt tokens 103,321、completion tokens 16,676、total tokens
119,997。没有美元价格估计。全体 group prompt 平均：GLM B521/U516，DeepSeek
B556.46/U555.96；字节匹配没有带来 token 完全匹配，UUID/URL 也有 token
variation。这里不是效率实验。未用多次尝试挑最佳结果。

### 4.2 当前 scope 的字段覆盖

| 普通 DOM        | Local 的 full-group 暴露 | Structural | Relations |
| --------------- | -----------------------: | ---------: | --------: |
| section         |                     0/18 |      18/18 |     18/18 |
| fieldset/legend |                     0/18 |      18/18 |     18/18 |
| ARIA group      |                     0/18 |       0/18 |     18/18 |
| table row       |                     0/18 |       0/18 |     18/18 |

所有范围均暴露了 entity 文本。该 proxy 判断 full
identity 是否出现在对应 candidate 字段，不能把字符串出现直接当成模型理解。深度和长前缀控制中，Relations 四类均未暴露完整 group；Structural 在 section/fieldset 仍暴露。这反证一个简单的全局 scope 排序，不证明 Structural 模型性能在所有长标签任务更高。

### 4.3 门禁和所选 evidence 的代价

| 变化 / goal                           | identity-only      | evidence consistency              |
| ------------------------------------- | ------------------ | --------------------------------- |
| 读取前 group swap / group             | 24/24 wrong input  | 24/24 拒绝，0 wrong；0 attainment |
| 同一 swap / entity                    | 24/24 正确输入     | 24/24 合法输入拒绝                |
| 非必要 local-note / 两 goal           | 48/48 正确输入     | 48/48 合法输入拒绝                |
| 无变化、无关区域文字变化              | 两 goal 均正常输入 | 两 goal 均正常输入                |
| 替换物理节点                          | 两 goal 均拒绝     | 两 goal 均拒绝                    |
| 读取后 swap / group                   | 24/24 wrong input  | 24/24 wrong input                 |
| 24字符后才不同的 heading swap / group | 4/4 wrong input    | 4/4 wrong input                   |

S 的三种所选 evidence policies：always Relations 在四个 entity
cases 中全部误拒绝；always Local 在四个 group cases 中全部误执行；task-type
rule 拒绝四个失效 group 动作并正确执行四个 entity 动作。它没有完成 group 任务，没有处理 local-note 和 race，也没有自动推断哪个事实是最小依赖。

### 4.4 旧结果仍有用，但不能换 cohort 身份

本轮重新读取 confirmatory/replication raw summary 和 task ambiguity
metadata，并重建四cohort的840条 endpoint ledger，0计数矛盾。structural stratum：GLM
Local grounding5/20 vs Structural18/20（+65pp）；DeepSeek5/20
vs20/20（+75pp）。这支持原表示研究的受控动机。

必须区分 grounding 与 strict：GLM Adaptive
grounding56/60（93.3%）、strict53/60（88.3%）；Structural
grounding53/60（88.3%）、strict50/60（83.3%）。DeepSeek Adaptive
grounding58/60、strict52/60；Structural二者60/60。以前以“success”混用这些数字会改变结论。四旧cohort
grounding/strict 分别为206/192、223/215、141/94、156/113。原始记录保持不变。

## 5. Weak / unsupported claims

- 不是“CLI transport 改善 Agent intelligence”；没有 CLI/MCP 对照。
- 不是“关系理解是我们首次提出”；已有 RelationGUI/RelationAgent 等工作。
- 不是“执行前校验/剩余竞态/正常更新误停是首次发现”；Atomicity for Agents 已讨论。
- 不是“相同信息量”；匹配词汇和字节，绑定事实仍不同。
- 不是“representation-bound cognitive
  failure 已解释模型内部机制”；本轮 U 全是符合 prompt 的弃权。
- 不是“24独立任务×2模型×2臂”；实际只有18类语义输入，额外DOM只是底层实现变体。
- 不是“CI
  [100pp,100pp] 证明无限可信”；模板和 ceiling/floor 让 bootstrap 退化，审计明确不作总体证据。
- 不是“Local 足够所有local ambiguity”；本轮唯一 entity 条件不覆盖词义/嵌套/邻近等歧义。
- 不是“全域结构上下文越多越好”，也不是“更多上下文必然更差”；观测内容和执行规则要分开。
- 不是“scope rule 实现了智能 goal-aware
  validation”；工具仍 goal-blind，规则知道实验 task type。
- 不是“拒绝 = 恢复/成功”，或“ACK = grounded/correct”。
- 不说 Adaptive 非劣效、节省35% inference cost、general robustness、exactly-once
  effects、完整浏览器事务或一般网页泛化。

## 6. Failure taxonomy

从实际轨迹归纳，保留控制失败和模型弃权的区别。

| 层 / failure                   | 本轮可观察证据                                     | 是否 representation-bound             | 谁能解决                                           |
| ------------------------------ | -------------------------------------------------- | ------------------------------------- | -------------------------------------------------- |
| Observation eligibility        | 深度超限、目标关系没有提取，旧 password 不 offered | offered/coverage 条件，不能全归因模型 | observation/action 提取器；先检查能力范围          |
| Relation identity exposure     | full heading 在24字符截断后发生碰撞                | 是，已显示字段无法区分事实            | 更可靠公开标识或暴露必要字段；不代表应无限加上下文 |
| Decision under missing binding | M group U 全弃权，entity U 正确                    | 信息依赖条件；不是已证明认知错误      | 暴露对应事实，或承认无法判定                       |
| Reference membership           | protocol 能拒绝不存在ref；M没有此错误              | 否，接口使用/格式层                   | 严格schema与issued refs                            |
| Physical stale target          | replace-target 全部拒绝，无输入                    | 否，关系不是节点身份                  | document/node/state checks                         |
| Displayed evidence stale       | same node + swapped group，旧选择对group失效       | 是，原关系依据失效                    | evidence gate，随后重新决策才能完成                |
| Conservative refusal           | entity swap或非必要local-note仍正确但被拒绝        | relation/context comparison 的边界    | 依赖选择；需要验证caller能否正确选择               |
| Underbound action              | 先看Relations却用Local执行，group错误获ACK         | 是，但根因是提交依赖不足              | 明确contract信任边界，不声称推理依据已强制绑定     |
| Read→input race                | read之后swap，两个门禁都ACK wrong                  | 否，增加静态字数无效                  | 原子语义/更近检查等系统问题；本轮不声称解决        |
| Goal completion/termination    | 旧grounded-not-strict大量存在；新caller不测DONE    | 不能自动归因representation            | 独立goal oracle、termination/closed-loop研究       |
| Instrument failure             | model-development-01通信路径过长；02修复且零调用   | 否                                    | 实验基础设施；保留development，不放模型结果        |

零wrong不能消除failure：M的U是未完成的安全弃权；E的gate是拒绝失效动作；截断和race中的gate
failure则不能通过“没有变化被检出”隐去。没有删掉任何正式负结果。

## 7. Mechanism hypothesis

最小事实是 candidate→group 对应关系，而不是把 DOM 当成一段更长文本。M 的干预保留 group
lexemes 和候选描述，只操纵 `belongs_to` 的事实及其引用语法。group
goal 需要此对应，唯一entity
goal 不需要。当前资料不能区分语法的弃权提示、事实可用性和模型内部推理过程；不能将结果写成 attention/representation 的认知解释。

执行的另一个机制是：`act`
接收一份所选 view，并对它的字段一致性比较。它没有保证所有曾经展示的事实都被绑定，也不知道哪些事实是goal所需。

设 V 为所选证据一致，G 为这次动作仍满足goal。E/S表明
**V并不保证G；非V也不意味着非G**。前者来自截断/竞态/降级，后者来自entity-goal和非必要文字变化。这是经验边界，不是新的逻辑定理或完整安全证明。

当前最有价值的 mechanism
framing：**观察内容影响能否作出有依据的选择；执行所选证据影响哪些变化会拒绝动作；二者必须相对goal解释。**
最小依赖自动推断、反馈促进恢复和学习策略仍是未检验问题。

## 8. Threats to validity（严重性排序）

1. **新颖性被既有工作覆盖。**
   SWE-agent研究ACI；AgentOccam研究观察/动作调整；RelationGUI/RelationAgent明确研究GUI关系；Atomicity
   for Agents研究DOM/layout monitoring、pre-execution
   validation、正常更新引起暂停和残余竞态。差异只能是特定的关系暴露与所选依赖契约的受控分析。不能靠换名字补贡献。
2. **任务语义重复和构造偏向。**
   四DOM、八骨架在投影后没有生成对应数量的独立模型条件；所有模型问题只用三实体、三分组、循环映射。代码反平衡不证明没有所有捷径。18类去重结果比192调用平均更诚实，但仍不是网站总体样本。
3. **显式未知标记与prompt混杂。** 共享prompt解释 `??`
   并允许弃权，全部U弃权可能包含uncertainty
   cue 的效应。必须以neutral-unbound独立控制检验；当前仅支持这项完整接口干预。token也没有完全匹配。
4. **特权 controller。** E/S直接选择初始正确动作，task-type
   rule知道实验goal类别；不能外推自主Agent、更不能描述为policy学习成功。M只进行一次目标选择。
5. **oracle覆盖与construct范围。** 新oracle使用独立app
   state/完整heading/event，不复用extractor；然而仅click单步。新实验不测fill参数、选择value、eligibility变化的完整集合、iframes、shadow
   DOM、视图和可访问性树覆盖。
6. **model sampling与时序。** 温度0、top_p1、seed
   unavailable、一试一次；provider-default
   reasoning，四并发、轮换dispatch，记录requested/returned
   model和usage，192无重试。没有证明服务确定性；临时UUID/URL引入小的格式/token
   variation，不能写成逐字节相同prompt。
7. **scope/validation不是原子goal合同。** 同步capture只保证那次读取一致；final
   check与CDP input分离，scope字段有长度/深度范围，caller可选择较弱evidence。receipt
   ACK只是输入确认；unknown必须保守保留。
8. **数据历史与并行修改。**
   独立新cohort、新archive、wx输出。11旧raw、3旧archive及旧relation
   freeze/archive未改变。执行块方法结束检查通过。工作区有其他并行README/package发布材料变更；本轮未改这些产品文件，freeze记录了每块实际文件状态，不能让当前工作树替代归档方法。
9. **统计不能补构造缺陷。**
   工具census不用Wilson/McNemar。模型原八页面bootstrap仅留作预设诊断；语义去重发现后不作为独立任务CI。未来独立语义任务用paired
   task effect及task/source-family bootstrap，CI宽就保留不确定，不增加repeat追显著。

### Related-work核查范围

截至2026-10-05，核查了以下原始来源。不是完备综述；RelationGUI检查了出版方摘要/section
snippets及作者数据说明，未取得出版论文全文；不得根据未读全文宣称其没有某机制。

- [SWE-agent](https://arxiv.org/abs/2405.15793)：ACI影响Agent行为已有先例。
- [AgentOccam](https://arxiv.org/abs/2410.13825)：观察/动作空间调整已有先例。
- [SeeAct](https://arxiv.org/abs/2401.01614)：生成与grounding的区分已有先例。
- [RelationGUI / RelationAgent](https://www.sciencedirect.com/science/article/abs/pii/S003132032600227X)：作者提出关系标注与关系能力训练；“关系有用”不是新颖性。[作者数据卡](https://huggingface.co/datasets/ahuiqqq/RelationGUI)区分重建版本与历史实验发布，不能混用复现结论。
- [Atomicity for Agents](https://arxiv.org/html/2603.00476v1)，§5、§7、Appendix
  B：执行前monitoring、良性变化导致暂停与剩余窗口均已覆盖，直接限制动态主线新颖性。
- [Signal-Driven Observation](https://arxiv.org/abs/2606.06708)：任务相关DOM查询与信号触发观察已有工作。
- [AOI](https://arxiv.org/abs/2606.29472)：动态观察接口已有工作。
- [Typed Actions position paper](https://proceedings.mlr.press/v306/jiang26bj.html)：语义动作接口的广泛动机已有讨论，不是Prism实验的替代验证。

## 9. Reviewer simulation

分数仅为假设性的5分制审稿模拟，不是接受概率。

| Reviewer      | 当前倾向      | 最强批评 / fatal concern                                  | 可回应部分                                                  | 最有价值补证                                                 |
| ------------- | ------------- | --------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------ |
| Systems/Agent | 2–3/5，偏弱拒 | 未见新机制方法；验证与竞态论文已有；不是完整外部Agent实验 | 有真实CLI、门禁单因素、ACK/event、源码冻结；贡献明确收窄    | 独立任务中同一goal条件的合同差异，并和相关工作的具体干预区别 |
| ML/empirical  | 2/5，偏拒     | 192实为18语义输入；U被prompt引导弃权；退化CI不能救样本    | 承认并去重，旧raw未重标，provider记录完整，两模型一致       | neutral-unbound + 独立语义holdout；按真正task聚合            |
| HCI/browser   | 2–3/5，偏弱拒 | Alpha/Item任务太简单，goal type 已知，DOM extractor范围窄 | 行、legend、group边界有真实浏览器验证；明确不声称现实普遍性 | 独立作者页面上的真实关系目标与oracle/coverage资格审计        |

继续跑同样模板不太会提高这些分数。若投稿范围是工具演示/机制短文，可先形成诚实叙事；若追求完整强论文，P0独立语义验证不可省。

## 10. Recommended paper thesis

| 方向                                     | 新颖性                     | 覆盖 / 缺口                                                       | 工程负担            | 可防御性 / 风险 / 连贯性                                          |
| ---------------------------------------- | -------------------------- | ----------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------- |
| A. Goal-conditioned relational contracts | 窄范围中等候选，不承诺首创 | M暴露、E失效/误拒、S依赖选择；缺独立语义/neutral control          | 低到中，保持当前CLI | 最连贯；scope有限时可防御；任务简单仍是主风险                     |
| B. Browser stale-state safety method     | 目前低，直接接近Atomicity  | 工具对照强；缺新method、安全覆盖和自然场景                        | 中高                | 当前有truncation/race/underbinding反例，不能以安全保证作主线      |
| C. Adaptive CLI efficiency               | 当前低                     | 生产没有Adaptive；新完整usage有，但没有自适应cost/performance对照 | 中高                | 非劣效与policy泛化缺口大；会偏离最强证据                          |
| D. Layered browser evaluation            | 中等方法论候选             | 840历史轨迹和oracle问题；六层独立oracles尚无                      | 中                  | 当前作为evaluation methodology更自然，单独主线会分散interface研究 |

推荐A。固定关系事实为主要干预，动态失效与goal-conditioned拒绝为边界；S仅说明契约允许选择依据，不能把它升成已成功的自主policy。

可以写的严格结果句：

> We show that, in controlled single-step browser tasks, explicit target–group bindings
> enable grounded execution rather than abstention for relation-dependent goals, while
> validation of selected evidence creates a goal-dependent trade-off between
> stale-action prevention and valid-action refusal, bounded by what is exposed and when
> it is checked.

适用范围必须带上：两种固定模型、三实体三分组、18类语义条件、最小外部CLI
caller。这个thesis是值得检验的科学主张，不意味着现有创新量已经足够。去掉“首次、一般browser
agents、原子、智能最小依赖、普遍安全”等扩写。

## 11. Minimal experiment roadmap

### 已完成：本轮证据块

| Block | RQ / hypothesis                  | Manipulation / control                            | Tasks / models / repeats                        | Metrics / analysis                                             | 正/负意义与成本                                                         |
| ----- | -------------------------------- | ------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------- |
| O/E   | 关系暴露与门禁是否有goal条件边界 | scope、gate、mutation、goal；其余固定             | 四DOM、八骨架、三状态；固定controller；一次枚举 | 覆盖、wrong、false refusal、actual click；分层census，无总体CI | 已支持边界；限于条件机制。720记录，零模型                               |
| M     | B−U对group强于entity             | 只变binding；同词汇/字节/shared prompt            | 两模型，192请求；18语义类；一试一次             | 首选正确、弃权、valid、真实input、usage；去重敏感性            | 已正向，但全U弃权使cue混杂突出；不加repeat。已耗119,997 provider tokens |
| S     | 所选view是否影响接受条件         | 相同初始Relations；选Local/Relations/已知type规则 | 四DOM×两goal×三规则；零模型；24cases            | wrong/refusal/attainment；独立oracle                           | 已显示表达能力与降级风险；非自主policy。低成本                          |

### P0-A — 独立页面的oracle与关系资格检查，先做零模型

- **RQ/H：**
  新关系任务的正确控件是否offered、oracle是否能区分正确与错误动作、必要事实是否在当前表示里？预期并非所有页面都覆盖。
- **Manipulated/control：**
  用独立已知正确/错误控制，以及初始、隐藏、disabled、更新状态；不修改product
  extractor来救选中的页面。
- **Tasks/models/repeats：**
  先锁八个独立语义目标、来自至少四个独立来源/组件家族；每页entity与group任务。复用冻结外部sources中的repeated-table、form/group等适用页面，不足时选独立作者页面。保留不支持页；零模型。约32观察+16已知输入，无无效repeat。
- **Metric/analysis：** offered、relation exposure、correct/incorrect/neutral
  oracle覆盖、argument/state效果；逐任务表，不做显著性。
- **Informative outcome：**
  positive才允许模型研究估计支持范围；negative限定能力或发现oracle缺陷，不能把页面静默排除成“all
  browsers”。它会改变claim scope，不改变A主问题。
- **Cost：** 低到中，独立oracle要认真；新增研究材料，不重构产品。

### P0-B — 独立语义holdout + neutral-unbound，一项合并实验

- **RQ/H：** 原effect是不是只来自 `??`
  的弃权提示？在新关系任务中，真绑定应比两个unbound更有依据地完成首次选择；entity不需要同类绑定。
- **Manipulated/control：**
  Bound、现有marked-Unbound、neutral-Unbound三臂；后者仍列同group
  words但不解释为显式未知绑定。尽量固定候选与格式，披露不可完全等价的语法差异，不用填充token冒充信息控制。
- **Tasks/models/repeats：**
  P0-A锁定八独立页面语义，每页两goal；相同两模型，每格一次，共16×3×2=96请求。先规范化检查语义唯一；无需更多同模板repeats。
- **Metric/analysis：** primary为all-dispatched首次正确；valid、abstain、wrong
  input、oracle与usage并报。按独立task配对、来源家族敏感性；task-cluster
  CI可作为有限诊断。固定预算和错误handling，跑前冻结。
- **Informative outcome：**
  两个unbound都明显缺乏依据而Bound改善，增强事实绑定解释；只有marked臂下降则转向uncertainty
  cue解释；只有synthetic有effect则收窄论文。宽CI保留不确定，禁止补repeat追显著。
- **Thesis/cost：**
  最可能改变A可信度的一项实验。中等成本；这96次需要新的预算，本轮192已用完。

### P1-C — 外部调用者自主选择 evidence 和恢复

- **RQ/H：** caller能否在保持group保护时避免entity
  overbinding？预设rule成功不等于自主policy成功。
- **Manipulated/control：**
  全Relations策略 vs 同一Agent可选择Local/Relations；相同最初观察、goal、变化与feedback，不同时改反馈格式。Agent选择以后才固定发生group变化。
- **Tasks/models/repeats：**
  八个独立goal条件×两策略×两模型，一次episode；32episodes，每episode最多三次模型请求，硬上限96。不是当前product内置Adaptive。
- **Metrics/analysis：** 必要依赖绑定、错误弱化、false refusal、wrong
  input、恢复后独立oracle、total usage；task配对。无preregistered margin不能叫非劣效。
- **Positive/negative：**
  positive支持feasible自主依赖选择；negative说明S只是特权规则，保持工具expressiveness主张即可。不一定需要升成主贡献。
- **Thesis/cost：**
  若论文仅做契约机制可为P1；若宣称自主优化就升P0。中等实现成本，用现有context/act，无生产bypass。

### P2 — 只在新的claim需要时做

更多自然更新的delay/race分布、完整coding-host集成、Adaptive正式cost/non-inferiority、大benchmark、transport对照均暂不扩展。尤其不做全套scope×guard×model矩阵；也不为了与Atomicity竞争而加浏览器冻结、安全框架或新monitor。本轮已识别race存在，继续重复同反例不会增加机制信息。

## 12. Stop / Go criteria

**现在停止：**
本轮所有预设block已经完成，192请求耗尽，零retry。不要重复18语义条件、继续刷模板、修extractor后覆盖本轮negative。

**现在开始写：** motivation、API合同、真实字段范围、两模型弃权结果、false
refusal与漏检、历史结果限域、相关工作边界。原始结果冻结后再编辑论文文本。

**继续实验的唯一P0理由：** 独立task/oracle
qualification和neutral-unbound改变“事实绑定还是显式未知cue”的可信度。若论文要claim自主选择/恢复，再做P1-C；否则不追加。

**Freeze整个研究：**
独立语义任务的来源/goal/oracle在调用前锁定；两模型完整block有相同estimand；主要cue混杂得到控制；关系失效、误拒绝、coverage/race边界共同报告；原始、方法、usage与derived分析可复现。没有规定必须漂亮均值或显著p才停止；negative也可形成边界论文。

**Pivot：** neutral-U基本消除差异则改成uncertainty
cue与弃权；独立任务不转移则限定受控contract案例；若只有工程不变量/经典TOCTOU反例、没有额外条件性洞见，则停止包装成新算法论文，定位为工具或机制短文。评测分层只有在独立oracle贡献明显时才升第二主线。

## 13. Paper outline

| Section               | 真正要证明什么                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------ |
| Introduction          | browser接口不只提供动作；其事实与提交依据决定决策/执行条件，问题范围明确                   |
| Motivation            | 同名controls需对应关系；同节点未必同关系；同关系变化未必改变goal正确性                     |
| Problem formulation   | 区分观察、所选evidence、ref、goal oracle、执行确认；不假定predicate彼此等价                |
| System/representation | 展示现有CLI contract与可公开提取范围，不将工程清单算贡献                                   |
| RQs                   | 关系可用性、条件性执行拒绝、依赖选择三个不同问题；标记post-hoc形成与前瞻block              |
| Setup                 | source/Node/Chrome/model/request pin、语义任务单位、独立oracle、所有planned/error handling |
| Results               | group的执行/弃权与entity控制；不把无wrong或拒绝当完成，分模型报告                          |
| Mechanism analysis    | lexical/byte匹配绑定干预，neutral-cue未来对照；提出解释的实际可识别范围                    |
| Failure/boundaries    | coverage、truncation、race、false refusal、underbinding均与positive并列                    |
| Discussion            | caller选择scope的潜力与信任边界；不能证明自主最小依赖或一般CLI方法论                       |
| Threats               | 输入语义重复、人工任务、seed/服务、prompt cue、oracle与历史版本                            |
| Related work          | 正面承认ACI、relation理解、Atomicity等已有贡献，只比较具体不同问题与测量                   |
| Conclusion            | 仅重复已证实的条件事实与scope，指导何时重观察/选择依据，不扩为通用安全/SOTA                |

## 14. Concrete next actions

### Next 3 experiments

1. **先资格审计，零模型。**
   冻结八个独立页面语义和两个goal，至少四来源家族；32观察+16独立known-control输入；输出offered/relations/oracle矩阵，保留所有不支持条件。
2. **合并holdout和cue控制，96请求。**
   同16tasks、两模型、Bound/marked-U/neutral-U；先验证语义唯一，再冻结请求/分析；不沿用旧cohort。它是下一项最有价值的模型实验。
3. **只在要claim自主策略时做32episode。** 固定full vs model-selected
   evidence；group更新后最多三次调用的恢复预算，最多96请求；报告underbinding和false
   refusal，不以oracle规则冒充Agent。

### Next 3 engineering / analysis tasks

1. **把语义签名审计移到pre-call。** 当前semantic
   audit为post-hoc；未来调度前输出去掉临时ID的task语义签名、每签名重复次数与来源，不把DOM模板数算模型task数。保留完整未规范化prompt作复现。
2. **归档完整paper bundle。**
   `work/`默认不进Git；保存新freeze/source/plan/raw/usage/receipt/semantic-audit，以及旧raw/source
   bundles；检查无key/header。分享者需要这一bundle，Git checkout不是完整证据。
3. **保持产品与研究边界。**
   结果已锁，不就地修24字符/六层字段后重写negative。若将来产品修复，另标方法版本；对新的external
   oracle从独立state/known-control验证起步，避免旧tabs评分覆盖问题。

### 本轮交付与复现位置

- 研究工具和三个协议：[evals/cli-contract-v1](../../evals/cli-contract-v1/README.md)。
- O/E：`work/cli-contract-v1-2026-10-05/final/`，含720条原始记录、`results.md`、`summary.json`、source
  freeze和integrity。
- M：`work/cli-contract-v1-2026-10-05/model-final/`，含192次raw
  request/response、`model-results.md`、原预设分析，以及优先解读的`semantic-audit.md/json`。
- S：`work/cli-contract-v1-2026-10-05/selected-evidence/`，24条实际CLI记录和`scope-summary.json`。
- 旧endpoint重建：`work/cli-contract-v1-2026-10-05/historical-endpoints/`，840条summary，0计数矛盾。
- Development记录单独保存；第一次model
  dry-run因socket路径失败，第二次32case通过、零调用。后者16条固定错误选择也得到ACK，是validator不能判断goal的额外程序反例，不计模型表现。
- 验证：120普通测试通过、19需显式开启测试默认跳过；单独3个真实CLI浏览器integration通过；类型检查与新增文件lint通过。没有执行会调用真实模型的其他integration。
- 本轮研究包：`work/cli-contract-v1-2026-10-05/paper-bundle.tar.gz`；逐文件hash和最终核对位于同目录的`bundle-manifest.json`与`verification.json`。包含本轮正式/开发证据、源码冻结、旧原始结果与已有归档、审计文档和验证记录；不包含credentials、浏览器profile或依赖二进制。环境仍需按冻结版本配置，不能视为完整运行镜像。
- 本轮没有修改production源码、旧结果/manifest、用户AGENTS，未提交、推送或发布。其他并行任务的README/package/commands修改保留原样。
