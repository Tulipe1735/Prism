# 关系机制实验：零额度准备结果

日期：2026-10-04。状态：离线准备完成，正式模型实验尚未启动。

本轮没有调用真实模型服务，没有读取真实 API 凭证，没有切换服务商。新增代码与材料保留在当前工作区。没有修改历史结果、历史冻结源码或用户的 `AGENTS.md`。

## 完成的关键修正

| 问题 | 当前处理 | 研究意义 |
|---|---|---|
| 草稿调度器只生成 48 个单元，与协议的 192 不符 | 每个任务运行四个 arm；单模型 192 个单元 | 对比使用相同任务与页面状态，避免覆盖不一致 |
| 有效模型选择未传入执行器 | 使用历史 parser 校验并映射到实际动作；以假 HTTP 返回和真实浏览器验证 | 正式实验不再把执行器接线错误当成模型失败 |
| U 中 group 标签的编号暴露候选顺序 | R/U 使用按公共文本排序的统一 group 列表 | 移除候选顺序与 group 编号之间的捷径 |
| 词汇数量和表示长度混杂 | R/U 的 group 词汇出现次数一致，完整首次 payload 的 UTF-8 字节长度逐任务匹配 | 对比更接近关系引用的干预；仍不能宣称 tokenizer 成本相同 |
| entity 与 group 固定配对，部分设计存在 group 位置捷径 | 每个基础页面的三种状态联合平衡 entity–group 映射、group 位置及目标位置 | 测试跟随映射，而非固定位置或身份组合 |
| 重复模板及无效 HTML 嵌套 | 八个不同的有效 DOM 骨架；检查浏览器解析后的结构 | 不再把重复模板伪装成额外覆盖 |
| Structural 草稿含新的提取逻辑 | Local/Structural 保持历史 formatter 与 extractor | 保留真实比较条件；新模板的提取失败作为边界报告 |
| 完成、grounding、错误动作与缺失单元容易混淆 | 独立保存各指标；按相同任务配对，再按基础页面聚合 | 不把成功后的错误动作或终止失败吞入平均成功率 |
| 中断、覆盖旧结果及方法漂移 | 完成单元立即落盘；独占创建文件；正式调用要求冻结包和浏览器版本一致 | 保留失败与中断轨迹，阻止静默覆盖或方法变化 |

正式调用还保存每次决策的请求、原始响应、模型标识、usage、重试及错误。缺失 usage 保留为未知，不填成零。返回模型身份异常、提供方错误或调用上限触发时停止新增调度。

## 验证结果

| 检查 | 结果 |
|---|---|
| 类型检查与相关文件 lint | 通过 |
| 普通测试 | 112 通过；16 个需显式开启的测试跳过 |
| 本轮专项浏览器测试 | 6/6 通过；其他浏览器套件未在本轮全部重跑 |
| 生成器一致性 | 24 个页面、48 个任务与设计表一致 |
| 脚本化浏览器控制 | 192/192 完成；每个 arm 48 个单元；192 次正确控制，0 次错误控制 |
| R/U 完整首次 payload 字节匹配 | 48/48 对通过 |
| 配对分析管线 | 八个基础页面聚合；goal-condition interaction 路径通过 |
| 冻结归档内容 | 110 个文件全部与清单哈希一致 |
| 冻结阻断检查 | 错误源码哈希、错误归档哈希均被拒绝；两模型配置均通过核验 |
| 历史材料完整性 | 11 组原始结果、3 个源码包未改变；历史清单没有新增漂移 |
| 真实模型调用 | 0 |

脚本化驱动直接选择已知正确控制。这些记录只验证实验工具，不能证明模型表现或关系机制效果。其 `grounding_success=true` 表示已执行正确控制；`success=false` 与 `strict_task_success=false` 保留，因为脚本没有策略性的 DONE。不要把脚本报告的 arm 比较、零差异或区间写入论文结果。

历史 replication 清单原来已有 `evals/PAPER-STUDIES.md` 的文档变化；本轮检查没有发现新增变化。未把这项已知变化报告成全清单一致。

