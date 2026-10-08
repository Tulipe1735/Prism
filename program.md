# Prism autoresearch program

本文件规定研究目标、实验达成条件和迭代流程。`prepare.py`
固定评估口径；Prism 产品源码是可改进的实验对象。

## 三个职责

| autoresearch | Prism                                       | 谁可以改                |
| ------------ | ------------------------------------------- | ----------------------- |
| `program.md` | 本文件：研究问题、范围、达成条件、停止规则  | 用户修订研究要求        |
| `prepare.py` | 任务输入冻结、metric、离线 eval、完整性检查 | 在新实验版本开始前修订  |
| `train.py`   | `src/` 中的 Prism，及直接验证产品行为的测试 | 实验 Agent 根据假设改进 |

采用 [Karpathy autoresearch](https://github.com/karpathy/autoresearch)
的固定评估、改进产品、运行、比较、保留或撤销这一循环。Prism 没有模型训练过程，不另建
`train.py` 包装层。

## 研究目标

研究外部 Agent 的浏览器环境契约：观察、目标引用、执行依据、状态校验与回执如何组织，才能让 Agent 使用、检查和组合浏览器环境。

CLI 是当前实现与部署入口。Skill 提供使用知识；MCP 可以承载同类契约。CLI 包装本身不是研究贡献。总体任务成功率显著提升不是必需贡献。Agent 负责选目标、选依据和判断完成；环境负责表达当前可执行动作、校验、输入和回执。`INPUT_ACKNOWLEDGED`
只证明输入被确认，不能证明任务完成。

只推进至多两个可证伪贡献：

1. C1：可检验的 observation/ref/evidence/request 生命周期及责任划分。真实外部 host 能完成有公开依据的动作、拒绝诊断和最终判断。
2. C2：公开依据校验的拒绝收益、合法动作误拒绝与漏检边界。需独立任务和有效控制，不能从 C1 成功直接推导。

## 第一阶段：完整 host 闭环 H1

固定两种语义目标、三个条件。页面字节、目标与 oracle 来自已锁定任务。

| 格      | 目标                                               | 达成条件                                                                                                                           |
| ------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| CH1C-01 | MDN postcard：Your message 填 `Research postcard.` | 正确引用与依据；实际 input 指向 msg；原生 value 正确；再次观察的公开值进入后续真实模型请求；最终明确据此确认；关闭 session         |
| CH1C-02 | The Internet dropdown：选择 Option 2               | 正确引用与依据；实际 change 指向 dropdown 且 value=2；原生状态正确；公开已选值进入后续真实模型请求；最终明确据此确认；关闭 session |
| CH1C-03 | CH1C-01 首次观察采集后、交付前禁用控件             | 扰动确实发生；拒绝且无实际输入；goal=false；模型读到拒绝反馈；最终说明未完成及原因，不虚报成功；关闭 session                       |

这三格只有两个独立语义目标、两个来源家族、一个 host 和一个模型。稳定条件测目标完成；禁用条件测正确诊断。拒绝不能计为目标成功。主指标
`contract_completion`
是三格通过完整条件的比例，越高越好。它是受控契约可行性分数，不能当作总体网站成功率或论文新颖性评分。

明确最终判断是语义问题。`prepare.py`
自动核验可测事实，并导出复核模板。复核人必须引用最终文本，并判断是否有公开依据、是否虚报完成。缺少复核时主指标为
`null`，只输出通过数量下界与待核验格数。不能把关键字匹配、原生 oracle 或研究者总结当成 Agent 的最终判断。

Go：三格均通过。Mixed：动作正确但最终判断、反馈使用或收尾未达成。Stop：计数失控、上游故障、研究者接管或绕过 Prism；保留轨迹和失败分母。H1
Go 只支持这些受控条件下的可行性，不能说明完整论文已成立。

## 第二阶段：机制证据 M1

先做零模型资格，再申请独立机制实验。资格须同时满足：目标 offered，必要关系公开且足以辨别目标，正确/错误/无输入 oracle 能区分，任务在语义签名和来源上独立。未通过的候选必须保留。

比较 Bound / Neutral-unbound /
Marked-unbound。只改变候选与组的关联边，保持候选、词汇、顺序、ref、后端、校验与回执相同。Neutral 删关联而不添加
`??`、unknown、missing 等拒绝暗示；全局组词仍保留，其它字段不能泄漏对应关系。Marked 单独测显式缺失标记的影响。

必要关系失效、非必要字段变化、目标不可执行分别统计。分别报告错误执行、合法动作拒绝、必要依赖遗漏、弃权、拒绝后完成和调用量。只在 Marked 出现差异时，结论收窄为标记效应。只在研究者提供依赖的控制器中有效时，不能宣称自主依赖选择有效。H1 的三格评分不适用于 M1；新任务、新指标和预算要在新版本中先冻结。

论文达成条件：独立可复现的实证发现；最近邻工作逐字段、逐故障场景比较；任务独立性与控制有效；原始轨迹、失败和修订可复核；结论限于验证范围。Atomicity
for Agents、typed actions、ATR、BrowserGym、Playwright
MCP、agent-browser 已覆盖多项一般原则。相等性检查不提供事务原子性保证。若只复现缺信息不能决定与经典 stale 检查，应收窄为系统工程报告或机制短文。

## 固定评估边界

实验 Agent 可改
`src/`，并修改与产品变化有关的产品测试。每轮只改一个可解释假设，遵守现有模块边界和 AGENTS.md。

同一实验版本内固定：`prepare.py`、本文件、`evals/`
研究工具、任务、来源字节、oracle、扰动时序、host 提示、原样 Skill、host/model/provider、请求上限和零重试。需要改这些项时，结束本版本、保留负结果、说明修订、另冻结；不同版本不直接排名。不为提高分数更改目标、删除难例、猜引用、泄漏 oracle 或放宽完成条件。Prism 产品测试负责回归验证，研究 oracle 必须独立于候选产品。

## 准备、评估与循环

只读检查当前状态，保存基线；先完成所选协议的零模型部署、oracle 和请求计数预检。不要并发占用另一实验的浏览器、session、state-dir 或固定输出目录。

```sh
# 列出固定指标和预算；不访问模型或浏览器
python3 prepare.py

# 新版本开始前冻结固定输入；目录必须尚不存在
python3 prepare.py freeze --out work/autoresearch/h1-baseline

# 检查固定输入；产品源码变化另列，允许作为候选
python3 prepare.py check --freeze work/autoresearch/h1-baseline

# 读已保存的 H1 原始记录；结果写入独立新目录
python3 prepare.py eval \
  --study work/codex-prism-completion-2026-10-05 \
  --out work/autoresearch/h1-review

# 复核 review-template.json，另存 reviewed.json，再计算完整指标
python3 prepare.py eval \
  --study work/codex-prism-completion-2026-10-05 \
  --review work/autoresearch/h1-review/reviewed.json \
  --out work/autoresearch/h1-scored
```

`prepare.py`
不调用 host，不执行付费实验，不替代实际请求网关。以上对已发生实验的评分须标为事后评分，不能冒充模型调用前预注册。新候选在运行前冻结输入，并在 eval 时传
`--freeze`
做完整性检查。实际 host 执行继续使用所选版本的冻结 runner；运行命令见该版本协议。

每轮：记录单一假设和可反驳预测 → 改 Prism
→ 做相关验证 → 在独立目录运行已授权实验 → 用相同 prepare/输入评分 → 记录结果 → 保留或撤销。不引入临时兼容层。共享工作区内不 reset 或撤销他人的改动。撤销候选只涉及本轮产品改动，失败轨迹和研究日志保留。

实验日志使用 `results.tsv`，列为
`candidate, hypothesis, eval_version, score, pending, requests, status, artifacts`。status 使用 keep
/ discard / crash /
incomplete。指标上升且没有完整性、错误执行、误报或协议退化才可 keep；指标相同只在实现更简单且已验证行为相同时保留。预算耗尽与未完成留在三格分母内；不能静默重试后挑最好一次。普通产品修复可以继续；不得自行续费、扩大请求预算或启动新模型批次。

## 请求预算与正在执行的实验

H1 当前固定每格最多十次、三格总上限三十次真实模型 HTTP 请求，零自动重试。失败、压缩与续轮计入；未用额度不转移。这是可比性约束，不是新增调用授权。

2026-10-06 的并行对话“开展 Prism 浏览器契约研究审计”执行了
`evals/codex-completion-v1/protocol.md` 与 `continuation.md`
对应实验。首格已调用八次且原始 host 事件显示完成；汇总中断另保留恢复记录。后两格各最多十次，本次执行上限二十八次，实际共二十六次。续跑前更换了专用浏览器：首格 Chrome
153，后两格 Chrome
154。版本变化有独立修订记录，三格不能作为同一冻结浏览器上的性能对照。让该对话完成当前冻结实验及归档，不要改其源码快照、runner、任务、计数器、输出、原始记录或协议。本入口新增后离线评分，不影响其当轮标准。

## 依据

- `evals/codex-completion-v1/protocol.md`、`continuation.md`：当前 H1 达成条件与预算。
- `evals/environment-contract-v1/qualification-protocol.md`、`next-model-protocol.md`：资格与 M1 控制。
- `docs/research/environment-contract-research-progress-2026-10-05.md`：主张、证据层级与缺口。
- `docs/research/direction-decision-2026-10-05.md`：条件性依赖选择问题与停止规则。
