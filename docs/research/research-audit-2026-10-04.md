# Research Audit Report

审计日期：2026-10-04（Asia/Shanghai）。项目：Prism / Visual SWE Harness。仓库基线：`f0a03f4`，审计开始时工作区无已跟踪改动。

**结论：存在值得推进的 empirical contribution，但当前还不能把“关系绑定是收益来源”当成已完成的因果机制证明，也不能声称一般浏览器任务上的优势。最值得押注的是：目标可辨识性取决于动作描述是否暴露任务所需的实体—群组关系，而不是描述长度或名义上的 context level。**

本文先重建已有研究，再提出实验；所有建议均未执行模型调用。原始结果、冻结协议、历史报告与源代码均保持原样。本文的解释、交互效应重分析与新实验设计属于 **post-hoc audit**，不追认成原实验的预注册假设。

审计产物：

- [独立复算脚本](/home/tulipe/projects/prism/work/research-audit-2026-10-04/audit.py)
- [机器可读证据与完整逐任务效应](/home/tulipe/projects/prism/work/research-audit-2026-10-04/evidence.json)
- [所有已审计失败的证据索引 CSV](/home/tulipe/projects/prism/work/research-audit-2026-10-04/failure-index.csv)
- [当前 schema 验证记录](/home/tulipe/projects/prism/work/research-audit-2026-10-04/schema-verification.json)

复算命令：在仓库根目录执行 `python3 work/research-audit-2026-10-04/audit.py`。该脚本只写新的审计目录，不重生成历史报告，不访问模型服务。`work/` 被 Git 忽略，分享论文材料时必须另外保留；本报告位于可跟踪的 `docs/research/`。

## 1. Executive verdict

1. **有研究贡献的基础；尚未具备强机制论文的完整证据链。** 工程能力不是贡献本身。贡献候选是受控的 scope-conditioned grounding 效应，以及 external validation 揭示的失效边界。
2. **最强证据是合成 structural 子集上的固定 representation 对比。** GLM：Structural 18/20、Local 5/20，+65pp；DeepSeek：20/20、5/20，+75pp。两个模型的任务聚类区间均为正，但每个子集只有四个任务簇。
3. **“Structural 普遍更好”必须删除。** Local 类任务上 GLM Local 18/20、Structural 17/20；DeepSeek 两者 20/20。外部页上 Structural−Local 两模型都仅 +1/45，即 +2.2pp，区间跨零。
4. **“更多 context”不是已隔离的机制。** 当前 Structural 同时改了 container、nearby 文本长度和 section；最有解释力的新增信息是 control→section/legend 的映射，但尚无等长度、等词汇、仅改变关系绑定的消融。
5. **位置混淆是最紧迫的内部效度问题。** GLM `paper-structural-02` 的三个 Local 描述完全相同，仍 5/5 成功，正确目标固定在第一项。DeepSeek 同任务 4/5；这是与位置偏好相容的成功，不证明 Local 解出了 Supplier relation。
6. **Adaptive 是可行性证据，优先作为附属结果。** 它是目标无关的确定性字符串碰撞策略，不是学习到的 policy，也不读取 failure。表示估计节省成立；非劣效、最优 context、跨模型稳定 strict success 均未成立。
7. **DeepSeek 的 Adaptive 下降主要涉及输出和终止，而非已证实的 under-expansion。** 合成集 grounding 58/60 对 60/60，strict 52/60 对 60/60；六次先正确点击后 BLOCKED。不能据此声称“扩展策略随模型改变”。
8. **External validation 是边界证据，不是 broad replication。** 15 个任务来自四个组件/演示源族，13 个本地重放、两个 live 页。重复表格中的 Structural 仍无法呈现表格身份；password 控件被共同 extractor 排除；初始空 observation 和终止失败不可归咎于 context scope。
9. **Evaluation 分层应进入当前论文的方法与结果解释，不宜现在扩成第二主线。** 已有 first-grounding / strict 指标与实际方向反转，但没有完整、独立验证的六层 oracle；external adapter 还有失败标签同步问题。
10. **最小下一步是一个位置平衡的关系消融 cohort，加一个独立 DOM 的小规模转移检验。** 不需要追 SOTA、第三模型、全量 WebArena 或复杂反馈架构。现在可以写引言、方法和已有结果；完成这两个证据补丁后冻结实验。

## 2. Reconstructed research model

### 2.1 仓库、证据范围与不存在的材料

已检查根目录 README、AGENTS、依赖与 Git 状态；`src/` 的浏览器观察、action space、决策解析、agent loop；`evals/` 的 tasks、cohorts、fixtures、runners、success oracle、taxonomy、analysis、reports 和 results；`tests/evals/` 的表示、Adaptive、confirmatory、replication、external 与浏览器 oracle 检查；`work/adaptive-context/` 的历史分析路径；`.scratch/execution-feedback-study/` 的协议、实现计划和离线诊断。历史 v2 method 还通过 `primary-source.tar.gz` 检查，未把当前 v3 parser 强加给旧结果。

| 位置 | 实际作用 | 审计要点 |
|---|---|---|
| `src/browser/` | CDP session、DOM snapshot、guard 与输入 | 无视觉模型输入；截图是可选记录，不是当前模型的 perception treatment |
| `src/runtime/` | indexed action space、TypeSafe production decision、验证与恢复 loop | production transport 与 experiment policy 不同 |
| `evals/runners/` | 生成式模型适配、描述 formatter、Adaptive、collector、调度与分析 | representation treatment 是 eval-only |
| `evals/tasks/`、`evals/fixtures/` | 手工合成任务与 oracle | category 与 minimum-level 是设计注释，不是人群统计学标签 |
| `evals/external/` | 外部原始页重放、目标审计、preflight、独立状态检查 | source DOM 外部撰写，任务目标与评估选择仍由研究者制定 |
| `evals/results/` | 原始 JSONL、sidecar、源快照 | 大部分原始数据不由 Git 保留 |
| `evals/reports/`、`evals/analysis/` | 统计与事后解释 | 部分 Python 脚本会重写已有报告，不能为了审计直接运行 |
| `.scratch/execution-feedback-study/` | 后续反馈研究草案与诊断 | 无已完成的新反馈干预 cohort；不能算效果证据 |

明确未发现：已完成的 WebArena/BrowserGym/open-web 主 benchmark；第三模型 cohort；独立第二 agent framework replication；按 readiness→eligibility→reference→decision→execution→termination 六层分别校验的完整 oracle；关系字段的原子消融；正式非劣效 margin；各模型真实 tokenizer 对 representation 的计数；模型随机 seed 控制；已完成 execution-feedback-v1 模型实验。已有原始结果以 JSONL 为主，未发现相关实验 CSV；本审计另外导出失败索引 CSV。没有从文件名推断这些材料存在。

### 2.2 研究时间线与真实样本

以下是不同证据阶段，**不能合并成一个样本**。

| 证据编号 | 原始文件/配置 | 真实完成情况 | 可用地位 |
|---|---|---|---|
| E0 | `results/archive-milestone-1/sample-scripted.jsonl` | 14 tasks × 2 repeats × 3 arms = 84 runs，schema v1 | scripted 工程机制检查，非真实模型泛化证据 |
| E1 | `results/pilot.jsonl` | 24 × 3 × 4 = 288，schema v2 | 固定 GLM exploratory pilot |
| E2 | `results/main.jsonl` | 24 × 5 × 4 = 480，schema v2 | 固定 GLM main；与 pilot 共用任务，不是新任务复制 |
| E3 | `results/ambiguity-initial.jsonl` | 计划 800，实存 373；HTTP 500 后停止 | incomplete exploratory；M320 = 全 16 tasks × repeats 0–3 × 5 arms |
| E4 | `results/ambiguity-adaptive-v1.jsonl` | 12 × 3 × 4 = 144 | Adaptive exploratory pilot；包含复用旧 ambiguity fixture |
| E5 | `results/paper-confirmatory-v1.jsonl` | 12 新 synthetic tasks × 5 × 4 = 240 | GLM frozen confirmatory，primary contrasts 原定 Adaptive−Local / Adaptive−Structural |
| E6 | `results/paper-replication-model2-v1.jsonl` | 与 E5 相同 12 tasks × 5 × 4 = 240 | DeepSeek model replication；Structural−Local 是 replication primary structural contrast |
| E7 | `results/external-validation-v1-{model}.jsonl` | 15 × 3 × 4 × 2 = 360 | 外部 DOM transfer；模型分别分析 |
| E8 | `results/modal-before.jsonl` / `modal-after.jsonl` | 单一任务各 10 次，共 20 | 独立 sequential eligibility intervention，非 representation 主实验 |

独立审计读取上述 11 个结果文件，共 **2,229 个 terminal runs / 7,327 条 step+summary 记录**；这个数字只说明核查覆盖，不是论文独立样本量。smoke、invalid preflight、被中断的 active requests 不加入主效应估计。

用户摘要的主要数字基本可复算，但必须纠正地位：M320 不是完整 800-run confirmatory；早期“stale 10/10 vs 0/10”是 E0 中五个实际触发 stale 的任务×两次 scripted repeat，不是全部 12 个 stale-category runs。把不触发 stale 的 reordering control 算入后 full 12/12、disabled 2/12。

E1+E2 的失败共 47+80=127，支持“127 primary failures”库存说法。早期 61 tests 为历史报告/用户摘要信息，本次没有重演历史整个测试套件；E5 99、E6 102、E7 106 tests 及 browser checks 是已读取的历史 verification artifacts，不能写成本次全量重跑结果。

### 2.3 Prism 改变 pipeline 的哪些部分

