# Prism 作为 browser-use CLI for agents：重构与论文方向判断

日期：2026-10-04。性质：设计提案与事后诊断。下文保留重构前的判断与接口草案。

实施更新：首版生产 CLI 已完成，接口增加了显式 `--evidence`
与持久回执；具体状态、测试与边界见
[实现记录](browser-cli-implementation-2026-10-04.md)。旧冻结实验材料没有改写。本文下方的“当前代码”和“尚未实现”描述属于提案时点，不能用作当前源码说明。真实模型调用仍为零。

## 判断

本次讨论采用的研究方向是：**面向 agent 的浏览器接口，其观察与执行契约如何影响关系依赖的 grounding？**
产品形态是 browser-use CLI for
agents；主要研究干预是关系信息的表达，动态关系失效用于分析执行边界。以下接口与实验提案服务于这一方向，尚未实施生产重构。

研究目标表述（不是已完成的效果声明）：

> We study how the observation and execution contracts of agent-facing browser tools
> affect relation-dependent grounding, using a browser CLI to isolate relation
> visibility and changes between observation and execution.

这里的观察契约规定候选、关系字段、截断与引用范围；执行契约规定动作引用所对应的观察、执行前校验、未执行/已执行/结果未知的回执及失效反馈。旧 representation 结果是前者的已有证据；新动态诊断是后者的一个反例。外部 agent 的 planning 与 termination 仍是独立变量，不能由接口效果代替。

可以重构。推荐将 Prism 定位为：**供外部 agent 使用的浏览器观察与动作接口，明确呈现目标关系，并校验动作引用所依据的观察。**

产品需要中等规模的接口与生命周期调整。论文可以继续研究 representation-bound
grounding；CLI 是研究机制的交付方式。若把主张改成 CLI 优于 MCP、通用浏览器工具更强或跨所有 coding
agents 有优势，则需要另建证据链，论文范围会明显扩大。

## 参考插件实际提供什么

