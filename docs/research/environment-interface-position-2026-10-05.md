# Prism as an external-agent browser environment

日期：2026-10-05。性质：现有实验后的论文定位建议；新 framing 属于 post-hoc，不改变冻结协议、原始结果或研究包。没有新增模型调用。

## Verdict

不以显著提升任务成功率为核心目标是可行的。论文可以研究外部 Agent 如何接入一个拥有状态、公开观察、动作校验与回执的环境。系统/接口设计的贡献也需要具体可评估的收益、设计取舍和范围，不以“新范式”的命名替代证据。

现有 Prism 提供这种环境实现的基础，现有实验部分支持其观察与执行契约的条件性分析。它们没有证明 CLI 优于 MCP、跨 Agent
host 可迁移，或独立于领域的普遍新范式。

## Correct comparison

Skill、MCP、CLI 的主要职责不同，能够组合：

- Skill 打包使用知识、流程及可选脚本。依据：[Agent Skills 官方定义](https://agentskills.io/home)。不能声称 Skill 只能静态描述且不能运行代码。
- MCP 提供工具连接、工具输入输出与资源等协议。工具可返回结构化内容并定义输出 schema。依据：[MCP tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)。同一 Prism 语义可以由 MCP 工具封装；没有协议层证据支持其无法承载状态、观察或执行依据。
- CLI 提供通过进程和 shell 调用的入口。Prism 的 stateful browser
  contract 是在其上实现的。Cursor 的
  [CLI for Agents](https://github.com/cursor/plugins/tree/main/cli-for-agent)
  自身以 Skill 提供 CLI 设计建议，不能作为 CLI 替代 Skill 的证据。

因此更稳健的研究对象是 environment
contract，CLI 是部署与组合形式；Skill 是教 Agent 使用这个环境的方式，MCP 是可能的另一种连接形式。

## Coherent paper

候选题目：_Prism: A Contract-Based Browser Environment for External Agents_。

候选 thesis：

> We present a browser environment that separates agent decision-making from
> observation-bound execution, and characterize how relational observations and
> selected-evidence validation affect grounded action, refusal, and failure diagnosis in
> controlled tasks.

这句描述系统与实际检验范围，不保证性能、完整安全、认知解释或首创。当前尚未完成独立浏览器任务和多 host 研究。

三个贡献候选应保持同一证据链：

1. 清楚定义 Agent 与环境的责任、观察身份、所选依据、输入确认、任务完成之间的区别；说明每项设计解决什么接口歧义。
2. Prism 实现并展示这个契约如何通过普通命令复用；部署可行性与真实 host 迁移需要实际记录，不能由两个模型替代。
3. 受控地检验关系事实可用性、所选依据、失效拒绝与合法动作拒绝，保留截断、竞态和 underbinding 的边界。

旧内部 harness 数据作为动机与历史限域证据；新 CLI 的模型对照作为观察语义证据；零模型门禁与 evidence-selection 对照作为执行语义证据。没有模型总成功率提升也可以形成有价值的条件性结果。仍需补齐语义重复、未知标记与独立页面范围的主要缺口。

## Minimal discriminating evidence

- 独立页面资格检查和 neutral-unbound，补新 CLI 机制的效度；不保证新颖性。
- 两个真实外部 Agent
  host 上使用相同契约，记录部署要求、host 特定改动、命令有效率、ref 使用与反馈处理。两个 provider/model 不是两个 host。不能以研究者代替 Agent 执行全部命令证明自主可用性。
- 若比较 CLI/MCP，固定后端、观察内容、动作参数、会话状态、校验和回执，只变入口并披露 host 的工具暴露差异。它回答连接形式问题，不能用较弱 MCP 契约给较强 CLI 制造优势。若不宣称 transport 优势，可先不做这项。

观察契约与执行契约的消融继续固定入口。先选需要证明的贡献，再选上述证据；不用全交叉矩阵。

## CCF C/B judgement

当前判断：单凭现有实验加“新范式”叙述，尚不能认定 C 或 B full-paper
ready。完成清晰的契约贡献、独立范围与可用性证据后，以 C full
paper 为首个投稿目标是合理规划；B 是需要更强可推广设计洞见与最近邻区别的挑战目标，不是按请求数量达到的级别。

作为主题匹配例子，CCF [人工智能目录](https://www.ccf.org.cn/Academic_Evaluation/AI/)
将 AAMAS
conference 列为 B、ICTAI 列为 C。AAMAS 关注 Agent 技术，ICTAI 包含 AI 工具架构与机制；实际选择要核查具体 track 的范围、贡献与当届要求：[AAMAS main track](https://warwick.ac.uk/fac/sci/dcs/aamas2027/calls/call-for-main-track/)、[ICTAI 2026 CFP](https://ictai.computer.org/2026/)。这不是接收概率预测，也不意味着当前材料已满足其要求。

CCF
[第七版目录说明](https://www.ccf.org.cn/Academic_Evaluation/By_category/)明确将 Full/Regular
paper 纳入会议目录考虑范围；Short、Demo、Workshop 等不纳入同一范围。学术交流价值和单位成果认定应分别判断。

## Remaining uncertainty

“Agent-friendly
environment”已有 ACI、语义动作与工具协议工作。当前建议承认这些基础，在具体契约组织、可迁移实现和可复现条件性分析上建立差异。没有完整最近邻全文比较，不能证明 CLI 独有或该契约首创。若只能证明标准 CLI 能调用浏览器和缺失信息阻碍决策，应降低论文贡献定位。