| 层 | 当前实现与改变 | 边界 |
|---|---|---|
| Observation | snapshot 读可见 DOM 控件、角色、名称、状态、视口和 page key；最多 250 actions，附 WAIT/scroll | 不是完整 AXTree，不是 screenshot understanding；password/file/hidden 与部分无支持 role 元素被排除 |
| Representation | 生成 model-facing indexed target descriptions；compact/role/local/structural/adaptive；representation cohort 用 status-only page text | page title、URL 和 action history 仍可见；并非完全无全局线索 |
| Grounding interface | 模型选 operation 和代码提供的 target id；raw-selector 生成 CSS 后映射回观察节点 | 这是动作指向接口，不是另一个独立 reasoning model；实验 selector 最终仍共用 indexed executor |
| Decision | 实验用 GLM/DeepSeek 的 JSON probability heads；production `choose` 用 TypeSafe `jev-latest` 默认 transport | 本文不能把 experiment reliability 当成 production TypeSafe reliability |
| Validation | 检查 membership、概率键集合/范围/归一化、argmax，以及 confidence 为有限数字 | 不检查目标语义正确；代码没有校准 confidence，也没有基于 confidence threshold 的智能拒绝 |
| Execution | 当前 node id 重新取 DOM，freshness guard、geometry/hit test 后 CDP 输入；SELECT 有 native 操作 | 仍依赖执行瞬间的坐标/布局；减少 model-produced coordinate/selector，并非“完全不用坐标” |
| Recovery | stale 后重观察与重新提议，最多连续五次 catch；历史只纳入已执行 action | 拒绝原因不进入下次 policy context；无限重复不可由重观察自动解决 |
| Evaluation | private counter / public state checks / 外部 selector audit；first scored execution 与 strict success 分开 | 属于测量，不是给模型的 oracle；外部目标 selector 对合法 ancestor action 覆盖不全 |

直接来源：[snapshot](/home/tulipe/projects/prism/src/browser/snapshot.js)、[session](/home/tulipe/projects/prism/src/browser/session.ts)、[action space](/home/tulipe/projects/prism/src/runtime/action-space.ts)、[decision parser](/home/tulipe/projects/prism/src/runtime/decision.ts)、[agent loop](/home/tulipe/projects/prism/src/runtime/agent.ts)、[实验 model adapter](/home/tulipe/projects/prism/evals/runners/model.ts)。

### 2.4 真正被 manipulated 的 independent variables

| 变量 | 到底改变什么 | 可因果比较的限制 |
|---|---|---|
| compact→role | 从 name 为主改为 role+name；保留 value | 角色信息和字符串格式一起改变 |
| Local | 增加 associated labels / 最近语义 container 的 public text，最多 80 chars | “local”不是固定空间半径，也不是纯 token budget |
| Structural | container 类型最多 24 chars；nearby 最多 120；最近 section/fieldset/main 中首个 heading/legend 最多 48 | 不累计包含 Local 原字段；是 bundled scope，且是截断启发式 extractor |
| Adaptive | 同 operation 下真实 formatted description 完全相同才 compact→role→local→structural，按候选分别提升 | 不读 goal、私有标记或模型表现；不是 task/failure-aware selector；内部先提取完整 contexts |
| stale recovery on/off | stale 被检测后 retry/reobserve 还是直接失败 | 关闭的是恢复，不是关闭 stale detector 或所有执行 guard |
| validation on/off | 跳过概率分布、argmax 和 confidence 格式验证 | membership、mapping、executor、freshness 仍保留；不是“所有安全校验关闭” |
| indexed vs selector | 选 offered id vs 生成 CSS；selector 有额外 sanitized DOM | E3–E7 信息预算不匹配，只是 reference；E1–E2 matched DOM 更接近 target-generation treatment |
| modalPolicy | 所有 visible candidates vs 仅 native active-dialog 中 candidates | E8 独立 eligibility intervention；单页、顺序执行；不测试 aria/custom overlay 泛化 |
| model | E5 GLM→E6 DeepSeek；E7 同 provider 分模型 | effective reasoning/sampling 不一定相同；只复制同任务，不增加 task coverage |

没有独立 manipulated：完整 spatial relations、显式 sibling graph、ancestor depth 参数、label-control edge、邻居数量、token length、confidence calibration、feedback contract。这些不能写成已做过的 ablation。

### 2.5 真正测量的 dependent variables

| 指标 | 实现定义 | 建议论文角色 |
|---|---|---|
| Grounding Success | 首个 executed 且 scored 的 correct target，且该步无错执行；无 scored input 计 false | 核心 planned endpoint；名字有覆盖局限，须补曝光/覆盖率 |
| Strict Task Success | oracle checks、无 error、DONE、全程 wrong counter=0；synthetic 另要求 correct action exactly once | 共同 primary/重要 secondary；不能拿它单独解释 grounding |
| state attainment | 最终 oracle 状态成立，即使后续输出或终止失败 | secondary；不能覆盖此前错操作 |
| Correct Target Rate | correct / correct-or-wrong scored selections，含未执行 stale proposal | diagnostic，条件于被 parser 接受及 oracle 有覆盖 |
| Wrong Target Rate | audited wrong executed inputs / audited executed inputs；另给 any-wrong run rate | 关键 safety/grounding secondary；actions 非独立样本 |
| primary failure enum | 错执行优先，其后 typed error/budget/phase | diagnostic，不等于独立心理机制 oracle |
| invalid output / action / selector | probability schema、offered membership、CSS resolution 失败，分别计数 | protocol/reference diagnostic，不能互换 |
| representation cost | `ceil(UTF-8 bytes/4)`，包含 target-map serialization；selector 另含 DOM | secondary proxy；不是 model tokenizer、prompt total 或 bill |
| provider tokens | 每次 HTTP receipt 的 input/output/total，包括 reasoning；缺失为 unknown | 若论文主张 efficiency 才是 primary cost；当前宜 secondary |
| executed steps / calls / HTTP retries / stale retries / latency | collector/run summary 与 response logs | secondary/diagnostic；latency 包括 setup/oracle/cleanup |
| recovery | stale 检测后同 action step 后续输入执行 | mechanism diagnostic，不能等价成功 |
| over/under expansion / minimum match | initial observation 相对预先设计 minimum；under 还需 unresolved/failure | annotation-relative diagnostic，不是证明 minimal sufficiency 的 oracle |

没有统一 partial-success score。已有 grounding、oracle attainment 和 strict 分别度量，不应临时发明一个分数合并。没有 measured monetary cost。representation 不含完整 system prompt、goal、history、page status 或所有 Adaptive audit metadata；后者被 `chatDecision` 从实际模型 payload 去掉。

来源：[success oracle](/home/tulipe/projects/prism/evals/success.ts)、[run/firstGroundingSuccess](/home/tulipe/projects/prism/evals/runners/run.ts)、[collector](/home/tulipe/projects/prism/evals/runners/collector.ts)、[representationCost](/home/tulipe/projects/prism/evals/runners/representation.ts)、[confirmatory metrics](/home/tulipe/projects/prism/evals/runners/confirmatory-report.ts)。

### 2.6 实验单位、控制与复现事实

处理施加于 **run = task×variant×repeat×model**；对新任务推广的统计单位应为 **task，进一步考虑 template/source family**。repeat 衡量同任务在服务随机性下的稳定程度；repeat index 不是模型 seed。两模型分别报告；step/action 不作为独立实验单位。

E5/E6 的 240 cells 不等于 240 个独立任务。总体 12 个任务簇，stratum 只有 4；E7 有 15 tasks，但仅四个 source families，部分任务共享同一 HTML。E1/E2、E4/E3 的 fixture 复用不增加外部独立性。

requested settings：temperature=0、top_p=1、max_tokens=8192、provider-default reasoning；无 model seed。E5/E6 240 对 initial prompt hashes 完全相同，source hash 同为 `979167c…`；原始 browser/Node 记录同为 Chrome/153.0.8010.12 / v22.23.2。每 cohort 有独立 profile，run 开新 owned tab；未为每 run 创建全新 browser context，cookie/cache/localStorage 仍可能在 origin/profile 内共享，不能声称完全无 cached state。fixture 没有明显依赖这些持久状态；external 页仍需单独检查。

调度按 repeat→task 顺序，variant 作确定性轮转，concurrency=4；不是随机分配，也不是 time-block randomization。E7 每 cell 还 interleave model。它减弱 arm-order confounding，不消除 provider serving drift。没有 task-level retry、output repair 或失败替换；HTTP 最多三 attempts，stale retries 单独记录。中断时仅 missing cells 可 resume，in-flight batch 可能丢失且已花 provider usage。

E5/E6 raw summaries 与 steps 没有 infra events，receipt coverage 分别 496/496、520/520；E7 1019 responses 已重新与 run calls / models / prompt hashes 对齐，GLM 完整 receipt 169/180、DeepSeek 180/180。GLM 9 个 summary 有独立 infra labels，另有 11 runs 的 incomplete usage；这两个数量不等价。不能把全部缺失解释成 page network failure。

## 3. Evidence map

下面每项 Strong 都限于写明的任务和实现。不能把局部 Strong 理解为“browser agents generally”的 Strong。来源编号对应 §2.2；所有数字来自原始 JSONL 复算或已核查的分析实现。

