# Codex 调用 Prism：证据补全与新资格结果

日期：2026-10-05。补充先前研究推进报告；不覆盖旧协议、冻结或原始结果。

可以用 Codex 做真实外部 Agent host。架构为 Codex 的模型决定下一步，Codex 的终端工具
执行 Prism CLI，Prism 返回观察、校验或输入回执；研究 fixture 在另一侧准备页面和评分。
Prism Skill 提供使用知识，CLI 提供当前入口。这不说明 CLI 优于 MCP，也不是两个 host。

此前已确认本地 Linux Codex CLI 0.160.0 能发现原样 Prism Skill，app-server command/exec
能执行 Prism help；HTTP 500 与 SSE 中断 mock 的模型 POST 各一次。这些是部署/接口预检，
不是 Agent 自主成功。当前研究会话已经知道任务答案，只适合作为工程 pilot；正式实验
应使用新的 Codex 会话和独立任务目录，不能继承本研究上下文。

## 本次完成的零模型检查

新工具：`evals/environment-contract-v1/completion-observability.ts`。
新输出：`work/codex-prism-readiness-2026-10-05/`。
五个候选页面和每页一个正确动作在调用前锁定，并保存源码/来源归档。
调用真实当前 Prism CLI；目标由研究者预设，不使用真实模型或自主控制器。
分析见 `completion-analysis.json`，原始观察、输入、回执见 `qualification/records.jsonl`。

五个动作均产生正确实际输入和原生目标状态，五个回执与输入一致，查询回执一致。
真实模型请求为零。TypeScript 类型检查通过。冻结归档及当前冻结文件 SHA-256 一致。
页面资源重放仍有 14 条 404 记录，保留在 resource-errors.json；不能称为完整原站复现。

| 候选 | 再次 observe 可见的实际结果 | 当前判定 |
|---|---|---|
| APG Lettuce checkbox | checkbox 文本、value="on"、context、relations 不变；只有晚加载 CodePen 按钮等其它变化 | 未暴露 checked 状态；不能用整条回复“变了”证明完成可核验 |
| APG Ida tab | context 的传记变化，出现 Ida Henriette da Fonseca 链接；未输出 selected | 有间接 panel 证据；原 aria-selected 目标尚无直接公开状态 |
| MDN message | Your message 描述的 value=Research postcard. | 当前值可读，适合首轮完成核验 |
| The Internet dropdown | 剩余选择动作的 value=Option 2，已选选项不再 offered | 当前选项可读，适合首轮完成核验 |
| jQuery UI speed menu | Slower/Slow/Medium/Fast/Faster options 新出现，未输出 expanded | 有间接展开证据；保留为后续候选 |

以上是单个正确动作的观察资格及事后分析，不估计普遍可观察性或成功率。
未在本 block 重做错误/未执行对照；原独立页面 oracle 标定保持单独统计。
未新增产品功能，也未修改历史负结果。

源码解释：`src/browser/snapshot.js` 保存 checked/selected/expanded，而
`src/cli/sessions.ts` 的公开 target 与 `src/browser/representation.ts` 的 description
没有输出这些字段。内部 snapshot 能辨别状态，不意味着外部 Agent 能读出同样状态。
回执本身明确为 INPUT_ACKNOWLEDGED，并说明 task success 未校验。

## 最小补证顺序

1. **真实调用证据**：先用 Codex 在 message、dropdown 两个不同来源上自主调用，
   再用 message 的观察后禁用条件检查反馈解释。新的 H1 v2 协议固定三个 episode、
   两个语义目标，拟上限 18 次真实模型推理请求。成功只补真实 host 可行性这一缺口。
2. **机制贡献证据**：另找关系确实必要、被当前公开观察暴露、oracle 能分辨结果的
   独立任务。先做零模型资格，再比较 Bound / Neutral-unbound / Marked-unbound，
   区分关系信息效应与显式缺失标记诱导的弃权。旧192次并不能替代这一独立复核。
3. **完成核验边界**：保留当前 checkbox/tab 记录，单独分析 Agent 能确认、只能推断、
   或没有足够依据的情形。如以后修改公开状态字段，必须另冻结版本，不能改写本次负边界。

每个真实 episode 中，ref/evidence/命令/最终判断均由 Codex 生成。研究者不能执行后
让 Codex总结成功，也不能告诉它正确目标。评分分别报告 observation、decision、
validation、execution、goal completion，以及 Agent 判断是否与证据相符。

若 Codex 只有在接管、泄漏 oracle 或额外浏览器接口下才能完成，收窄自主接入主张。
若独立必要关系任务无法通过 offered/关系暴露/oracle 资格，则暂停跨页面关系机制主张。
若 Neutral 与 Marked 不同，只保留标记效应解释。两类结果都必须保留失败分母。

## 已固定与尚待准备

旧六 episode/36请求设计保留，新设计为
`evals/environment-contract-v1/codex-h1-v2-protocol.md`，不是原协议的静默修改。
尚待完成：精确模型/provider、独立部署、禁用调度零模型检查、真实请求硬计数及可执行冻结。
Codex 会话可以包含多次模型请求；不能用三个会话冒充三次请求。
本轮无新增真实模型请求。原预算已耗尽，正式调用需要先完成上述零模型准备，再由用户
明确批准新增请求上限。

单个 Codex host 的成功轨迹不能独自完成整篇论文的新颖性论证，也不需要立即加第二 host。
对当前候选 thesis，最能改变研究判断的是：真实外部 host 的可核对闭环，加上独立
关系必要任务中的机制复核。前者证明能被外部 Agent 使用；后者才增强关系组织的经验贡献。

## 官方资料核对

- [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive/)：
  exec 可执行任务，--json 输出 host 事件。事件流不等于每次模型请求的计数。
- [Codex configuration reference](https://developers.openai.com/codex/config-reference/)：
  provider 的 request_max_retries 与 stream_max_retries 可设置；重试次数不是总推理次数上限。
  本地版本实际命令和 mock 行为另保存，不能只依赖浮动官方文档。
