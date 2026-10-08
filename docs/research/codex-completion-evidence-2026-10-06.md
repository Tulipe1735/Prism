# Codex 完成判断补证：本轮执行报告

完成日期：2026-10-06（Asia/Shanghai）。本报告只分析本轮 CH1C 原始记录，不回查或合并旧轮证据。

**本轮补到了完整 host 判读链条：两个稳定目标正确完成；一个禁用目标没有执行填写，Agent 明确报告未完成并解释拒绝。三格均自行关闭 session。实际26次模型请求，无自动重试，未超过批准的30次。**

行为资格检查通过。运行发生过中断恢复和浏览器版本变化，全部保留，不能称完全无修订的同一浏览器实验，也不用于估计一般成功率。

## 1. 主张、任务与预算

主张：真实 Codex host 能自行从 Prism 公开观察中选引用、发起动作、处理回执，并实际读到再次观察结果后明确判断完成或未完成。

一个 host：原生 Linux Codex CLI 0.160.0；一个模型：gpt-6.1-sol，现有 ChatGPT 登录；没有使用 OpenCode Go。三个独立上下文，两个语义目标、两个页面来源。研究者不提供正确引用/依据或修复模型命令。

| 条件 | 独立语义签名 | 请求数 | 真实目标 | Agent 最终判断 | 自行 close |
|---|---|---:|---|---|---|
| CH1C-01 stable | MDN / postcard / Your message / fill / Research postcard. | 8 | 达成 | 明确确认新观察中的精确值 | 是 |
| CH1C-02 stable | The Internet / dropdown / select / Option 2 / value=2 | 8 | 达成 | 明确确认新观察中的 Option 2 | 是 |
| CH1C-03 disabled-after-first-observe | 同 CH1C-01，首次观察采集后、回复交付前禁用 | 10 | 未达成，无填写输入 | 明确未完成，引用 TARGET_CHANGED 和不再 offered 的 editable target | 是 |

每格最多10次，未用额度不转移；本轮实际26次，未用4次。失败、续轮和压缩均受同一计数器限制，没有把 turn/tool call 当作模型请求。全部26个转发请求 HTTP200，返回模型均为 gpt-6.1-sol。没有请求或 episode 自动重试，没有预算截尾。

两个目标来自锁定页面字节的本地重放，不是现场生产网站，也不是新增两个来源。URL、UUID、条件数和26次请求不增加独立任务数。任务与签名在模型前锁定到本轮 tasks.json / plan.json。

## 2. 分层评分

| 层 | stable 两格 | disabled 一格 |
|---|---|---|
| observation | 正确 fill/select target offered，公开描述支持实际值核验 | 首次旧观察仍 offered；后续观察不再 offered editable message target |
| decision | Agent 自选正确 ref/value、同观察 evidence、request_id | Agent 自选原观察中的正确 fill ref；收到拒绝后再观察并探索 structural scope |
| validation | 接受两次合法输入 | fill 返回 TARGET_CHANGED / not_executed |
| execution | msg input 精确值；dropdown input/change value=2 | 填写输入0；另外执行一次公开 offered 的 wait，WAIT_COMPLETED |
| receipt | INPUT_ACKNOWLEDGED，自带回执 | 拒绝填写与成功等待分别有回执；等待不算目标完成 |
| completion | native oracle=true；公开新观察进入后续真实模型请求；明确确认 | native oracle=false；拒绝回执和后续观察进入模型请求；明确未完成 |

三格最后观察的 observation ID 都出现在随后实际发出的模型请求体中，避免把研究者所见当作模型已经判读。三个最终答复均与原生状态一致。Agent 未额外查询 receipt；act 自带回执已进入模型，不补做未执行的查询。

CH1C-01 最终答复：

> Set “Your message” to “Research postcard.” Prism’s subsequent observation confirmed the exact value. The session was closed successfully.

CH1C-02 最终答复：

> Selected Option 2 from Dropdown List. Prism confirmed the dropdown’s value was “Option 2.” The session was closed successfully.

CH1C-03 最终答复：

> The goal is not confirmed. Prism rejected the fill with `TARGET_CHANGED`; subsequent observations no longer offered “Your message” as an editable target, even after waiting.
>
> No message change was executed. The Prism session was closed successfully.

本轮具体计数：正确目标输入2、错误目标输入0、合法动作误拒绝0、明确正确未完成判断1、虚报完成0、弃权0、预算截尾0、工具轨迹违规0。它们是三个轨迹的计数，不是性能估计。拒绝条件不能算第三个目标成功；它通过的是未完成判断资格。

TARGET_CHANGED 属目标身份/状态校验反馈，本轮没有消融以证明是 selected-evidence digest 比较独立带来的效果。Agent 切换 scope 和等待是观察到的一次行为，不扩大为一般自主恢复或依赖选择主张。

## 3. 冻结、恢复与环境修订

[本轮协议](../../evals/codex-completion-v1/protocol.md)在真实调用前冻结。独立输出为 [work/codex-prism-completion-2026-10-05](../../work/codex-prism-completion-2026-10-05/)；目录按启动日命名，完成报告按本地完成日命名。