| Claim | Evidence / 性质 | Replication / coverage | Confidence | 最可能 objection | 最小能提高 confidence 的工作 |
|---|---|---|---|---|---|
| 1. Structural 在 structural ambiguity 改善 grounding | E5 18/20 vs 5/20，+65pp [10,100]；E6 20/20 vs 5/20，+75pp [40,100]。同 task 改 representation 的受控 bundled intervention，支持样本内因果效果；原子 relation 原因未隔离 | E3 nested/legend 探索与 E5 新 fixture；E6 同 4 tasks、第二模型；E7 总体 +2.2pp，两 CI 跨零 | **Strong（合成样本内）；Weak（一般外部页）** | 手工任务贴合 extractor；位置/长度/绑定一起变化 | P0-A/B 新实验中的位置平衡、词汇匹配 relation 消融；不补第三模型 |
| 2. Local 足以 local ambiguity | E5 local 18/20，wrong=0；E6 20/20。描述性 sufficiency 与受控更丰富对比；“足够”限于这些目标，而非唯一最小 | 4 local tasks，两个模型；E3 多 nearby/table tasks；E7 无 minimum annotation | **Moderate** | ceiling effect；没有 compact/role confirmatory arms；不能由 100% 证明 population sufficiency | 同模板 local-vs-group 目标切换，保留 compact/Local 针对性探针或用已有探索说明 lower-level collision |
| 3. More context is not universally better | E5 local Structural−Local −5pp [−15,0]；E6 0，且全局 inference saving unresolved。足以反对严格单调收益，不能证明丰富 context 普遍有害 | 同四 local tasks，外部总体 mixed；formats 不 strictly nested | **Moderate** | 无优势≠等价；Structural 格式不同而非只多信息 | 同字段累积、长度控制；把文字改为“没有一致优势”，无需大规模等价实验 |
| 4. Context benefit depends on ambiguity/failure type | E5/E6 structural vs local strata 差异明显；本审计 post-hoc interaction +70pp [10,105] / +75pp [40,100]。不是“一个显著一个不显著”的推理，但类别跨 task，尚非随机 moderator 因果证明 | 两模型同 tasks；E7 区分真实控件缺失/ready/termination 边界 | **Moderate** | 类别与模板、正确位置、操作和完成反馈混淆 | 同 DOM 模板下改变目标所需 relation，并平衡位置；预注册 interaction |
| 5. Adaptive 减少 representation cost、保持多数 grounding | E4 success 33/36 vs Structural 35/36；E5 first size 48.67 vs 75.33（−35.4%），grounding 56/60 vs 53/60；E6 58/60 vs 60/60。cost 是 deterministic proxy，表现只 descriptive | E7 task representation −66.8%/−68.4%，但 DeepSeek wrong 3 vs 2；total usage 两模型 CI 跨零 | **Strong（proxy savings）；Moderate（高描述性 grounding）；Unsupported（非劣效/total savings）** | 刻意构造 collision；saved estimated chars 不是实际 inference efficiency | 若保留附属结果，不需新 cost campaign；若升主线，另预注册 margin/power，测完整 receipts 与 strict |
| 6. Adaptive policies are model-sensitive | E5 Adaptive−Structural grounding +5pp [−5,15]、strict +5；E6 −3.33 [−8.33,0]、strict −13.33 [−23.33,−5]；六 Adaptive strict-only 都先正确后 BLOCKED | 两模型、一个 provider/协议；initial levels 完全相同；E7 grounding方向同样不同 | **Strong（结果描述）；Moderate（跨模型 effect difference）；Unsupported（策略本身随模型改变）** | 两个 endpoint-model 不分离模型、reasoning、服务状态；没有跨模型 interaction 正式检验 | 先定位 terminal cases，不必跑第三模型；同完成态固定 observation 的 terminal-only follow-up 若论文需要原因 |
| 7. Stale recovery 因果改善 robustness | E2 stale full 24/30 vs disabled 5/30，+63.3pp [30,96.7]；五触发任务 19/25 vs 0/25；E0 scripted 10/10 vs0 | GLM一个模型，6 stale-category tasks；E1方向一致但同 fixtures；E7 无 stale events | **Strong（注入扰动）；Weak（自然动态网页）** | 注入时点正是 decision→execution，disabled 按设计失败；modal 全失败 | 主论文附属历史机制，无需扩展；若独立 robustness paper，需要自然state change/eligibility边界复制 |
| 8. Action validation 防止 wrong-target execution | E0 人工 argmax fault 的两次 wrong inputs 有 prevention 证据。E2 full0 wrong、no-validation0 wrong，后者 success112/120 vs100/120，+10pp [2.5,17.5]。格式一致性不是语义正确性 | 仅 scripted specific fault；real GLM main未支持通用安全收益 | **Weak（人工故障）；Unsupported（泛化语义保护）** | 使用 self-reported probability heads，人为 schema 惩罚；有效概率也能错 | 删除一般 claim；若必须研究 validation，独立choice-membership vs full-head validation，不放 representation 主论文 |
| 9. Raw selectors 未必是强 semantic interface | E2 success99/120 vs100/120，差值−0.8pp [−10.8,7.5]；可有 hidden multi-match；但 E5 reference57/60，E7 DeepSeek45/45 grounding | GLM/DeepSeek，多个阶段；information mismatch 使后续 reference 非因果 | **Weak** | baseline共同executor/隐藏CSS兄弟不可见；后续selector有更多DOM | 改写“selector syntax alone does not guarantee semantic identity”；欲声称interface优劣需等信息量baseline，否则不做 |
| 10. 混层 metric 可掩盖/反转机制结论 | E6 Adaptive grounding58/60但strict52/60；E7 DeepSeek Structural−Local grounding+2.2pp而strict−6.7pp，Adaptive−Structural grounding−4.4而strict+6.7。已观察符号不同，CI未证明外部稳定排名反转 | E1/E2/E5/E6/E7 有具体grounded→terminal failure；E7 tabs有oracle覆盖反例 | **Strong（存在性描述）；Moderate（一般方法论）；Unsupported（全六层独立oracle）** | 换estimand不是证明原success metric错误；条件分析可能选择偏差 | 先离线reconcile endpoints、derive交叉表与coverage；只有升evaluation主线才要同轨迹多oracle与controlled failure injection |

没有 claim 获得“universal”“SOTA”“zero error risk”“optimal/minimal sufficient representation across the web”的支持。

完整字段与任务效应在 [evidence.json](/home/tulipe/projects/prism/work/research-audit-2026-10-04/evidence.json)。E5 主对比原为 Adaptive；不要把现在选择 Structural−Local 为论文 headline 写成 E5 唯一预注册 primary hypothesis。E6 protocol 则明确预先指定该 structural contrast。学术诚实的叙述是：探索→新 fixture confirmatory representation study→同任务跨模型复制→external transfer→事后提出关系绑定机制。

## 4. Strongest empirical findings

### 4.1 固定 scope 的局部效应比 pooled success 更稳定

| 条件 | GLM Local | GLM Structural | DeepSeek Local | DeepSeek Structural |
|---|---|---|---|---|
| structural tasks | 5/20 | 18/20 | 5/20 | 20/20 |
| local tasks | 18/20 | 17/20 | 20/20 | 20/20 |
| overall grounding | 40/60 | 53/60 | 45/60 | 60/60 |

GLM overall Structural−Local 为 +21.67pp [−3.33,48.33]，并不与 structural 子集 +65pp 矛盾：它们回答不同问题。应该报告 task-level contrasts 和 stratum effects，而不是用 pooled ranking 讲“Prism提高成功率”。

GLM structural 四任务效应依次 +100、−20、+100、+80pp；DeepSeek +80、+20、+100、+100pp。所以 **不能写两模型所有 structural tasks 都一致正收益**。GLM legend 任务是反例，不能删；它同时暴露 first-position shortcut 与 Structural 一次 protocol rejection。

本审计新增的 class-interaction CI 是 post-hoc stratified task bootstrap。GLM上限105pp是两个rate differences之差的允许范围，不是成功率超过100%；只有四簇，数字是诊断，不能替代后续同模板 moderator 实验。

### 4.2 M320 强探索，不能追认为完整 confirmatory

M320（每臂64）：compact9/64、role12/64、Local48/64、Structural58/64；any-wrong runs38、32、7、0。用户摘要59.4%/50.0%/10.9%/0是 **run-level any-wrong**，不是wrong actions / actions。

Local 的14次wrong execution全部集中在 `grounding-study-007` nested（9次）和 `016` legend（5次）。另有 West-region 类任务 Local 失败但无 wrong execution，涉及 BLOCKED/deadline，不能把全部 Local failures归纳成误选。

M320取 repeats0–3 是完整匹配 block，不是抽出成功 runs。但选择这个统计 subset 是中断后的分析决定，应标 exploratory complete block；实存373的unmatched rates不能替代它，缺失427不能视作随机删失。

### 4.3 Adaptive 表示节省真实，end-to-end 优势不成立

| 条件 | Adaptive−Structural grounding | strict | initial representation | total provider tokens/task difference |
|---|---|---|---|---|
| GLM synthetic | +5pp [−5,15] | +5pp [−5,15] | −35.4% | −192.10 [−440.80,18.02] |
| DeepSeek synthetic | −3.33pp [−8.33,0] | −13.33pp [−23.33,−5] | −35.4% | −24.27 [−131.87,115.85] |
| GLM external | +11.11pp [4.44,20] | +2.22pp [−13.33,15.56] | task-total representation −66.8% | +687.76 [−435.51,1844.53]，41 matched complete receipts |
| DeepSeek external | −4.44pp [−17.78,6.67] | +6.67pp [−4.44,22.22] | task-total representation −68.4% | −765.69 [−2365.91,699.67]，45 matched repeats |

synthetic 的两次35.4%是同输入、同deterministic policy的计算复现，**不是第二批独立场景验证**。external减少表示暴露是新DOM证据；但GLM calls/latency增加，total cost未获支持。

Adaptive−Local synthetic total usage差异为GLM−1693.47 [−3410.57,−288.13]、DeepSeek−2429.85 [−5487.85,−361.65]。这说明遗漏关系导致的长失败轨迹可比更宽representation更贵；不能据此推出Structural也更贵，更不能推到货币节省。

### 4.4 External negative result 改变故事边界

Structural−Local external grounding都是+1/45，GLM CI [−13.33,15.56]pp，DeepSeek [−6.67,11.11]pp。只有一个 task 记录 Local collision；所以它既不能推翻controlled required-relation effect，也 **没有建立该effect在真实DOM上的复制**。

`external-multiple-tables` 在同一task上的描述保留两个相同`textbox "Search:" / container: group / nearby_text: Search:`，没有table identity。GLM Local/Structural/Adaptive grounding皆0/3；DeepSeek分别0/3、1/3、0/3。所有达到Structural的Adaptive runs仍有unresolved collisions。重点不是“最高级别输了”，而是 **最高级别并没有提供需要的区别信息**。

### 4.5 验证与恢复两条机制不能当作一个“Prism”收益

E2 no-validation提高overall success，且没有新增wrong execution。这是负面结果，必须保留。E2 stale recovery提升injected stale subset，E8 modal过滤又将单页0/10提升至9/10（oracle10/10）。这些效果发生在不同层；用一个overall “full vs ablated”总结会误导。

## 5. Weak / unsupported claims

必须从摘要、引言与结论删除或限制：