## 外部评分的独立检查

15/15 个外部任务的当前 DOM 覆盖已检查，归档 live copies 与冻结哈希一致。另用浏览器执行了独立控制：

- **external-tabs**：一个已提供的祖先动作被旧 audit 判为 neutral，但实际点击后目标标签页成功激活，错误计数为零。这支持一个具体的评分覆盖缺口。
- **external-billing-name**：两个正确 selector 匹配均可操作，属于合法的多步目标契约。多匹配本身不是 oracle bug。
- **external-signin-fields**：password 控件在当前页面可见，却不在 snapshot 提供的节点中。这是当前动作能力范围的边界，不能自动归因于上下文表示。

隐藏的后续步骤控件也可能暂时未被提供；不能把所有 `not offered` 都解释成永久能力缺失。没有改写历史 grounding 标签或把这些检查升级为“分层评分普遍反转结论”的证据。

## 当前冻结的正式实验

48 个任务 × 四个 arm × 两个模型，共 **384 个实验单元**。四个 arm 是 Local、Unbound、Bound 和原始 Structural。

主对比是 group-required goals 上的 **Bound − Unbound**。二者提供相同 group 词汇；只有候选的 `belongs_to` 引用从未知变为实际绑定。local goals 命名唯一 entity，是词汇控制，不能描述为“必须用 Local 才能解决的局部歧义”。

固定分析以八个基础页面为聚合单位，保留逐页面、逐模板族及去掉一个模板族的敏感性结果。三种位置状态不是独立样本。两模型单独报告；不因中途结果增加重复或改任务。

仍需限定解释：

- 八个模板来自四类人工构造 DOM，不能视为八个独立真实应用。
- requested entity 在八个基础页面中为 3/3/2 分配；各 arm 完全共享该分配，但词汇覆盖并非等额。
- 引用语法本身属于干预。未知引用可能影响弃权或 confidence；local 控制和原始响应用于诊断。
- 等 UTF-8 字节不等于等 prompt tokens，更不等于等推理成本。
- 新环境是 Chrome/153.0.8010.52；历史 confirmatory 使用 .12。协议保留此差异。
- 这是事后机制假设的前瞻性检验与本地冻结，不是外部注册的 preregistration。

这项实验能加强或削弱“显式关系绑定帮助受控 grounding”的可信度。它不能单独证明一般网页泛化、最优表示、Adaptive non-inferiority 或 SOTA。

## 交付材料与恢复调用

- [正式协议](/home/tulipe/projects/prism/evals/cohorts/relation-ablation-v1.protocol.md)
- [准备与运行说明](/home/tulipe/projects/prism/evals/relation-ablation/README.md)
- [离线验证记录](/home/tulipe/projects/prism/work/relation-preparation-2026-10-04/verification.json)
- [源码冻结清单](/home/tulipe/projects/prism/work/relation-preparation-2026-10-04/frozen/freeze.json)
- [源码归档](/home/tulipe/projects/prism/work/relation-preparation-2026-10-04/frozen/source.tar.gz)
- [历史完整性记录](/home/tulipe/projects/prism/work/relation-preparation-2026-10-04/historical-integrity.json)
- [外部评分覆盖报告](/home/tulipe/projects/prism/work/relation-preparation-2026-10-04/external-coverage.md)

`work/` 被 Git 忽略，分享或迁移研究时必须单独保存这些材料。该归档包含前瞻实验方法及共享源码依赖，不包含全部历史原始数据与外部 replay sources。`before-fixes-source.tar.gz` 保留初始草稿；`scripted-validation/`、`scripted-final/` 是中间版本，只使用 `scripted-verified/` 作为此次最终工具检查记录。

恢复模型额度或明确新的调用预算后，先核验同一冻结包，再按 README 分别运行 GLM 与 DeepSeek。若源码、环境或服务端点改变，创建并记录新的实验条件，不在旧结果文件上续写或静默替换。

当前停止继续修改实验工具。先保存冻结材料；正式模型结果到位后，再依协议判断关系机制是否成立。