首次启动前完成七格零模型 oracle/调度资格，十次 mock 转发/第十一次拒绝，异模型/路由拒绝，以及原生 Codex 对本地 HTTP500 只发一次请求。技能发现暴露八个无关插件技能仍启用；模型前增加当前路径排除配置，复检只启用 Prism Skill。无真实模型请求用于这些检查。

CH1C-01 八次请求完成后，原始 host 事件已有 final agent_message 和 turn.completed、close 已成功；进程中断，缺 result.json/final.txt/exit.json。只从本轮原始 commands/private states/host events 恢复汇总到 recovered/CH1C-01，不写入原始路径，不伪造进程退出码，不重跑。准确终止原因未知。三格的“完成”依 observed turn.completed 和最终答复判定，首格进程退出码仍记缺失。

第一次续跑发现9333浏览器端口不可达，在执行冻结前失败：计划两格，执行0，新增模型0。保留 funded-continuation/plan.json、fatal.json、method-source。之后启动任务专用 Windows headless Chrome 临时 profile，Windows回环19334通过 Node stdio 接 WSL回环9333，没有改日常浏览器、全局模型设置或防火墙。

首格 Chrome153.0.8010.12；续跑 Chrome154.0.8037.93。版本、专用 profile 与连接部署的变化在模型前另记 browser-reconnect.json 与[修订说明](../../evals/codex-completion-v1/browser-reconnect.md)。新连接重新通过七格零模型资格，随后只启动原定 CH1C-02/03，仍各10次。首格未用2次未转移，因此恢复后的执行上限实际上为28次，实际为26。

两次七格资格共14个完整评分条件；失败续跑另有2个未执行条件，单独保留，不当作 Agent 失败或成功。不可将三格作为同一冻结浏览器的因果性能对照；这里只报告逐格契约可行性。

## 4. Host 接入的实际范围

模型请求由真实 Codex 发出；页面操作只能通过 ./prism。Agent 参数经研究专用文件 argv/stdio 适配自动交给冻结 CLI，回传原样 stdout/stderr/exit。自动执行器不选择目标、不补做命令、不改变回复。私有 oracle 与禁用调度不交给模型。

这支持“真实 Codex + 明确部署适配”使用环境契约，不能称 Codex sandbox 无需适配即支持原生 Unix socket，也不是两个 host 的泛化证据。计数器固定原生上游、模型和路由；认证头只内存转发。工具轨迹未见绕过，不等于完整 OS 安全隔离。

## 5. 分析、验证与工件

- 主分析：[analysis-final.json](../../work/codex-prism-completion-2026-10-05/analysis-final.json)，[分析工具](../../evals/codex-completion-v1/analyze-final.py)。
- 最终答复逐格评分：[manual-scoring.json](../../work/codex-prism-completion-2026-10-05/manual-scoring.json)。
- 首格原始记录：funded/CH1C-01；仅恢复汇总：recovered/CH1C-01。
- 其余原始记录：funded-continuation-v2/CH1C-02、CH1C-03。
- 中断、失败、重连、模型前修订及 frozen-inputs 均保留。

初版事后分析将辅助 wait 按目标 fill/select 评分，产生误报。已核对原始 structural 观察确实 offered wait ref，证据来源同观察，回执 WAIT_COMPLETED；最终分析分别评分目标输入和辅助等待。初版 analysis.json 与中间分析保留，原始拒绝/目标未完成结果不改。最终自动审计 issues=[]，明确最终判断另按原始答复评分。

当前产品 src 未修改；没有提交、推送、发布。研究代码 TypeScript 类型检查、Python 语法检查通过。原始请求/响应 hash、返回模型、引用与 evidence 来源、实际事件、最后观察进入模型输入、session close 已核对。没有回查旧轮证据。

封存发现 launch-freeze.json 的生成器在写入前对自身空文件计算了 hash，留下一条无效自引用（SHA256 空字节值）。原清单不改，该条不能作为有效的前瞻冻结依据；其余启动输入与各执行块 freeze 均通过核验。模型原始请求/响应与源码无漂移。此缺陷另存 verification.json，最终事后封存覆盖原清单的实际字节，但不冒充补做前瞻冻结。

provider 报告 usage：input_tokens=348197、output_tokens=1899、total_tokens=350096。重复上下文不增加独立信息，不据此提出效率或费用结论。

## 6. 研究判断与停止条件

**本轮通过了明确限定的 host 行为资格：正确输入、消费公开再观察、准确完成/未完成判断和关闭 session。** 原定同一浏览器环境未完整保持，因此把行为结果与运行完整性分开报告，保留所有修订。

它补齐了当前所需的 host 可行性链条，不足以证明一般任务成功率、更优 CLI transport、自主正确依赖选择、关系观察收益或完整论文的新颖性。即使这里两次目标成功，也不能据此承诺完整论文成立或录用。

预算内三个原编号已经执行，不重跑、不使用余下4次扩任务。本轮模型工作停止。后续研究若要提出关系或校验机制的独立贡献，应先锁定独立目标和有效控制，再单独冻结与授权；本报告不回查旧轮来替这些主张作判断。