- “Structural context is necessary for browser agents.” 改为对指定不可区分控件的关系需求；固定位置碰巧成功已经反驳逐次必需。
- “Richer context is always better”或“richer context generally harms agents”。现有证据只支持没有一致优势与特定失败集中，formats还不嵌套。
- “Adaptive is non-inferior / equivalent / generally better”。没有margin；DeepSeek strict差−13.33pp，external也有wrong executions。
- “Adaptive learns the task's minimum context / chooses according to failure”。现有策略不读goal/failure，也不学习；whole-space collision不同于goal-required ambiguity。
- “Adaptive uses less information acquisition”。它先计算公共context用于比较，只是少暴露给模型；没有测DOM读取成本/计算成本节省。
- “Prism prevents wrong semantic actions through validation”。概率一致性没有语义oracle；有效heads也可错误。
- “Indexed targets outperform selectors”。主实验差异CI跨零；后续DOM信息不匹配；external reference可能显著更好但不能反向因果推论。
- “35.4% fewer inference tokens / lower bill”。该数是initial target-map估计；total推理token对Structural未显著减少。
- “Zero wrong targets”。只能“在这两个合成cohort中观察到0”；external DeepSeek Adaptive有3次。
- “Cross-model policy generalization”。同task、同provider、同prompt；固定policy的选择完全相同，model-sensitive的是行为结果。
- “Mixed-layer metrics are invalid”。Strict衡量真实完成是合理指标；错误是用它推断representation cause，或者把未曝光的失败全算语义误选。
- “Failure taxonomy identifies cognitive mechanisms”。`SEMANTIC_AMBIGUITY`目前根据task category+wrong counter赋值，非独立证明 ambiguity是原因。
- “The new feedback protocol cannot fail as a paper”。draft的“RQ1 cannot fail”“paper stands on contract”不是科研保证；常见loop现象或event schema未必是创新。

现有cross-model解释可谨慎写成：**在共享合成任务上，固定scope的结构类效应比输出/终止行为更稳定。** 不能升级为“fixed mechanisms generalize better than learned policies”：当前没有learned policy comparator，也没有统计比较两种泛化能力。

## 6. Failure taxonomy

### 6.1 从已有行为证据归纳的分层，而非接受预设类别

| 层/故障 | 直接证据 | Representation-bound? | 有效机制 / 无效机制 |
|---|---|---|---|
| Readiness / observation availability | external modal/create、dismiss、accordion首观察全空；tabs GLM11/12、DeepSeek12/12初始空 | 通常否；不存在candidate时formatter无从绑定 | 等待/就绪观察可帮助；scope扩大不能生成尚未出现控件 |
| Eligibility / capability exclusion | snapshot明确排除password；signin/modal-create全variant strict0 | 否；动作根本未offered | 修action-space capability才可能；representation/recovery都无效 |
| Information loss / reference identity | synthetic Local相同Draft/Account/Setup；external重复Search两表身份未传入 | 是，但须确认任务所需身份与formatter缺失的对应关系 | 暴露正确group mapping；名义Structural但不暴露table identity无效 |
| Reference syntax / mapping | CSS syntax/no-match/multiple-match/ineligible；hidden sibling可造成多匹配 | 部分是reference interface问题，非全为semantic context | locator/visible eligibility规则影响；和target语义区分开 |
| Decision / semantic selection at adequate scope | enough distinctive descriptor仍选择错误；postgrounding点击distractor | 不自动归于信息不足 | 决策、目标跟踪可能重要；仅scope扩大不保证修复 |
| Protocol output | probability keys缺失、scalar head、invalid JSON、无final content | 通常否；可能受ambiguity影响reasoning长度但只是相关 | parser/transport/schema设计；不能由“有更多词”直接解决 |
| Execution staleness / occlusion | injected detach/state change；modal背景Save被hit test拒绝 | 否或另一个state representation问题 | stale reobserve在detach有效；modal eligibility mismatch需要filter/反馈等另层机制 |
| Recovery loop | rejected attempts不进history，反复同target；modal-before0执行 | 不是local-vs-structural上下文机制 | eligibility过滤的单fixture干预有效；feedback仍待测 |
| Termination / completion interpretation | DeepSeek六Adaptive先正确后valid BLOCKED；GLM Structural先正确后七wrong点击 | 不可把初始grounding失败当原因 | 需完成状态/终止决策；scope可能影响但因果未隔离 |
| Budget/provider failure | HTTP500中断E3；external usage missing；reasoning耗满8192 | 不是天然semantic error | 独立记录provider/length/retry；不能删除受影响runs |

原始typed taxonomy参考 [failure-taxonomy.md](/home/tulipe/projects/prism/docs/evals/failure-taxonomy.md) 与 [classifyFailure](/home/tulipe/projects/prism/evals/failures.ts)。CSV保留原始primary label并添加observed flags，没有用新taxonomy重写raw或猜测模型心理原因。

### 6.2 Representation-bound 的证据要求

建议定义为：在 **任务相关控件已出现、可被offered且可执行** 的状态中，不同合法目标需要的身份/关系信息没有被当前representation保留；对同state改变信息绑定后grounding恢复。现在前半段可从descriptions/oracle确认；后半段仅在bundled Local→Structural干预上成立，原子relation机制待验。

最可信：E3 nested/legend、E5/E6 group-target tasks的相同Local而不同section描述。可疑但有价值：external重复表格在Structural仍相同，需要table relation的外部证据；多次无model content不证明这些具体runs“误解了表格”。不应归入：password缺失、empty observation、正确动作后的BLOCKED、纯probability头错误、provider异常。

### 6.3 重要全臂失败边界

- 原始delayed-modal主实验20/20失败。观察器把被modal遮挡的background控件仍当可见候选，执行器正确拒绝，policy无failed-action history。不是“多加context词”可解释的失败。E8 active-native-dialog过滤0/10→9/10支持eligibility机制；仅一个fixture与一模型，不能推出一般occlusion算法。
- external-signin-fields 与 external-modal-create 两模型全部arms strict0/3；共同password exclusion足以造成任务无法完成。某些first-step grounding高不能遮掩action-space incompleteness。
- external重复tables：GLM全部arms strict0/3；DeepSeekselector strict2/3但indexed各0/3。因此不是所有模型所有variant都失败；这个reference保留了成功可达证据，不应把任务判成无效删掉。
- tabs的某些strict successes没有scored grounding。该事实指出测量覆盖不足，不是“人类成功但agentgrounding失败”的认知发现。

### 6.4 实际日志例子与分类漏洞

1. E6 `73a0022a-8c58-4380-b5d1-85906eba890d`：local-04/Adaptive，先CLICK correct，再valid BLOCKED，grounding=true / strict=false。说明终止层，不是under-expansion。
2. E5 `c1535cfb-d2a5-4384-a13c-47989492d107`：Local类/Structural，第一次正确，随后七次wrong点击。summary `SEMANTIC_AMBIGUITY`不能用于声称初始目标选错；七actions来自一run，不能当七独立样本。
3. E7 `abc6ebc1-62b8-468a-928e-631b7e6729db`：GLM重复tables/Structural，两个Search描述相同，但该run无usablemodelcontent。能证明representation未区分，不能证明已执行wrong。
4. E7 `ee7374a3-2665-49f7-8b8a-9ccbc67f017e`：DeepSeek重复tables/Adaptive，错误TYPE_TEXT后invalidJSON。正确的首要 grounding 标签不能遮掉后续outputfailure。
5. E7 `f6c99076-9415-4ff6-8ec5-bf9a8071f946`：DeepSeekdelayed-content/Adaptive先正确Start，后点击Elemental Selenium并到8-actionbudget，最终HelloWorld可见但strictfalse。`failure_type=null`是adapter缺陷，不是成功。

**已确认实现缺陷：** [external cohort writer](/home/tulipe/projects/prism/evals/external/cohort.ts:181) 在 `runOne` 给出summary之后增加strict/DONE/wrong条件，并覆盖success，却不重新赋failure_type。原始GLM1条、DeepSeek4条failed/null；DeepSeek其中2条有wrong execution。初始 `runOne` 对无`preregistered`的external task允许oracle attainment而不必DONE，进一步解释budget/blocked但oldsuccess为true的情况。

这不会改变已存strict/grounding点估计；它会影响summary-only failure distribution。必须以独立step/audit+state+termination维度导出派生分类，保留原label，报告5条残缺。未来runner版本修正需要新冻结，不能修改E7raw。外部audit的SELECT/TYPE_TEXT/CLICK覆盖、合法ancestor等还需独立测量测试。

## 7. Mechanism hypothesis

### 7.1 当前数据为何不只是在说“信息更多”

E5/E6 structural-01的Local三候选均`Delete / context: Draft`，Structural加入分别`section: Team North / West / South`。group字符串不是仅出现在global bag中，而是出现在 **每个candidate的描述内**，允许将goal中的Team South绑定到index3。structural-03同理把Account绑定到Region East；structural-04把Setup绑定到Project Harbor；legend任务把Invoice绑定到Supplier。

真正候选机制：**目标身份来自操作控件→局部实体→更高群组的关系链。** 在不同候选的局部实体同名时，省略最后一段会将不同browserentities压缩成相同语言描述。增加正确group association可恢复可辨识性。

当前实现并没有输出完整DOM/空间图。其关系组件如下：

| 可能信息 | 已实现/已测状态 | 能下的结论 |
|---|---|---|
| label-control | snapshot名称读取`labels`/aria-labelledby；context另读labels | 所有arms共同或bundle内；未隔离因果贡献 |
| ancestor grouping | 最近语义container及closest section/fieldset/main | 与成功模式直接对应；收益仍是bundle |
| legend / heading | first h1/h2/h3/legend text，绑定在candidate中 | synthetic有成功干预；external table identity无法提取 |
| sibling/neighbour text | container treewalker读非controls public text，截断80/120 | 不是显式sibling graph；文字范围与长度共同改变 |
| container semantic type | row/card/form/fieldset/group等 | 测过随scope变，但没有独立role-only机制消融 |
| resolution set | snapshot offered actions同起始state基本一致 | 当前主对比不是“更多候选集合”；不应引入这一无证据变量 |
| geometry/spatial relation | rect用于snapshot/执行 | 没有独立视觉/空间representation treatment |

两个重要边界：名字不同不保证goal relation可解；scope更宽也不保证extractor找对group。External repeatedtables恰恰说明maximumlevel≠充分信息。

### 7.2 一项最小 mechanism ablation

