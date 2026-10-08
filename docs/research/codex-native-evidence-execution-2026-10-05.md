# 原生 Codex 补充证据执行报告

2026-10-05。已按用户要求直接使用已安装的 Codex 与现有 ChatGPT 登录，未使用 OpenCode Go。实际发出 **18 次模型请求**，gpt-6.1-sol，三个条件各六次；全部 HTTP200，无转发或 episode 自动重试。每格第七次尝试均由本地计数器拒绝，未到上游。旧192次记录与本轮其它零模型工件保留。

**结论：补到了真实 Codex 自主选引用与操作、收到拒绝后再观察的轨迹；完整的完成判断和拒绝诊断仍未补齐。三个会话都被六请求上限截尾，不能写成三个自主任务完成。**

输出：[work/codex-prism-native-2026-10-05](../../work/codex-prism-native-2026-10-05/)。可复算分析：[analysis.json](../../work/codex-prism-native-2026-10-05/analysis.json)、[分析工具](../../evals/environment-contract-v1/analyze-native.py)。报告及分析为事后产物，不称外部预注册。

## 1. 论文题目与 thesis

保留候选题目 **Prism: An Empirical Study of Observation-Bound Browser Contracts for External Agents**。

> We present a browser environment that separates agent decisions from observation-bound execution, and characterize when public evidence supports grounded input, triggers refusal, or leaves failures undetected.

暂不在一句 thesis 中声称 relational observations 已有独立效应。关系贡献通过独立任务与有效控制后再加入。CLI 为部署入口，Skill 为使用知识，MCP 可承载同一契约；均不构成替代关系。

## 2. 真实执行结果

| 条件 | 自主 decision / validation | 实际 execution 与 goal | 再观察与模型判读 | 完整 episode |
|---|---|---|---|---|
| CH1-01：MDN message，stable | 自选已 offered 的 Your message fill ref；同观察 evidence；INPUT_ACKNOWLEDGED | msg input=Research postcard.；goal=true | Codex 发起再观察，公开值正确；预算阻止下一请求，模型未收到此新观察 | 未完成，无最终答复、未 close |
| CH1-02：Internet Option 2，stable | 自选 Option 2 select ref；同观察 evidence；INPUT_ACKNOWLEDGED | 原生 input/change value=2；goal=true | 再观察返回 current Option 2；模型未收到此新观察 | 未完成，无最终答复、未 close |
| CH1-03：message，观察后禁用 | 旧观察中正确 fill ref；TARGET_CHANGED / not_executed | 原生事件0、goal=false；固定调度成功 | 模型请求中含拒绝回执，随后自主再观察；没有明确诊断或最终判断 | 未完成，无最终答复、未 close |

每格请求序列都是读取 Skill、help、open、observe、act、observe。第一次正确观察后，Agent 自行决定 ref/evidence/value/request_id；研究者未修复命令或接管动作。所有引用都来自实际公开观察。每个 act 自带回执；Agent 未额外查询 receipt，不补做冒充其行为。

稳定格的 native goal 达成可以报告，但不能等同完整 Agent episode 成功，也不能声称模型已验证再次观察的值。最后一次观察是在第六请求生成的工具调用中返回，第七请求被挡住；实际发出的请求体均没有最后 observation ID。禁用格第六请求确实包含 TARGET_CHANGED 回执，并生成 observe，支持「收到拒绝后按反馈再观察」，不支持「准确解释拒绝并向用户报告未完成」。

错误执行0、合法动作拒绝0、弃权0，是这三条具体轨迹的计数，不是估计性能；禁用动作本来非法，不算 false refusal。观察到虚报完成0，但三格都没有最终报告，不能据此宣称不会虚报。完整 episode=0/3，预算截尾=3/3；上游基础设施失败0，工具轨迹发现违规0。研究者清理 session 属实验收尾，不算 Agent close。

服务返回模型均为 gpt-6.1-sol。报告 usage 合计 input_tokens=225213、output_tokens=1264、total_tokens=226477；仅为 provider 报告值，重复上下文不增加独立样本，不据此提出效率或费用结论。

## 3. 真实 host、部署适配与限制

一个真实 host：Linux Codex CLI 0.160.0；一个模型；两个来源语义目标；三格。不是两个 host，不是研究者最小调用器或 mock 主实验。模型由真实 Codex exec 会话调用原生 ChatGPT 账号接口；命名 provider 配置仅把 Responses 请求经本地计数器送到固定官方上游。

当前 Linux sandbox 不能创建 Prism 所需 AF_UNIX socket。即使设置获批的实验 Unix 选项仍失败。原生 exec 日志明确提示 experimental_network 和 features.request_compression 被忽略；因此不能把这些配置当有效安全措施或接口支持。standalone 的直接浏览器 TCP 访问探针失败，也不能证明所有网络绕过都被 OS 禁止。有效可审计内容是请求固定路由/模型、六次转发硬限、零转发重试与实际工具轨迹。