Cursor 的
[cli-for-agent README](https://github.com/cursor/plugins/tree/main/cli-for-agent) 与
[技能源文件](https://github.com/cursor/plugins/blob/main/cli-for-agent/skills/cli-for-agents/SKILL.md)
提供 CLI 设计指导：非交互输入、分层帮助、示例、stdin、可操作错误、重试与可预测输出。它不是浏览器执行框架。

这些原则值得采用，但没有构成科研贡献。现有
[agent-browser](https://github.com/vercel-labs/agent-browser) 已提供 browser
CLI、snapshot 引用、动作及 session；短引用和 agent 调用 CLI 都不能作为 Prism 的新颖性声明。

相关研究也已有观察处理与动作空间设计：[Agent-E](https://arxiv.org/abs/2407.13032)
研究 DOM distillation 与 change
observation；[BrowserGym](https://arxiv.org/abs/2412.05467)
提供统一观察和动作空间；[Prune4Web](https://arxiv.org/abs/2511.21398) 研究 DOM
pruning 与 grounding。本次是初步的主要来源对照，尚不足以确认以下候选机制的文献新颖性。

## 当前代码与目标边界

| 部分       | 当前代码事实                                                        | CLI 目标                                                          |
| ---------- | ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 调用入口   | `src/interfaces/cli.ts` 接收 URL 与完整 goal                        | 外部 agent 分步观察、取上下文、执行                               |
| 决策       | `src/runtime/task.ts` 要求 TypeSafe key，内部选择动作并生成字段文本 | 外部 agent 负责选择、字段值、计划和完成判断                       |
| 浏览器     | `src/browser/session.ts` 持有 CDP session，创建并最终关闭 owned tab | 跨命令保留同一 tab 与观察引用                                     |
| 目标编号   | `src/runtime/action-space.ts` 每次观察按顺序重建 index              | 引用绑定 session、document 与 observation；不能承诺编号跨观察恒定 |
| 表示       | richer context 与 Adaptive 实现在 `evals/runners/`                  | 新产品方法有独立、可测试的表示模块；历史方法不就地改写            |
| validation | 模型分布校验与浏览器 freshness 分属不同代码                         | 命令 schema/目标成员资格/浏览器可操作性分别检查                   |
| recovery   | 内部 loop 可重新 observe 和 decide                                  | 返回明确失败与新观察线索，由外部 agent 重新决定                   |
| evaluation | run harness、success oracle、grounding、strict success              | 继续留在研究 harness，不把 fixture oracle 放进产品                |

内部模型调用可以从新产品路径中移除。外部 agent 仍消耗自身推理额度；这不能描述成免费推理或已证明总成本下降。

## 最小接口提案

以下命令尚未实现。`s1`、`o17` 和目标引用示意接口关系。

```bash
prism session open --url https://example.com --json
prism observe --session s1 --scope local --json
prism context --session s1 --observation o17 --target o17:t8 --scope structural --json
prism act --session s1 --observation o17 --operation click --target o17:t8 --request-id r42 --json
prism session close --session s1 --json
```

首版只实现当前支持的 click、fill、select、scroll、wait。所有输入可由 flag 或明确的 stdin
JSON 表达；每个子命令有帮助和有效示例；机器输出与诊断日志分开。

一个本地会话管理进程持有 CDP 连接、tab、observations 与请求回执。每个 session 的浏览器操作串行执行。短命 CLI 进程调用该边界；`close`
只关闭自己拥有的 tab。这样可以复用现有 BrowserSession 的生命周期，而不用让每条命令重新开页。

`context`
先复用已有 Local/Structural 语义与上限。它获取更丰富信息；不能先声称自动找到了最小充分上下文。新增 relation-only 格式若进入产品，需要标为新方法版本。

返回结果至少区分：

- 命令是否合法；目标是否属于指定观察与 session。
- 动作未执行、已执行或结果未知，以及具体原因。
- 新观察标识、耗时和可审计的动作回执。

CLI exit
0 表示该命令按契约完成，不表示用户任务成功。正式实验仍独立评估首次 grounding、错误动作、goal
oracle 和外部 agent 的终止报告。

浏览器 click 不能普遍保证幂等。`request-id`
对已确认结果去重；崩溃或超时导致执行结果未知时，不自动重放。`--dry-run`
只能预检当下状态，不能保证稍后的页面仍相同。stale 引用不能自动按标签匹配另一节点后点击，否则可能替外部 agent 改变原意。

## 科研候选一：显式关系绑定，推荐主线

问题：给出同样的实体与 group 词汇，是否只有把词汇绑定到正确候选，模型才能跟随 group-required
goal？

当前证据支持“合成结构歧义上表示有条件收益”，尚未证明关系绑定是唯一原因。GLM Structural
18/20 对 Local 5/20；DeepSeek
20/20 对 5/20。外部页面的平均 Structural−Local 仅 +1/45，两模型区间均跨零。详见
[研究审计](/home/tulipe/projects/prism/docs/research/research-audit-2026-10-04.md)。

已经准备好的 Bound−Unbound 实验正好检验这一机制：相同候选与 group 词汇，配对状态、联合位置平衡，改变
`belongs_to` 引用。CLI 可以将这类信息作为明确的 observation contract 暴露给任何调用者。

这条主线改动最小。先完成现有 384-cell 正式 block，再在少量独立 DOM 中检查转移；不要因为重构就重新跑所有历史 cohort。后续转移应包含原生 accessibility-tree 表示参照，避免只胜过主动删除关系的对照。层级树本身已有关系信息，不能把“展示 DOM 关系”描述为首次提出。

## 科研候选二：关系证据的新鲜度，值得做小规模诊断

新问题：**节点仍存在且标签未变，是否足以保证动作仍基于正确含义？**

本轮发现并实际复现一个反例。当前 `BrowserSession.fresh()`
比较 guard 时，`comparableGuard()`
删除最后一个 surrounding-context 字段。独立页面中，两个 article 的公共 Alpha/Beta 标题交换后：

- Item 7 的节点与标签仍相同。
- 其公开 group relation 从 Alpha 变成 Beta。
- 完整 guard 已改变，实际比较的 guard 未改变。
- 当前 target freshness 和 same-document 检查均接受。

诊断未执行点击，也未调用模型。[诊断记录](/home/tulipe/projects/prism/work/cli-direction-2026-10-04/semantic-freshness-diagnostic.json)
与
[复现脚本](/home/tulipe/projects/prism/work/cli-direction-2026-10-04/semantic-freshness-diagnostic.ts)
单独保存；没有触碰冻结文件。

它证明当前实现存在一种未覆盖的 relation-change 条件，不证明真实网页常见、模型一定选错或某种新 guard 已有效。这是代码设计中的取舍：忽略 scope 文本可以容忍 dashboard 的无关更新；全面比较 scope 又可能产生过多拒绝。

候选机制是只校验该目标已展示的关系字段，区分有意义的关系变化与无关文本更新。首个受控诊断应同时覆盖：无变化、无关文本变化、group 绑定变化、节点替换/失效。比较当前目标 guard、完整 scope
guard 与关系字段 guard，记录漏检、误拒绝和执行前后的行为。以固定正确策略先验证工具，再决定是否值得投入模型实验。

边界必须保留：关系 guard 不证明外部 agent 的决策正确；也不能保证其他候选价格改变后，原选择仍最优。比较与 CDP 输入之间仍有竞态，不能声称原子语义提交或消灭所有 stale
actions。

若它在多个独立 DOM 上有明显的检测/误拒绝取舍，且 agent 能利用拒绝反馈恢复，再把它升级为论文的动态边界实验。否则只作为 failure
case，不扩大主线。

## 科研候选三：外部 agent 主动取上下文，暂列后续

CLI 使 agent 可以先看 Local，再主动请求 Structural。这与当前 Adaptive 不同：当前策略是目标无关的字符串碰撞升级，并非模型主动获取信息。

新假设是：在固定 grounding 或 strict-performance 约束下，主动查询能否减少整段任务的总输入成本。它需要比较固定 Structural、现有自动策略和主动查询，并记录所有推理轮次、重复上下文、工具输出、失败与恢复。

它会改变 policy、调用次数与成本 estimand。已有 35.4% representation
proxy 节省不能证明它成立。没有足够日志/usage 时先报告工具输出量和调用次数，不声称总推理成本；没有预先指定 margin 与分析标准时也不声称 non-inferiority。

这一方向工程和实验负担更高，当前不应与关系绑定、动态验证一起成为三个主贡献。

## 论文方向改变多大

| 选择                                 | 变化程度                               | 已有结果的地位                                       |
| ------------------------------------ | -------------------------------------- | ---------------------------------------------------- |
| CLI 交付 + 固定关系表示机制          | 小；改系统定位，保留 RQ                | 旧受控结果继续支持旧方法；CLI 需独立验证和小转移检查 |
| CLI + relation-change 动态边界       | 中；增加一个 failure mechanism         | 旧 stale 结果是动机，不能替代 semantic-change 新证据 |
| 主动 context acquisition 为主        | 中至大；改 policy 与 cost 问题         | 原 Adaptive 降为基线，旧 proxy 不能当新方法结果      |
| CLI 优于 MCP / coding-agent 平台为主 | 大；新增 transport 或 host-effect 问题 | 旧模型 harness 不足以支持这类比较                    |

同一核心方法经 CLI 或 MCP 暴露，是接口选择；协议名本身不解释 grounding 改善。若研究 transport
effect，必须对齐候选、页面表示、模型、提示、调用预算和 executor，不能将这些一起变化的 benchmark 排名当作 CLI 的因果效果。

外部 coding agent 会改变 prompt、action
schema、history、字段值生成及终止策略。旧 runs 不能改名为 CLI-agent
runs，也不能与新 runs 合并。特别是新命令不会自然产生旧 probability heads；命令 schema
validation 与旧分布一致性 validation 不能合称同一个 ablation。

此外，当前冻结清单涵盖
`src/`、测试和共享依赖。实施重构后，该清单会拒绝新工作树，不能要求旧 study 自动适配。旧实验从对应源码快照及原研究材料独立运行；新 CLI 方法另立版本和冻结记录。历史重现不要求产品维护已废弃的旧入口或模型依赖。

## 最小实施顺序与停止条件

1. **先完成会话、观察、单步动作、关闭的端到端接口。**
   验证跨进程引用、状态变化拒绝、请求回执和未知结果处理。这个阶段不需要模型调用。
2. **接入固定 Local/Structural 以及显式 context 查询。**
   对照原 formatter 验证输出，明确公开字段与截断。先让外部 agent 能工作，再移除旧产品 task-loop 入口与内部模型依赖；历史研究方法保存在独立快照中。
3. **实现最小 agent skill 与一次受控迁移检查。**
   首版只需要非交互工作流、帮助及错误后恢复示例。先验证一个宿主；另一宿主证明可移植性需要独立证据。

先前冻结的 relation-ablation 仍是最优先的科学检验。重构不自动使它失去价值，也不要求新增完整 CLI
benchmark。动态关系诊断仅在基本接口稳定后作为小补丁；主动查询主线暂缓。

停止重构的条件是：外部 agent 可完成受控浏览交互，引用和失败语义明确，表示输出可审计，既有研究材料可独立复现。不要为了产品功能列表继续增加机制。

## 推荐论文表述

当前研究目标以开头的 agent-facing observation/execution
contract 表述为准。对现有结果，使用范围受限的描述性结论：

> We find that structural context provides larger grounding gains on controlled
> group-relation tasks than on local identity tasks; this benefit is not established on
> the evaluated external pages.

关系原子消融通过后，再将主张细化到 explicit candidate–group
binding。动态诊断目前只支持补充存在性陈述：

> We identify a case where a target remains valid under node-level freshness checks
> while its displayed group relation changes.

推荐押注**关系信息是否足以辨识目标，以及该信息何时失效**。CLI 让这个问题变成可复用、可测量的 agent–browser 接口；论文可信度仍取决于受控干预、边界与独立转移证据。