新实验只保留四个格式，**同一candidate set、同一公共文本、同一prompt与parser**：

- L：Local。
- U：Local + 所有group lexemes的无绑定列表；每candidate给相同词集合，与下一arm严格匹配serialization长度/词汇。
- R：Local + 正确的candidate→group关系；由公共DOM的统一规则产生，不使用correct_selector/goal/privatemarker。
- S：当前FullStructural。

实现前必须审查这个控制是否真的成立：R/U 使用相同 group 文本清单、相同公共字段和同样的名称出现次数；R 将公共群组身份绑定到候选，U 只呈现不与候选关联的清单。单独记录关联格式带来的额外字符与实际 provider input token 差异；只有核验匹配成功，才把 R−U 解释为绑定效应。不能用无关 padding 补齐长度后宣称完全控制了语言内容；若格式无法严格匹配，明确保留这个残余 confound。

关键不是R−L，而是 **R−U**：目标是词汇和长度匹配，只改变信息是否与对应 candidate 绑定。R≈S只能说明在指定tasks上有描述性接近，不能追认非劣效。按位置/DOM映射置换后，R选择应该跟随真实group关系；L/U不应靠第一个candidate持续正确。

这是 **post-hoc mechanism hypothesis**。下一cohort预先冻结H1：R的first-target成功高于U，且优势集中于goal需要group关系的条件。H0允许U也同样好：那会支持global lexical context/ordering rather than relationalbinding。若R失败而S成功，需要承认剩余bundle字段在起作用，下一次只针对该差异，不无限堆variants。

不要新增“Local+broader resolution set”作为默认arm：它改变candidatecoverage，与当前疑点不匹配。只有证明groundingfailure来自候选集遗漏，才值得另外做eligibility研究。

### 7.3 Adaptive 的独立审计与定位

定位优先级：**C（ambiguity-conditioned exposure可行性）> B（机制辅助验证）> A（efficiency method）> D（产品优化作为科研贡献）**。更准确是descriptor-collision-conditioned，而非按目标歧义选择。

策略：先生成所有contexts；以compact开始，withinoperation比较去ID的真实截断description；相同才逐候选提升，直到不同或structural耗尽；不读goal、不调用LLM选择scope。expansion是单次observation内部的formatting，不是多次LLM请求。

E5/E6 initiallevels都compact20/60、role0、local15/60、structural25/60；minimum-match55/60，over5/60都来自local-04中与goal无关的Helpcollision；under0/60。role没有finalcase，不能说四级策略都已充分测试。minimumgroundtruth是任务设计时的预期；wholeactionspace与requestedtarget不同，5次over并非五次独立overpolicycause：只是一task×5repeat。

E7两模型都42/45runs停compact、3/45到structural，所有到structural的runs都未消掉tablecollision。这一新样本几乎不测试role/localfinallevels，且没有minimumannotations，不能报告externalunder0。“无collision”等价“足够context”不成立：dynamic/termination会需要状态/任务关系，而非重复名字。

DeepSeekstrictdrop中有六次grounded→BLOCKED，两次malformedheads；没有initialunder-expansion。over与BLOCKED同现不证明over导致BLOCKED；“model-sensitiveadaptivepipeline”成立，“不同模型采取不同扩展policy”不成立。

如要正式支持“comparable performance at lower cost”：必须未来冻结业务/研究意义明确的marginδ，先明确是grounding还是strict；对每模型进行matchedtask-cluster单侧CI，要求Adaptive−Structural下界>−δ；完整receipts支持costendpoint；wrong-target有预先guardrail。设计sample size需按任务间差异/相关性模拟power，不能从当前观察区间倒推δ，也不能由CI含0宣布等价。若δ=5pp只是讨论例子，DeepSeekstrict point−13.33pp已经不满足，不能用grounding替换strict救结论。当前推荐主线不需要为附属Adaptive承诺非劣效，避免将其变成P0。

## 8. Threats to validity

按对推荐thesis的严重性排序。

### 8.1 高：task construction 与 positional shortcut

四structuraltasks在目标需要不同group的同时，正确位置分布为3/1/2/3，与四local/uniquetemplates不同。全局4/4/4平衡不等于每mechanism内平衡。正确index在repeat中固定；重复的是modelresponse而不是重新samplegoal/DOMmapping。Local5/5legend与firstposition相容，模型reasoning中又出现关于syntheticURL/layout的猜测，不能只视作randomchance。

没有直接oraclemarker泄漏证据：全部已审计modelpayload去掉representation/adaptivemetadata后私有标记扫描0命中；browsertests也验证markers不进入publicDOM。**零markerleak不能排除publicshortcut**：URL含structural/local、fixture目录，statuscompletion与任务词一致，模板为extractor设计。解决需neutralURLs+关系/位置的counterbalancing；不要动旧fixtures。

### 8.2 高：关系绑定、长度、scope和format未隔离

Local80、Structuralnearby120、section48、container24、name160、ancestor6、traversal200是多参数bundle。Structural还可能舍弃Local格式，并非strictsuperset。“Structural helps because of relations”现在是强候选解释；还不是独立mediation/因果机制结果。

任务类别又跨DOMtemplate/goal/noun/位置。现有posthocinteraction可诊断效应差异，不能排除construct与template关联。需要同模板localentity目标与groupqualified目标条件。

### 8.3 高：evaluation coverage 与failure同步

Firstscoredtarget可只检查多步flow第一步，不保证全部grounding；correcttext/optionargs不由仅检查目标元素的指标检查。E7 DeepSeektabs有3个stricttrue/groundingfalse，因indexaction选合法ancestor而frozenaudit只认anchor。不存在scoredattempt不等于wrongtarget。

external5条failed/null为真实分类缺陷；不改变点估计，但主failurehistogram必须独立reconcile。readiness空target、passwordcapability、protocolerror通常仍会使计划 endpoint 中的 grounding 失败。推荐同时呈现：计划的首次执行指标、任务所需目标是否出现/offered coverage、可评分尝试的覆盖率、目标身份正确、参数与状态正确、全轨迹错误动作、termination。

不要仅保留offered/valid-outputruns再做“效果证明”：representation会影响输出有效性和attempt，conditional过滤有post-treatmentselectionbias。plannedendpoint保持allcells，conditionalrates仅diagnostic。

### 8.4 高：外部效度弱，而且已有transferfailure

受控合成单击任务+强status反馈+三候选不代表长流程网页智能体。External15tasks集中四sourcefamilies，DataTables旧版、Bootstrap/jQueryUI演示、两The Internet 在线页面；不是独立15apps。Source作者外部不等于goal/evaluator外部。

只有externalmultiple-tables记录collision，因此不能在这个样本广泛评估“任务所需的结构关系”机制；该单taskextractor又失败。现有scope仅支持 **本生成式策略下的受控浏览器交互任务/prompt/extractor/executor**，外部组件试验用于边界、而非“一般浏览器智能体”。不需要全量benchmark才能改善这个问题，只需少量预先选择的不同 DOM 来源族、有可验证relations且非extractor规则导向挑选。

### 8.5 中高：统计单位、相关性、ceiling/floor

研究者手工templates不randomsample；taskbootstrap仅反映这个conveniencesample的经验变动。四clusters的CI尾部不稳，DeepSeeklocal20/20与Structural20/20给[0,0]不证明populationvariance0。Localstructural01/03/04的floor与fixedorder会扩大headline差异；unique/localceiling会隐藏细小伤害。

应保留pairedtaskmean/effectsize/pertaskoutcomes及CI。不把五repeat当五task；不把35wrongexecutions当35独立失败；不把两个model相同input的静态cost当新外部replication。

| 方法 | 当前适用性 | 建议 |
|---|---|---|
| Task-level paired bootstrap | 已实现seed1735/2000draws，保持repeat聚类；最符合现有effect estimand | 保留；给per-task值，小簇限制；可补leave-one-task/template-out |
| Wilson | 对单taskrepeat二元rate可描述 | n=5、0/5上界约43.4%、5/5下界约56.6%；服务响应间的相关性会违反独立repeat假设；不要全cohortiidWilson |
| Paired comparison | 同task/repeat共controls，输出randomdraw不共享seed | 主分析：先repeatwithin-taskaverage，再task/familyaggregate |
| McNemar | naive60pairtest忽略taskclusters；sharedseed不存在 | 不建议当前主分析；不能把配对当独立 |
| Exact task sign/permutation | 在四structuraltasks可展示信息不足；GLM3正1负，DeepSeek4正 | 可作为小簇敏感性，不取代随机化设计；四全正的双侧signp=0.125，说明大effect不等于强总体推断 |
| Mixed-effects model | 当前4stratumclusters/少量families，ceiling与separation明显 | 当前不必要；任务/模板扩展后才考虑，不能靠复杂模型补样本 |
| Family sensitivity | E7已有四familymeans interval；taskcorrelation更合理 | 作为敏感性而非“四family确定总体”的CI；新实验以family为cluster |

现有E5/E6CI复算与原报告一致。没有preregisterednon-inferiority。10claim不是10个预先primarytests；不要事后给所有发现p值装成confirmatory。新的P0可只定R−U主contrast，scope×goal要求interaction为次级，减少多重比较。

### 8.6 中：modelstochasticity、服务与timeordering

temperature0不保证可重复，E2 27/96task-armgroupssuccessmixed，37/96behaviorpatterns不同。repeatindex没有seed；DeepSeekthinking默认下实际采用的 temperature未被provider暴露。modelIDs/fingerprints不能保证weights版本。E5与E6不同时执行，latency不可纯归因model。请求默认reasoning是复现配置，不是完整内部控制。

记录timestamps、returnedmodel、attemptusage；新小cohort在时间块内交错arms和models。无需为了规避随机性强行增加temperature或者改prompt。

### 8.7 中：browserstate、retry、readiness、infra

ownednewtab能隔离DOM/nodecache，但同profile 中的持久存储/networkcache未逐runreset。Page.navigate返回后可能短暂仍读到about:blankcomplete；synthetic有`__prismEval`readygate，外部绝对 URL 页面不走同gate。现有初始空观察与这个控制差异相容，尚未通过独立instrumentation证明每次空结果都来自navigationrace。