最终使用研究专用文件 argv/stdio 通道：Codex 调用 ./prism，自行提供参数；自动固定执行器在 host sandbox 外运行冻结 CLI，原样交回 stdout/stderr/exit。没有规则控制器代选目标或修改决策。产品源码未改。它证明「真实 Codex + 明确执行适配」的使用轨迹，**不能称当前 CLI 在 Codex 沙箱中无需适配即可运行**。适配是一个实际 host 部署成本，应在论文中交代。

原生认证头只内存转发到固定上游，未写工件；不读取项目 .env。TLS 连接使用环境原有 HTTPS 代理，非更换模型服务。官方说明指出 Codex 的 ChatGPT 登录使用该 Responses 上游；[OpenAI 的 Agent loop 说明](https://openai.com/index/unrolling-the-codex-agent-loop/)支持这个部署事实，不能替代本轮计数记录。

## 4. 方案冻结、修订与失败分母

先冻结三格与两个语义目标，再执行。用户批准预算后要求原生 Codex，保留 OpenCode Go 的旧方案与失败。原生方案：[初始执行协议](../../evals/environment-contract-v1/codex-native-protocol.md)、[模型前补充冻结](../../evals/environment-contract-v1/codex-native-execution-freeze.md)。

新增零模型条件计划16、原始记录9：第一次初始化超时1；provider ID 修正后 AF_UNIX 失败1；文件适配准备中复制参数错误导致7格未执行；修正后完整7格通过。研究工具复制错误与原源码保存在 deployment-v3/fatal.json、method-source；它是准备错误，不是 Agent 或产品失败。所有失败均保留，未静默排除。

通过的七格分别为两个任务 correct/wrong/neutral 及 message disable-after-observe。正确格 goal=true；错误与未执行 false；禁用 TARGET_CHANGED、无 input、false。错误格是研究者有意标定，不算自主错误。

计数器 local mock 精确六次转发、第七拒绝，异模型/异路由拒绝。原生 Codex local HTTP500 mock 一次 POST、认证头存在、零重试；模型前无认证 HEAD 405、无推理。Codex 的 JSON turn/tool 事件不当作请求数。

CH1-01 六次 HTTP200 后因预算耗尽 host exit=1，v5 的研究执行器将此误归入停止后续格的控制条件。保留原块，不重跑。之后形成[续跑修订](../../evals/environment-contract-v1/codex-native-continuation.md)，只启动未运行的 CH1-02/03，仍各六次、总十八次；提示和 Agent 信息不改。修订发生于首格观察后，不能称完整无变更预注册实验。原始结果分别在 funded 与 funded-continuation；同一原编号不重复计数。

所有执行 freeze 的文件哈希可复核；失败 v3 的源码从存档恢复，其它无漂移。十八次请求/响应 hash、返回 model、usage、公开观察、原生事件和固定调度均对应。analysis issues=[] 不代表产品无边界。

## 5. 独立任务与语义签名

| 签名 | 独立语义目标 | 本轮条件 | 独立性限制 |
|---|---|---|---|
| MDN / postcard / fill / message / exact Research postcard. | 填指定消息框 | stable、观察后禁用 | 一个目标；重复条件不增加任务数 |
| Internet / dropdown / select / Option 2 / value 2 | 选择指定选项 | stable | 一个目标；同一 select 的正确/错误须按实际 value 区分 |

页面字节来自先前冻结 source replay，没有修改页面以改善结果。UUID、URL、目录、18次请求和21次尝试（含3次未转发）均不增加独立任务数。任务来源文件、oracle、页面和源码 hash 见各 plan/freeze。

此前 W3C H71 Postal Address 关系候选、jQuery vertical Book Now 不进入本轮 host 任务：前者 local context 泄漏组对应，不能用于仅删 relations 的消融；后者所需横向/纵向关系未公开。严格关系独立消融合格任务仍为0。

## 6. 最多两个候选贡献及近邻定位

| 候选贡献 | 问题与已有证据 | 本轮改变的可信度 | 仍缺什么 |
|---|---|---|---|
| C1：具体可检验的 observation/ref/evidence/request 生命周期与责任划分 | 旧引用有效性、依据来源、ACK/完成歧义；当前源码、资格 oracle、真实 Codex 三格 | 从仅工程/预设调用推进到真实 host 自主 grounded input；拒绝回执能驱动再观察 | 完成/未完成的最终自主判读；与近邻逐字段和故障场景的差异，证明研究价值 |
| C2：公开 evidence 相等性校验的拒绝收益、误拒绝及漏检边界 | 旧192模型原始审计及负例、零模型独立页面资格 | 增加真实调用中状态拒绝未产生输入的一个实例；未新增 false-refusal 或关系效应实验 | 独立关系必要任务、neutral-unbound、无泄漏且不带 ?? 拒绝提示的控制；独立机制复现 |

能力有实现不等于研究贡献。Agent/环境分离在 [BrowserGym](https://arxiv.org/html/2412.05467v1) 等已存在；snapshot refs 与真实 host 接入同 [Playwright MCP](https://github.com/microsoft/playwright-mcp)、[agent-browser](https://github.com/vercel-labs/agent-browser) 重叠。Prism 需比较具体引用寿命、依据绑定和持久回执，不能以 CLI 包装作为新颖性。

[Atomicity for Agents](https://arxiv.org/html/2603.00476v1) 已研究浏览器 TOCTOU 与阻断；[ATR](https://arxiv.org/html/2609.08015v1) 已研究选择性依赖与重验证。Prism 是 public view 相等检查，无事务或 typed predicate 保证；旧读取后竞态、截断和合法误拒绝仍成立。本轮没有修复这些负结果，也没有建立新颖性。

[MCP tools 官方规范](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) 可承载相同 schema/structured replies；同一后端可以组织这里的 ref/evidence/receipt。文件适配也提示接口语义与传输要分开。没有 transport 假设或固定后端对照，不做 CLI/MCP 优劣结论。详细近邻核查与全文未获得的缺口保留于[原研究报告](environment-contract-research-progress-2026-10-05.md)。

## 7. 当前完整论文的主要缺口与下一实验

1. **完整 host 判读证据**：模型尚未消费最后再观察结果，无最终完成/拒绝诊断；不能用 native oracle 替代。
2. **独立机制证据**：严格合格关系消融任务仍0，旧192次仅18个去 treatment 基底输入；有效 neutral control 尚缺。
3. **新颖性证据**：现有一般设计原则近邻已有，具体契约组织仍可能只是工程组合；关系论文全文核查与逐字段比较仍需完成。

下一项可审查模型方案：[H1 完成判断协议](../../evals/environment-contract-v1/codex-native-h1-completion-protocol.md)：三个独立新上下文、相同锁定任务、各最多10次，总最多30次、零重试。基于六次截尾结果形成，未授权、未执行；不复用本轮失败为成功，不合并成功率。先零模型校验十次硬限，再冻结精确配置。当前十八次已全部使用，不会提前调用。

此实验能改变完整判读主张，不能决定关系研究贡献。对于论文新颖性，最有价值的准备仍是先零模型找到跨来源的关系必要且公开可识别目标，锁定不会泄漏目标对应关系的 neutral-unbound 投影，再申请小型机制实验；不能绕过资格直接花模型预算。

## 8. Stop / Go / Pivot

- 当前判断 **Mixed**：真实 host 能自主完成两次正确输入，并对一次拒绝发起再观察；完整判读主张未成立。三个 episode 都截尾，不能包装成 Go。
- Host Go：后续两 stable 和 disabled 均有可核对的最终判读，只支持受控可行性。
- Stop：计数失控、需要人工接管、绕过 Prism；保留失败。当前预算耗尽，停止模型调用。
- 机制 Go：先独立资格、有效 neutral control，再出现可复核的 grounded action/refusal/漏检差异。
- Pivot：关系资格持续不成立或近邻覆盖一般原则，删除一般关系收益，收窄为浏览器执行契约的经验审计。若只有工程能力而无独立可复现发现，直接按系统工程报告定位。

## 9. 可开始写作的论文骨架

1. 引言：观察到输入的接口歧义，限定环境契约，不承诺总体成功率提升。
2. 相关工作：ACI/BrowserGym、refs 工具、TOCTOU、选择性重验证、MCP/Skill 的职责。
3. 契约：观察、引用和依据生命周期、校验顺序、回执状态；Agent 保留目标与完成判断。
4. 方法：任务先锁定、语义唯一性、独立 oracle、零模型资格、真实 host 独立上下文、请求计数与公开修订。
5. 结果：旧机制材料、新页面负边界、当前真实 Codex 的逐层结果；条件与来源分开报告。
6. 限制：相等检查过拒绝、截断/竞态、抽取不支持、部署适配、六请求截尾、单 host/model、两目标。
7. 讨论：什么反馈可支持动作与诊断；哪些保证依赖环境，哪些不能由 ACK 推导。
8. 结论：仅陈述经验证范围，关系贡献以独立机制证据为前提。

## 10. 最终判断

**现有证据支持继续研究“外部 Agent 的浏览器环境契约”，但不足以支撑完整研究论文已经成立。** 这次实际运行排除了“只有研究者代执行”的一个重要缺口；它没有证明完整自主判读，也未建立超出工程组合的独立研究贡献。

就 host 可用性，最少还缺模型实际消费再观察结果并明确正确判断的完整稳定/禁用轨迹。就整篇论文是否超出工程，最少还缺独立关系必要目标上的有效 neutral 控制与机制复现，或同等强度、近邻未充分覆盖的独立实证发现。仅多跑几个成功任务不足以改变新颖性判断。
