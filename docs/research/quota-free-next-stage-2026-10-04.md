# 额度用完后的研究推进状态

日期：2026-10-04（Asia/Shanghai）。本轮未调用模型服务，未读取凭证，未切换服务商。历史结果与冻结代码保持原样。

后续工作已完成：见 [零额度准备结果](/home/tulipe/projects/prism/docs/research/offline-preparation-results-2026-10-04.md)。下文保留上一阶段的检查状态；浏览器验证、R/U 控制修正与源码冻结以新报告为准。

## 本轮已完成

- 复用仓库已有的 endpoint-audit 工具，重新核查四个冻结 cohort，共 840 个 runs。已执行步数、错误输入计数与首次 grounding 标记没有一致性矛盾。
- 将缺失失败标签的五个外部 runs 保留在新派生表中：三条 `POST_GROUNDING_BLOCKED`、两条 `POST_GROUNDING_WRONG_ACTION`。原始标签仍为 null，没有修改历史文件。
- 核对四个原始结果文件的 SHA256；生成派生结果后均未改变。
- 核查现有关系消融生成器：24 个页面、48 个任务与设计表一致。这是实验准备验证，不是模型效果证据。
- 本轮运行 endpoint-audit、relation-ablation、external 三个测试文件，17 项测试全部通过。未在本轮运行浏览器集成测试。

新输出：

- [分层结果表](/home/tulipe/projects/prism/work/quota-free-readiness-2026-10-04/endpoint-audit.md)
- [逐 run 派生记录](/home/tulipe/projects/prism/work/quota-free-readiness-2026-10-04/ledger.json)

`work/` 被 Git 忽略。分享研究材料时需要单独保留这些输出。

## 不需要模型额度的下一步

1. 验证合法 ancestor 动作与多目标 selector 的评分覆盖。仓库已有外部覆盖检查输出，可先检查其定义与浏览器证据。
2. 检查 R/U 对比的词汇、长度和候选映射。当前实现已声明 bound/unbound 的长度残余差异；不能将它直接称为“仅关系绑定不同”的严格消融。
3. 准备新的冻结材料包，包括协议、设计表、源码、浏览器版本、分析脚本和哈希。旧 external runner 属于已冻结证据；不能在旧 study ID 下修改它的分类逻辑后续跑。

## 正式模型实验的启动条件

- 模型额度恢复，或用户授权一个新的调用预算。
- 两个模型配置中的 `browserVersion` 从 null 改为实际测试版本，并记录与历史环境的差异。
- 浏览器控制检查通过，R/U 残余差异已处理或清楚限定 claim，冻结源码包和哈希已保存。
- 若改用另一服务端点，单独记录 endpoint、模型标识与配置。不能将换端点视为保持全部条件的历史复制。

本轮没有修改现有实验实现，也没有创建正式模型结果。当前能够继续完成离线工作；新增模型表现与关系机制效果，仍需正式模型实验。