Staleretry可能改变trajectory/cost；full与norecovery不同calls是mechanism后果，不是可随意抹平的confound。HTTPretry原attempt保持，但usage不全；外部 GLM 完整 receipt 子集 cost缺失可能MNAR，不能估全cohortcost优势。Internalsettling没有独立计数。E8顺序before/after单task与provider时间变化混淆，纳为机制案例，不写大范围因果泛化。

### 8.8 中低：history、archives与reproducibility

本次119 项确认实验历史清单与226 项外部实验历史清单完全一致；202 项复制实验历史清单有一处currentdrift：`evals/PAPER-STUDIES.md`。Git commit `ff40f27` 在replication结束后删掉过时“nosecondmodel”说明，没有改results/method/protocol。属于可解释editorialdrift；当前不能写“202/202仍byte-identical”。三个sourcearchiveSHA256与freeze相符，240initialpromptpairs匹配。

原始JSONL、sidecar、archives、work、scratch被ignore，干净checkout无法单独复现全文证据。Archivedsource记录dirtyGitbase是合理补救；发布需单独有版本的研究材料包，包含rawdata、frozenmethod、lockfile、protocol、analysis、hashmanifest，并说明livepage无法保证以后bytes不变。

分析脚本有posthocprose/assertion，并会重写historicalreports；例如confirmatory/replicationPython先调用reportgenerator再插入解释。不要因现在要改thesis而在原报告中重写“预注册故事”。保留纯统计export与论文解释性报告分开；本报告独立复算避免此污染。

## 9. Reviewer simulation

下面score是审计判断，不是实测评审，按6分制（6strongaccept、4weakaccept、3borderline、2weakreject）。以当前材料投完整mechanism/empiricalpaper为情境，不假定目标venue。

| Reviewer | likely score | strongest criticism | fatal concern | rebuttable concern | 最能改善score的实验 |
|---|---|---|---|---|---|
| 1. Systems / Agent | 3/6 | “一个小DOMformatter加碰撞规则，是否只是工程调参？与已有observation/actionalignment相比新增什么？” | 没有隔离关系binding；把indexedinterface/validation/recovery/adaptive混成一个贡献 | 使用CDP、共享executor、短task不是天然缺陷，若是精确因果探针可解释 | 词汇/长度匹配R−U消融，在heldoutDOMfamily用同extractor规则复现；证明可迁移的信息需求而非新parser |
| 2. ML / Empirical | 2/6 | “四structuraltasks固定位置，五repeat是伪重复；headline事后转移；CI小簇。” | 正确位置变化后收益消失，或成功源于fixtureURL/ordershortcut | 模型只两个可以接受；温度0仍stochastic有trace；完整冻结和失败保留是优点 | 同template跨goalrequirement、各correctposition、neutralURL、时间交错的预注册小cohort；familycluster结果 |
| 3. HCI / Browser-agent | 2/6 | “readiness/password能力缺失，最高scope在tables仍不知道身份；人工页面能代表哪些用户任务？” | 将组件demo当realwebgenerality；把合法ancestor成功标成groundingfailure | 单clickprobe可作为交互机制，不必假装完整工作流 benchmark；外部负面案例有价值 | 少量独立作者DOM、label/legend/table/cardrelation，先known-control+目标覆盖 oracle，原样保留unsupportedtasks |

新增一个普通第三模型很难同时解决三位reviewer的fatalconcern。一个控制严谨的关系消融，比再增加几百相同template重复更有价值。

## 10. Recommended paper thesis

### 10.1 三个可选论文故事与排序

| 排名与thesis | novelty | existing evidence | missing | burden | defensibility / risk / coherence |
|---|---|---|---|---|---|
| **1. Task-required relations and the limits of browser grounding representations** | 潜在新意是等词汇条件下candidate→group绑定的作用与scope失效边界；“context重要”本身不新 | E3探索、E5/E6conditioned固定scopeeffect、E7外部negativecases | 原子binding、position平衡、独立DOM最小transfer | 低至中：一个小factorialcohort+小transfer | 最高coherence；有正结果也有boundary；风险是收益由length/order而非binding驱动 |
| 2. Layer-aware empirical auditing of browser-agent representations | 精确可复用的exposure/identity/终止 estimand与counterexample有方法价值；分层本身不足称新 | 已有grounded→termination差异、外部方向相反、eligibility/readiness例子 | oracle合法动作覆盖、endpoint 与分类验证、第二pipeline应用 | 中；独立论文要中高 | 当前宜methodology；若R−Unegative且多层classification能可靠复用可pivot，不能靠自家bug做核心“发现” |
| 3. Descriptor-collision-conditioned context exposure | 简单透明policy的可行性与失败条件；节省token的单独新意弱 | 两syntheticmodel+外部表示估计减少，固定policy完整trace | 非劣效/strict保真、totalcost、task-relevantcollision与跨来源族泛化 | 如升主线为中高 | 有strictdrop与externalwrong，风险最高；适合作为附属proof-of-feasibility，不用NI救论文 |
| 4. Execution rejection feedback and loop-breaking | information-vs-control干预可能有systemmechanism价值 | main/modal离线rejectionloop，E8eligibility干预；目前只有draft | 新cohort、真正feedbackA/B、明确成本margin、newfamilies | 高于推荐主线 | 与表示研究论文机制不同；不能现在仅凭trace宣布feedback有效；优先留作后续工作 |

**只选第一条作为当前主线。** 第二条承担评估方法；第三条作为有限scope的extension与负面结果；第四条不进入当前P0。

### 10.2 推荐scientific insight与可写thesis

核心洞见：**动作目标的可辨识性是relation-specific的。更多文字或更高名义scope，只有在其提供了所需candidate-to-entity/group映射时才可能修复该类grounding；而不同层的失败可能使同一表示干预在first-grounding和strictsuccess上呈现不同效果。**

目前可防御的论文主张句：

> We show that, in controlled browser interactions across two models, richer action descriptions improve grounding chiefly when they expose the group relations needed to distinguish the requested target; external-page failures delimit this effect when target identity remains unexposed, controls are excluded, or readiness and termination fail.

“chiefly”是观察到的条件效应模式；不要改成已隔离的“relations cause the gain”。若P0R−U成功，才升级为“binding candidates to required group relations,rather than adding the same unbound context,improvesgrounding”。如果P0失败，就删除关系绑定的因果升级，保留scope / representation bundle的empiricalfinding，或者pivot到可靠evaluationaudit。

不选择Adaptive主线，因为最强crossmodel事实是固定scopeeffect，Adaptivestrict保真失败而totalcost没有优势。也不选layeredevaluation独立主线，因为currentoracle不完整，还有adapterbug，当前尚未建立跨pipeline普遍的方法收益。

### 10.3 Related-work novelty校验（小范围，不是完备综述）

截至本次审计，已有研究明确讨论observation/action space alignment和grounding瓶颈，因此不能把它们宣称首次提出。[AgentOccam](https://arxiv.org/abs/2410.13825) 将observation/actionspace的调整作为核心方法；[SeeAct](https://arxiv.org/abs/2401.01614) 区分actiongeneration与grounding，并使用HTML与visualinformation。这个背景要求Prism贡献更精确的relation/failure-conditioned证据，而非“换表示能提高性能”。

[BrowserGym](https://arxiv.org/abs/2412.05467) 已提供统一observation/action接口与benchmark evaluation生态；[WebArena](https://arxiv.org/abs/2307.13854) 关注真实可交互应用和functional correctness。Prism不能把evaluationharness本身或一个successoracle当作全新贡献；它可以提供受控机制probe与multi-endpoint解释。以上是基于这些原始论文的noveltyrisk推断，未做穷尽检索，**不能宣称已确认首创**。

## 11. Minimal experiment roadmap

所有方案属于未来设计。采用新的studyID、新raw输出、新freeze，不resume旧cohort，不变更历史annotations。执行顺序：先修测量与设计counterbalance；再小mechanismcohort；再必要的transfer。先写各experiment将改变的claimconfidence，未列出对应claim的不做。

### P0-A：位置与信息可辨识性的同模板控制

- **RQ：** Local的成功是否跟随语义身份，还是correcttargetindex？检验Claims1/2/4的最大confound。
- **Hypothesis：** group-required条件中Local不随groupmapping稳定选对，Structural随真实relation变化；local-required条件Local跟随局部entity。
- **Manipulated variable：** 同baseDOM中goal需要localentity还是qualifiedgroup；correcttarget位置1/2/3与DOMentitymapping作预生成置换；用neutralopaqueURL。不是随机改变modelseed。
- **Control：** 固定policy/prompt/parser/executor/budgets、候选数和公共lexemes；各arm使用同一state副本；arm/model在timeblock交错。
- **Task subset：** 8个basepages，四relationfamilies（section、legend、nestedgroup、row/cardassociation）各两个不同DOMskeleton；每page两个goal条件、三个correctposition。使用counterbalanced构造，避免originalfield布局被改出无关差异。
- **同模板构造例：** 同页三个控件对应不同的局部实体（如 Item A/B/C），分别属于 Alpha/Beta/Gamma 群组。Local 暴露实体名而不暴露群组映射；local-goal 要求 Item A，group-goal 要求 Alpha 中的控件。预生成实体—群组—位置置换；保持公共词汇与控件集合一致。这使同一 DOM 的信息需求变化，并可检验“描述各不相同却仍无法解关系”的情况。禁止让实体名、位置或 URL 暗示映射。
- **Models / repetitions：** GLM、DeepSeek；每position一次完整trial即每task三种state，不把它们叫三独立tasks。Local/Structural共8×2goal×3position×2arms×2models=192runs。不要再为每位置默认加五repeat。
- **Metrics：** primary：计划的首次目标执行，choice随semanticmapping的equivariance；wrongrun、valid-outputcoverage、strict为secondary。
- **Statistics：** 每basepage先position平均，再pairedcontrast；goalrequired×scopeinteraction；按basepage聚类，按family报告与leave-one-family-out；positions不是独立簇。
- **Informative outcome：** representation能跟随identity；Local在group条件随position正确率波动，local条件相对稳定。
- **正结果：** 解除“只靠firstindex”的反对，Claim4由跨taskassociation转向同模板受控调节变量。
- **负结果：** 如Structural只在原位置有效，原主claim大幅降级；若Local也随identity正确，检查URL/title/order/wordleak或construct无效。
- **是否改thesis：** 是，这是Go/Pivotgate。
- **Cost：** 中低；主要是task/oracle生成与publicpayloadaudit，无production改动。

### P0-B：关系绑定与等长度词汇的最小消融

- **RQ：** 为什么Structuralhelp？检验Claim1的mechanism与Claim4。
- **Hypothesis：** R（bound）优于U（samewordsunbound），并主要在group-required条件；R保留S的大部分点估计表现，但不声称NI。
- **Manipulated variable：** §7.2四armsL/U/R/S；R/U候选数、词汇、字符/receiptinputsize尽量精确匹配，仅relationassignment不同。
- **Control：** 公共DOM统一extractor给所有candidate抽relation；不允许oracle/goal告诉formatter该加哪条edge。Correct/错误身份映射按预生成position表平衡。
- **Task subset：** **与P0-A同一个8-page×两goal×三positionblock**；不新建另一个benchmark。
- **Models / repetitions：** 同GLM/DeepSeek，每position一次。若P0-A的L/S已按共同freeze执行，只增U/R192runs；优先A/B一起预注册四arm总384runs，避免对A的结果调B。
- **Metrics：** primaryR−Ufirstgrounding；secondaryR−L、R−S、relationtracking、schemaerror、全轨迹错误动作、strict、表示估计/receipts。
- **Statistics：** basepagepairedmean与task/familybootstrap；预定R−U主contrast；scope×目标的关系需求为secondary；三position不当三independenttasks。报告allcells与valid-proposaldiagnostic两者，不过滤输出失败来获得表面效果。
- **Informative outcome：** 有绑定关系时正确选择随DOMmapping移动；同等words但无binding不恢复。
- **正结果：** 允许把“更多信息”缩到“candidate-groupbinding”的因果机制；可讲本实验验证过的最小关系补充，而非全局optimalcontext。
- **负结果：** 若U≈R且都优于L，支持词汇/全局关系set而非binding；若S显著优于R，remainingcontainer/nearbybundle仍必要；如都失败先看offered/executable与schema，不自动加variants。
- **是否改thesis：** 是；binding升级成功或退到bundledscope。
- **Cost：** 中低；一个evalformatter treatment、R/Userialization核验、8个basepages。无需通用graphsystem。

### P0-C：现有轨迹的endpoint与oracle一致性审计（零模型调用）

- **RQ：** Claim10是否来自层混合还是测量bug？核心claim的“grounding”到底测什么？
- **Hypothesis：** 存在真实grounded→termination失败，同时合法ancestor/omittedcontrol/labelsync解释部分表面ranking。
- **Manipulated variable：** 无agenttreatment；仅对同frozen轨迹用预先定义的并列estimands。明确这是测量验证，不是新因果实验。
- **Control：** 历史raw不改，原scorerset保留；新derivedversion另存。五failed/null做确定性分类对账。
- **Task subset：** E5/E6全480、E7全360；重点tabs、signin、modal-create、dynamicenable、delayedcontent。
- **Models / repetitions：** 复用全部existingruns，不补任何sample。
- **Metrics：** 计划的首次执行、scoredcoverage、all-scored-selections、argumentstate、anywrong、strict、termination、infra；每runcross-table。
- **Statistics：** 配对任务效应对照；报告missingcoverage对bound的影响；no-attemptruns全保留，不能替換为correct/incorrect。描述符号反转与CI不确定性。
- **Informative outcome：** 将真实的正确 grounding 后失败与评分 selector 的覆盖差异清楚。
- **正结果：** Claim10有可信实证例子，也增强representation endpoint可信度。
- **负结果：** 如ranking差异主要由oracle缺漏造成，就删除evaluation“reversal”机制表述，报告测量敏感性。
- **是否改thesis：** 主要改evaluationclaim，不替代关系P0。
- **Cost：** 低，离线analysis和少量known-控制组浏览器 oracle 检查；新增deriveddata即可。

本审计已经完成这些轨迹的基本cross-check和失败CSV；P0-C剩余是合法ancestor/targetcoverage的独立browsermeasurement验证与正式endpointtable，不需要重跑模型。

### P1-D：独立DOM的required-relationtransfer

- **RQ：** R机制能否离开为Prism撰写的fixture？加强Claims1/4的externalvalidity。
- **Hypothesis：** 只要task-relevantcontrols可见/offered，R比U更能按外部公共groupidentity选择；missingidentity或capability不足仍失败。
- **Manipulated variable：** R/U两个formats。第三armS仅在需要说明extractor bundle 的边界时增加；不默认带rawselector/Adaptive。
- **Control：** unchanged 外部作者编写的组件/sourceDOM；独立task/评估者标注；同state、samelexemes/length；R的extractorrule在看modeloutcome前冻结，不能task-specifichardcode。
- **Task subset：** 六个relationtasks，来自至少三个未参与训练/调试选择的DOMsourcefamilies，每族两个不同pages；selection按功能/relation/knowncontrol覆盖，记录全部筛选及不支持cases。若availability/eligibility未满足，保留描述性边界而非偷偷替换。
- **Models / repetitions：** GLM+DeepSeek；每task三个预先确定goal/targetidentity，R/U共6×3×2×2=72runs。若页面原样不支持目标身份变化，三independentrepeats替代并披露positionunchanged；不动sourceDOM只为效果造collision。
- **Metrics：** firstgrounding、目标关系跟随、targetpresent/offered/scoredcoverage、strict、wrong；receipt 成本为 secondary。
- **Statistics：** family/taskmeans、pairedcontrasts、leave-one-family-out；三个families区间不稳定，重视方向、例子和coveredconditions。
- **Informative outcome：** 在不同 DOM 来源族重复relationeffect，失败能被公共extractormiss或另一layer定位。
- **正结果：** 将thesis从“这些syntheticprobe”扩到“本次测试的独立 DOM 关系条件”，仍非全网。
- **负结果：** 公开nontransfer；限制核心为controlledfinding。如果在relation实际已暴露时仍不改善，机制泛化降级；不自动发明新policy。
- **是否改thesis：** 改scope；negative不一定杀掉controlledpaper，但强generalclaim必须停止。
- **Cost：** 中，source/合法关系标注与oracle独立验证比调用成本更重要。

对scope严格限于受控机制的短论文，这是P1；若标题/摘要要宣称外部DOM上普遍机制，则升级为P0。建议完成它才冻结完整paper，以最小增加获得三个reviewer共同信心。

### P1-E：终止状态重放（仅在要解释Adaptive model sensitivity时）

- **RQ：** DeepSeekstrictdrop是完成态描述而非初始关系选择吗？增强Claim6，非主线必须。
- **Hypothesis：** 正确grounding后的disabledcontrol+completionstatus引发BLOCKED；不同描述形式影响终止判断。
- **Manipulated variable：** 同一postcorrect-clickstate下L/S/A的终止观察，singledecision，固定model/prompt；不用正常run结果选择成功trial。
- **Control：** 脚本执行的正确动作建立所有已预定poststates，不将scriptoutcome作为agent成功；operationkeys/goal/history一致。
- **Task subset：** 全12确认实验的后置状态，不能只挑六失败；报告local-04子case为descriptive。
- **Models / repetitions：** 两models×12states×3formats×一次=72calls；不使用这些calls补旧successrates。
- **Metrics：** DONE/BLOCKED、headvalid、receiptusage；无执行 grounding 主张。
- **Statistics：** 配对任务差异，仅用于终止诊断；如只一个repeat多noise则按原计划报告inconclusive。
- **正结果：** 能把model-sensitivecompletionmechanism解释得更具体；不是过度扩展的因果关系。
- **负结果：** 暂停因果解释，保留observedstrictdrop。
- **是否改thesis：** 否，附属negativeanalysis。
- **Cost：** 低，复用scriptedstate和现有模型 adapter。

### P2（不影响当前Go门槛）

| 选项 | RQ / hypothesis / treatment / control | tasks/models/repeats | metric / analysis | 正负意义、thesis影响、cost |
|---|---|---|---|---|
| 第三模型复制 | R−U在不同providerfamily是否仍正；samefreeze、sameprompt、noadditionaltuning | 复用8basepages/twogoals/threepositions、R/U、一个新family；96runs | 配对 base-page 效应+outputcoverage | positive扩大modelcoverage，negative定义modelboundary；当前两个models足以先研究机制；低调用/可能中integrationcost |
| 第二pipelineprobe | relationeffect是否依赖Prismheadprotocol；commonobservations+R/U，只换外部existingdecision/actionwrapper | 8basepages、两个现有models、3positions、R/U；按新独立协议冻结 | 首次身份选择、schema/strict并列，familyeffects | 如有效降低“Prism-specific”风险；如无效限制机制scope；中cost，不在当前P0 |
| Formal Adaptive NI | 在实际有意义δ下，A相对S的grounding/strict可靠性下界过margin且totalusage下降 | 新不同任务簇；两models；sample由clusterpower模拟冻结，不能先报固定小n能保证power | one-sidedclusterCI、wrongguardrail、completeusage；missingusage敏感性 | positive才可methodclaim，negative保留tradeoff；会使论文变为Adaptive主线，故当前不建议；中高cost |
| External feedback pilot | AF1a信息vsA0 vsAF1c控制是否打断同实体重复拒绝 | 新rejection-exposedfamilies、两models、freeze前feasibilitygates；不是现在跑E7全部 | strict、repeatentity、costguardrail；task/familypaired | positive/negative是下一paper机制；currentE7几乎无stale，不能用它验证；中高cost |

后两项不能因“已经有draft”自动进入本论文。尤其execution-feedbackdraft的margin尚未数值冻结，主endpoint与条件化决策规则也不完全一致（见§12），需要整理后才能执行。

## 12. Stop / Go criteria

### Continue experiments

只在以下问题仍会改变核心claim时继续：position/URLshortcut未控制；R−U未隔离；首次 grounding oracle覆盖不清；缺少任何独立DOM的关系暴露案例。当前前三项为P0、第四为建议的scopegate。

继续前完成一份 **总预算和固定cohortplan**：P0-A/B合并384runs，P1-D72runs，总456runs。新实验的checkpoint不能依据中途胜负增repeat/换task。P0-C不使用模型调用；P1-E及P2不自动追加。

### Pivot thesis

- 若S在position变化后不能跟随identity，或effect来自URL泄露：停止表示机制主张，转为benchmarkdesign/measurementbias报告，先修construct再谈性能。
- 若R−U无优势但U−L稳定：转为任务相关globalcontext/lexicalexposure解释，不能继续写关系绑定的因果洞见。
- 若真实relations都暴露而两个模型仍多次失败：论点转为受限表示不等于decision能力，报告boundary，停止寻找更复杂scopepolicy救结果。
- 若P0-C显示“metricreversal”主要是scoringcoverage缺陷：删除“混合层造成反转”的主张，保留“endpoints measure differently”。
- 若外部transfer失败但controlledR−U清楚：保留受控机制论文，标题/摘要严格收缩；可以投适合scope的workshop/短篇实证论文，不伪装一般浏览器智能体论文。

### Stop experiments / freeze

当以下条件满足，**停止扩实验，开始完整写作**：

1. 关系/位置/goalrequirement已在共同冻结的至少8basepages、4families、2models、3positions中测试；全部outcomes/coverage保留。这里的阈值是推荐未来设计，未说现在已达到。
2. R−U方向在两models一致，经验pairedclusterCI可排除0，且leave-one-family-out不靠单一family翻转；如果CI仍宽，写inconclusive而非无限加repeat。若不满足，按上面pivot，不把停止与“必须positive”绑定。
3. Publicpayload不含oraclemetadata；合法target/ancestor/arguments/strict与failurelabels可reconcile；noattemptcoverage公开；历史文件与newfreeze完整可复制。
4. 至少三个独立DOMfamilies有预先选择、knowncontrol、relationcoverage记录；可以是mixed/negative结果。要扩展externalclaim则需这些coveredfamilies有相应effect；不扩展claim时negativeboundary已足够。
5. 已识别并呈现至少一个representation-insufficientcase（tables）和一个非representationcase（password/readiness/termination），不删除全臂失败task。
6. 总456-runplan完成或因provider/validity问题按protocol结束；禁止“差一点再跑到显著”。到上限仍不清楚就降低claim或pivot。

不要把“跨两个模型”“所有BootstrapCI正”当top-tieracceptance保证；它们只是这个最小研究scope的写作checkpoint。停止规则也不要求AdaptiveNI、第三模型、SOTA或largebenchmark。

**现在就可以开始写：** 问题定义、已有方法、预先声明的指标、历史证据、externalboundary与threats；mechanismresult先留空。论文的“开始写”不必等所有实验结束，核心结论定稿要等P0gate。

### Existing execution-feedback draft 的处理

[protocol](/home/tulipe/projects/prism/.scratch/execution-feedback-study/protocol.md) 与 [implementation plan](/home/tulipe/projects/prism/.scratch/execution-feedback-study/implementation.md) 是另一研究方向，status draft、M5待freeze。诊断支持modal/main 中的同实体重复循环，但external只有5/6个invalid-selectorrejections、没有staleevents，F1a现有trigger几乎没有exposure。first-layer6oracle未完成。

需要在未来修正的protocol问题：primary在一处写aggregateAF1a−A0、另一处说条件化估计才primary；costmargin没有定值；Holm correction和只报bootstrapCI而无p-value的流程未明确；“costguardrailfail不invalidRQ2”与“RQ2supported需guardrailholds”矛盾；“pre-study loop cannot fail”“negative paper stands on contract”预设贡献成立。Modelconditioning是reasonable，但不能用草案措辞保证发现。

所以本次不启动feedbacksystem/eventstore/secondframework。原始反馈诊断只作为恢复边界案例和futurework。

## 13. Paper outline

推荐标题草案：**When Action Descriptions Lose Identity: Relational Context and the Limits of Browser-Agent Grounding**。标题是方向性稿件名称，不宣称完成新的atomic机制证明。

| 节 | 真正要建立的论点 | 必须放的证据 / 应避免 |
|---|---|---|
| 1. Introduction | 浏览器目标不是只有buttonname；重复实体需要正确relationbinding；研究的是何时表示足够与何时无效 | 一个Draft/Team可辨识例与externaltable反例；不用SOTA/全栈featurelist |
| 2. Motivation | 相同label、相同localentity、不同group是可操纵的信息需求；最大scope也可遗漏身份 | 显示实际三个formattedcandidate，不只截图；位置shortcut案例说明为什么要counterbalance |
| 3. Problem formulation | 定义state、eligibleactionset、representation、目标所需关系与目标可辨识性；区分计划endpoint和条件诊断 | 说明不能由descriptorunique推semanticsufficient；没有全局最优context的定理 |
| 4. System / representation design | 将formatter/interface/validator/executor/recovery分开；只把representation作为主treatment | 公开extractorbounds、status-onlytext、同candidatecontrols；TypeSafeproduction不同transport |
| 5. Research questions | RQ1scope是否随goal所需relation而变化；RQ2关系绑定与无绑定 context 的对比；RQ3externaltransfer及boundary | 明确RQ2来自事后机制假设并新预注册；Adaptive为secondaryextension，不抢三条主线 |
| 6. Experimental setup | 任务构造/位置平衡/goalconditions、two-modelcontrols、plannedunits、独立oracle、freeze | 每层exposure/coverage与task/familycluster；区分历史探索实验/E5/E6/E7/newconfirmatory |
| 7. Results | conditionedeffect稳定、pooledranking不足、相同词汇条件下的关系绑定是否有效 | 逐任务效应/CI/negative；R−U结果未跑前留空；不用选择性repeat |
| 8. Mechanism analysis | 如果等词/等长R−U有收益，绑定信息而非tokenlength是最小testedexplanation | 关系置换跟随、heldouttemplates、L/U/R/S对比；不是泛称morecontext |
| 9. Failure / boundary analysis | missingidentity、eligibility、readiness、protocol、termination各限制哪些claim | externaltables、password、grounded→BLOCKED；合法ancestorcoverage说明；不把删除非语义失败 |
| 10. Discussion | Adaptive作为有限collision-conditionedfeasibility；minimumscope只是testedrequirement，不等于weboptimality | 35.4%proxy、strictdrop、外部wrong/costunknown并列；fixedpolicy非learned |
| 11. Threats to validity | 清楚告诉reader推断单位、conveniencesample、模型服务随机性、extractorbundle与外部边界 | 四簇CI、来源族相关性、URLshortcut、rawignore/researchbundle、adapterlabelissue |
| 12. Related work | 与observation/actionalignment、grounding与benchmarkecosystem区分真正新增证据 | AgentOccam/SeeAct/BrowserGym/WebArena原始论文；不说首次分层或首次DOM结构有效 |
| 13. Conclusion | 给出scope受限的scientificinsight和机制/非机制边界 | 只写结果确实支持的版本；无SOTA、universalnecessary、NI或完整推理成本主张 |

一种合理贡献列表只有三条：受控task-条件化表示效应；同词relationbinding因果probe（待新结果）；带外部negativecases的layer-分层边界分析。Adaptive放第三条中的可行性补充，harness开源是复现artifact，不再算第四个科学贡献。

## 14. Concrete next actions

### Next 3 experiments

1. **位置/goalrequirement控制，P0-A。** 建8basepages×2goalconditions×3positions，L/S、GLM/DeepSeek，总192runs；neutralURL；冻结前knowncontrol与目标身份平衡表。检验Claim1/2/4，观察正确选择是否跟随identity而非index。
2. **等词/等长binding消融，P0-B。** 同一任务block新增U/R192runs；与实验1最好共同预注册总384runs，避免根据实验1输出设计实验2。PrimaryR−U，按basepage聚类，按family敏感性。它决定能不能把“contextscope”升级为关系机制。
3. **独立DOM小transfer，P1-D。** 至少三个新sourcefamilies、六relationtasks、每task三目标条件/预定repeat、R/U、两模型，总72runs；先检查legal-targetcoverage和不可支持的controls，保留全部boundarycases。它决定摘要中的external范围，不追benchmark排名。

### Next 3 engineering / analysis tasks

1. **修复测量契约并生成新derivedledger。** 新analysis为E5/E6/E7输出计划的首次 grounding、scoredcoverage、argument/state、trajectorywrong、DONE/strict、infra的交叉表；对external5条failed/null保留original并附derivedfailure；对tabs合法ancestor做independentknown-control验证。未来externalrunner的success与failure派生同源，加regressionchecks；不修改E7raw或旧freeze。
2. **做最小实验生成器与无泄漏formatter。** 输出固定position/entity/goalcondition表，opaqueURLs；R/U只读publicDOM，每candidate统一规则；校验samelexemes/序列化长度与offeredtargetset，支持不产生目标唯一性的negativecase。只加eval代码，不做genericgraph、memory或反馈事件架构。
3. **做可复现researchbundle与纯分析出口。** 将ignoredJSONL/sidecars/sourcearchives、协议、taskmetadata、dependencylock、分析脚本、哈希表打包到versionedartifact；报告当前202inventory的editorialdrift解释；纯export不覆盖历史paperreports。把本审计脚本从ignoredwork保存进最终bundle，能用一个offline命令重建所有表而无需APIkey。

### 本次实际完成与剩余

本次完成：原始11cohort文件重建，2,229runs/7,327records唯一性及step/call/wrong计数核查；grounding从首次可评分执行独立重算；representation估计重算与私有marker扫描；两模型240initialprompt匹配；三个冻结源码包的哈希核查；119/202/226历史清单；1019外部实验服务 receipt对齐；当前v3schema验证4,650records；针对representation/adaptive/confirmatory/replication/external的 **30tests/5files全部通过**（Node22.23.2，无模型调用）。本次没有重跑浏览器integration或历史61/99/102/106完整套件，也没有修改production或历史结果。

剩余不是“再加更多benchmark”：是原子relation因果机制、位置/goalconditioning、合法targetcoverage与最小独立 DOM 迁移。现在可以写论文；不能在这些问题未解决时把工程能力包装成一般性的科研结论。
