# Prism：浏览器环境契约研究推进与证据审计

日期：2026-10-05。研究对象是当前外部 CLI 及其执行后端。建议保留论文方向，
但**当前证据不足以支撑一篇已经完成的“外部 Agent 浏览器环境契约”完整论文**。
当前已成立的是具体工程契约及受控机制事实；超出工程组合的独立研究贡献尚未充分建立。
先按匹配的 CCF C 类完整论文组织工作。没有依据承诺接收或提升到 B 类。

本轮新增真实模型请求 **0**。旧 192 次预算没有复用或扩充。没有提交、推送、发布、
修改产品源码或覆盖旧工件。新输出独立保存于
[work/environment-contract-2026-10-05](../../work/environment-contract-2026-10-05/)。
研究工具见 [evals/environment-contract-v1](../../evals/environment-contract-v1/)。

## 1. 题目与 thesis

推荐题目：**Prism: An Empirical Study of Observation-Bound Browser Contracts for External Agents**。

一句 thesis：

> We present a browser environment that separates agent decisions from observation-bound execution, and characterize when relational observations and selected-evidence validation support grounded input, trigger refusal, or leave failures undetected.

这是待完整证据支持的论文 thesis。避免声称“新范式”“CLI 替代 Skill/MCP”“完整语义验证”
或“浏览器事务”。如关系效应无法在独立任务成立，题目收窄到 **An Empirical Audit of
Browser Execution Contracts**，从 thesis 删除一般关系 grounding 主张。

## 2. 事实恢复与当前源码边界

已核对 AGENTS.md、README、Prism Skill、四份指定研究文件、cli-contract-v1 协议、
原始请求/响应、semantic audit、verification、冻结与源码归档，并检查当前实现。
旧 2026-10-04 内部 harness 的截图、广泛任务及自动控制能力不能转记为当前公共 CLI 能力。
本轮没有使用内部 Agent policy 来证明 CLI 的自主接入。

独立重算见 [old-raw-audit.json](../../work/environment-contract-2026-10-05/old-raw-audit.json)：
192 条原始模型记录、192 条 dispatch 记录、192 次请求、0 次 HTTP 自动重试，原始响应
决策、model 与 usage 均对应记录。两模型是 deepseek-v4.1-flash 和 glm-5.3-flash，
不是两个 host。旧模型总 usage 为 103321 输入、16676 输出、119997 total tokens；
这是 provider 报告值，不是独立 token 计量或费用估计。

| 原提示 | 核验结论 |
|---|---|
| 关系目标 Unbound 全部弃权 | 每模型 24/24，共 48/48；错误输入 0。Bound 共 48/48 正确输入。不能写成“阻止 48 次错误点击” |
| 只有 18 类语义输入 | **18 个去 treatment 的基底条件**。仅去临时 ID/URL、保留绑定 treatment 时为 **36 种完整输入**。192 次不是 192 个独立任务 |
| evidence 能阻止失效输入 | 读前 swap-group 的 group goal：identity-only 24/24 错误；consistency 24/24 拒绝；完成仍是 0 |
| evidence 会拒绝合法动作 | 同样 swap 对 entity goal：24/24 false refusal；local-note 对两个 goal 共 48/48 false refusal |
| 读取后变化有边界 | post-read-swap 的 group goal：两 gate 各 24/24 错误输入；关系校验没有封闭最后读到输入之间的竞态 |
| 截断有边界 | long-prefix group 对两 gate 各 4/4 错误输入；24 字符身份不是完整关系语义 |
| 弱 evidence / task-type rule | always-local 对 group 4/4 错误；always-relations 对 entity 4/4 false refusal；预设规则分别阻止 group / 放行 entity，但没有自主选择证据 |

18 类是先前事后审计的 treatment-erased 分组方式；本轮另保留 treatment-preserved 结果，
见 [qualification-audit.json](../../work/environment-contract-2026-10-05/qualification-audit.json)。
不改旧 semantic audit，不用重复请求生成网站总体置信区间。
旧 deterministic 主块为 720 条（96 coverage、592 action、32 CLI transport），
selected-evidence 为 24 条，均不能与模型样本或新独立页面混成一个成功率。
三个旧 source archive 与冻结清单对应；最终核验另确认旧原始结果和产品源码未改变。

当前契约的具体行为：

| 层 | 当前能力及其具体歧义消除 | 依据与限度 |
|---|---|---|
| observation | 返回 session、observation、offered target refs、operation 与 public evidence | [sessions.ts](../../src/cli/sessions.ts)。新 observe 替换旧观察；不是任意 DOM selector 接口 |
| target reference | ref 含观察身份；context 沿用同一观察；executed/unknown 后 ref 失效 | 指明“哪个观察里的哪个控件”；限制 lifetime，不证明选择符合目标 |
| selected evidence | act 必须引用当前 target 对应的已发放 evidence；重读所选公开 view 并比较 digest | [evidence.ts](../../src/browser/evidence.ts)。比较显示内容相等，不验证 goal predicate，也不证明它覆盖全部推理依据 |
| validation | 检查 document、node identity、label/state、所选 view；输入前再解析几何与 hit-test | [session.ts](../../src/browser/session.ts)。顺序读取仍有 TOCTOU；看过 rich view 后选弱 view 仍可被接受 |
| execution receipt | outcome/stage/code 与 request hash；持久 pending、查询及 exact replay | [receipts.ts](../../src/cli/receipts.ts)。ACK 不等于 grounding 或完成；unknown 不应自动重发新 id；不是跨崩溃 exactly-once 证明 |
| completion | 由外部 Agent 再观察并对照目标判断；研究 oracle 独立判定 | 环境不负责目标规划、策略或自主恢复 |

公共 CLI 控件抽取依赖 vendored snapshot，不能把该抽取器全部算作原创。
当前动作上限 250；local 80、nearby 120、section 48，关系身份 24 字符、祖先深度六。
关系身份依赖特定祖先类型及 direct-child 文本。没有公共 full-page reader、截图、iframe
或 shadow-DOM 遍历。password/file 等类型被排除。不同 scope 不是严格包含层级。

## 3. 能力、发现、贡献与未验证主张

| 类型 | 内容 | 当前证据 | 尚缺内容 |
|---|---|---|---|
| 产品能力 | 观察绑定 ref、target view、单步 gate、durable receipt | 当前源码、旧 CLI transport、新页面 CLI 调用 | 独立 host 自主使用与未知回执故障资格 |
| 经验发现 | 显式绑定影响受控 choice/弃权；不是 Unbound 错点击 | 192 原始请求，18 基底/36 treatment 输入 | neutral-unbound、独立关系必要任务；消除 ?? 的拒绝线索 |
| 经验发现 | 相等比较能拒绝失效动作，也会过度拒绝；弱依据/截断/最后竞态会漏检 | 旧 deterministic 原始事件与校验码重算 | 独立任务的相同取舍，不要求出现总体成功率提升 |
| 经验发现 | 控件 offered、输入 ACK 与目标完成可以分离 | 新密码排除、DataTables 缺关系及 full-goal failure、错误输入 ACK | host 是否读懂这些差异；更多完整目标 oracle |
| 候选贡献 C1 | 可检验的环境契约组织，明确 target/evidence/request 生命周期与责任 | 当前 CLI 实现及可复核资格方法 | 与现有工具逐字段对照、真实 host 轨迹，证明该组织解决实际歧义而非改名 |
| 候选贡献 C2 | 对关系观察与显示证据校验的条件性收益/损失进行机制刻画 | 旧机制负例、新外部来源边界 | 独立且关系必要的资格任务、neutral control、独立效应复现 |
| 未验证主张 | 自主正确依赖选择、自主恢复、更高效率、一般浏览器可靠性、跨 host 泛化 | 无充分证据 | 若坚持这些主张，另立专门协议；本论文不必承担 |

推荐仅保留 **两个候选贡献**，不把测试数量、CLI 包装或独立工件另算第三项：

**C1：把环境执行契约写成外部 caller 可检验的生命周期与反馈协议。**
解决旧 ref 是否可用、evidence 到底描述哪个目标、请求重复是否再次输入、ACK 是否完成等歧义。
Agent/环境分离本身不是新原则；可复用的是具体不变量与适用条件：引用绑定观察与 offered
operation；依据绑定公开 view；输入状态和完成状态分别呈现；环境不冒充意图 oracle。
这在当前实现中可检查，但“有用的新研究设计原则”尚需 host 轨迹与最近邻对照。

**C2：显示依据的完整性与相等比较共同决定 grounding、拒绝与漏检。**
问题是“状态变了”是否等于“计划已不合法”。Prism 的相等校验没有解决谓词级语义有效性，
而是提供一个可观察、有明确过拒绝与漏检边界的实例。已有原始证据支持受控边界，
新的外部页面也显示抽取缺失及 ACK/完成分离。还缺独立关系任务与 neutral control，
才能把结果提升为超出自制 fixture 的研究发现。

即使成功率没有显著提升，仍可研究：哪些公开依据足以区分目标；何种校验减少无效输入
却增加合法拒绝；哪些失败出现在观察、校验、输入或完成层；回执能说明什么与不能说明什么。
这些需要独立可重复证据，不因“负结果”自动构成贡献。

## 4. 最近邻工作的差异与重叠

文献核查时间为本轮日期。以下只用原始论文、出版社或官方规范。
“实现范围不同”不等于新颖性，也未进行这些工具的固定版本性能基线实验。

| 最近邻 | 已有重叠 | Prism 的具体差异及不能宣称的内容 |
|---|---|---|
| [Atomicity for Agents，2026-03，§5及限制](https://arxiv.org/html/2603.00476v1) | 浏览器观察到输入的 TOCTOU；执行前 DOM/layout 监测与拒绝；良性变化的代价 | Prism 对所选显示 view 比较而非整段期间监测记录；不提供原子执行。不能宣称首创验证再执行或已解决竞态 |
| [ATR，2026-09-07，§2–5、§7](https://arxiv.org/html/2609.08015v1) | version conflict/decision conflict、显式依据、选择性重验证、过度阻断与漏依赖 | ATR 是开发者编写 typed predicates、依赖图及目标 CAS/transaction；Prism 是浏览器 public view 相等性与 observation refs。后者没有更强语义保证；不能把选择性依据或状态/决策区别当原创 |
| [BrowserGym，2024-12，§3](https://arxiv.org/html/2412.05467v1) | Agent/环境分离、DOM/AX/bid、可配置 action mapping、错误反馈、独立 task validation | Prism 聚焦外部运行时的 view/ref/request receipt 生命周期。分层责任本身不是贡献 |
| [Playwright MCP 官方仓库](https://github.com/microsoft/playwright-mcp) | 结构观察、target refs、真实 host 支持；也提供 CLI+Skills 使用方式 | 需要逐字段比较 evidence 选择、validity 与 durable receipt；不能声称已有 refs 的工具没有 grounding 或 CLI 本身新颖 |
| [agent-browser 官方仓库](https://github.com/vercel-labs/agent-browser) | 面向 Agent 的 CLI、snapshot refs、daemon/state、Skill | 当前 README 描述 surviving DOM refs 可跨 snapshot 保留；Prism 新观察使旧 ref 失效。生命周期取舍不同，不是天然优胜。未把旧版本 issue 或旧 Skill 说明当作当前缺陷证明 |
| [Typed Actions position，2026](https://proceedings.mlr.press/v306/jiang26bj.html) | typed action、前后条件、环境接口设计的倡议 | Prism 仍是 browser control operations 与 public-state gate，不是业务 typed action，也无语义后条件保证；position 不是实测成功证据 |
| [Accord，2026-06，§3](https://arxiv.org/html/2606.16432v1) | 按 pending write 补环境依据；grounding Agent 批准/拒绝并反馈 | Accord 改 Agent 的探查/策略；Prism 将校验留在确定性环境中。不能把“写前补依据”或 approve/reject 作为新想法 |
| [SWE-agent](https://arxiv.org/abs/2405.15793)、[AgentOccam](https://arxiv.org/abs/2410.13825) | ACI、观察/动作表示能影响 Agent 行为 | 本轮核对原始摘要；仅用于定位接口研究脉络，不据摘要断言它们缺乏某项机制 |
| [SeeAct](https://arxiv.org/abs/2401.01614) | textual plan 与网页 grounding 区分；人工 grounding 的上界 | 支持必须区分 oracle/研究者执行与自主 Agent grounding；不是本项目的成功基线。本轮细节结论限原始摘要 |
| [RelationGUI / RelationAgent 出版页](https://www.sciencedirect.com/science/article/pii/S003132032600227X) | 元素间功能关系研究，与“关系有用”主张重叠 | 出版全文本轮返回 403；原摘要作为相关性入口，尚不能证明其接口/校验与 Prism 的具体差异。列为 novelty 核查缺口 |

[MCP 2025-11-25 tools 规范](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
允许 inputSchema、structuredContent、outputSchema 与工具级错误。完全可以在相同后端承载
observation、target/evidence refs、validation 及 receipt。没有规范限制使这些能力专属于 CLI。
[Agent Skills 官方概述](https://agentskills.io/home)把 Skill 定义为可复用使用知识及可选资源/脚本，
与 runtime 契约互补。本轮不新增 transport 对照，也不采纳官方仓库中的效率营销作为实证。

**novelty 判断：C1 目前更像工程组合；C2 有可审计机制材料，但近邻已覆盖大部分一般原则。
论文的独立贡献必须来自特定公开浏览器契约的实证刻画，不能来自换一种入口或名称。**

## 5. 本轮完成的零模型资格实验

[qualification-protocol.md](../../evals/environment-contract-v1/qualification-protocol.md)
及 tasks.json 在正式浏览器调用前冻结；假设来自前轮审计，属于 post-hoc hypothesis 后的
前瞻执行设计，不是外部预注册。冻结源码和来源归档见 qualification/freeze.json、source.tar.gz。

八页、六来源家族；五页本轮新获取，三页历史来源重用。外部作者写页面，研究者指定目标与
oracle。页面字节未改；local replay 不是实时网站或随机网页样本。研究者准备 scroll，
所有七个可用目标在初始 viewport 也已 offered。研究者知道 selectors 并映射 issued ref，
没有模型 decision；不能称为 Agent grounding 或 host 自主成功。

每页九个新 session：无输入、正确、错误、观察前 hidden、观察前 disabled、
观察后 hidden、观察后 disabled、关系/关联文本变化、精确重放，共 **72 条**。
保留全部八任务：67 recorded、5 unsupported、0 runner infra_error。正确目标密码被排除，
它的五项无法执行条件仍在分母。页面资源失败另报：136 次 404、13 个路径；
APG 动态文档资源、字体/图片缺失，主要控件仍可运行。错误监听是在页面准备后注册，
不能据空 page_errors 推断加载全程无错。另保留 MDN payment-form 源获取 404。

| 条件 | 原始记录结果 | 能支持什么 |
|---|---|---|
| neutral，8 | 0 input、0 goal | oracle 不因 no-input 误报完成；没有 Agent 弃权测量 |
| known correct，8 | 7 input/主要状态 predicate 达成；1未 offered | 输入级执行可用性，不是7个完整业务任务成功 |
| known wrong，8 | 8错误输入、8 ACK、0 goal | 环境不检查意图；ACK 不能证明 grounding |
| disabled-before，8 | 0 correct target offered | 排除条件有效；含原本未 offered 密码 |
| disabled-after，8 | 7 TARGET_CHANGED，无 input；1 unsupported | 拒绝旧引用下已 disabled 的目标；不是7次成功 |
| hidden-before，8 | 3仍 offered | 属性不等于有效 CSS visibility，需附诊断 |
| hidden-after，8 | 2 executed、4 TARGET_CHANGED、1 EVIDENCE_CHANGED、1 unsupported | 可见性/依据层混用规则，不应合并成 hidden 拒绝率 |
| relation-after，8 | 3 EVIDENCE_CHANGED、1 TARGET_CHANGED、3 ACK、1 unsupported | 其中 jquery 扰动未发生；仅两项真实文本变化未触发 gate |
| replay，8 | 7 exact replay 不增加事件；1 unsupported | 有限请求重放一致性，不是任意 crash/unknown 下 exactly-once |

正式块为 43 条初始 act、43 receipt 查询、另7 exact replay act；27 executed、16
not_executed。查询回执/实际事件不一致 **0**，独立评分重算差异 **0**。未知结果、断线 ACK
及崩溃未在新块测试，不能报成0风险。拒绝与未完成均分别保留。

补充诊断保存在不同目录，不重写正式结果：

- **visibility-probe：3 条**。APG tab、MDN textarea、jQuery span 的 hidden=true
  分别仍 display:inline-block/block/inline-block，checkVisibility=true；这解释 offered。
  强制 display:none 后三者都拒绝 TARGET_CHANGED、无事件，重新观察不再 offered。
  jQuery hidden-after 的 EVIDENCE_CHANGED 显示 context 与 target 使用的 hidden 规则不同。
- **oracle-probe：6 条**，两任务各 correct/wrong/neutral。Checkbox 保持第二控件原状态的完整
  oracle 通过；DataTables 填值正确仍未满足完整过滤与保留另一 filter 的合取谓词。
  原主块的7次状态达成照原样保留，不能改写成7个完整目标成功。当前可确认六个源任务的
 直接目标完成；DataTables为 input-level-only、password unsupported。
- DataTables 源监听 keyup；当前 fill 的 select-all keyup 在 insertText 之前，之后没有
  对应文本 keyup。这是过滤未发生的**源码支持解释**，本轮未做因果干预验证；没有修产品
  后重跑该负例。Gecko 身份在前置 sibling p，不在支持的祖先 identity 中，三 scope 均缺失。
- jQuery 初始化把关联 label 关系改到生成控件；冻结 selector label[for=speed] 不存在，
  relation_mutated=false。此项是仪器资格失败，不是一个有效机制对照。

开发块 development-01/02 各9条不并入正式结果。第一块研究者 ref 映射受额外导航控件影响，
错误目标与实际输入不对应；修复为签名等价类/节点映射后另建第二开发块，再冻结72条。
第一块原始失败保留。正式运行没有换目标、补输出或重试格子。

资格结果说明任务的“控件存在”“附带词存在”“必要绑定存在”“输入产生”“目标完成”
是不同层。一个可点的正确节点和43个一致回执，不能证明自主使用或整体可靠性。

## 6. 独立任务与语义签名

完整 signature、源哈希、观察字段与资格结论见
[semantic-signatures.json](../../work/environment-contract-2026-10-05/semantic-signatures.json)。
签名保留 goal、operation、实际语义 label/value、初始状态和必要关系；删除临时 ref/URL。
八个不同签名不是八个关系机制；仅 Gecko 的同名 Search 需要组身份，它未通过资格。
其余目标多数 local-sufficient，不能拿来稀释或“补足”关系实验样本。

| task | 外部来源 | 独立语义目标 / oracle | 必要关系与资格 |
|---|---|---|---|
| condiment-lettuce | [W3C APG checkbox-mixed](https://github.com/w3c/aria-practices/blob/main/content/patterns/checkbox/examples/checkbox-mixed.html)，新 | 勾选 Lettuce；native checked | fieldset 暴露；标签唯一，组限定冗余 |
| composer-tab | [W3C APG tabs-manual](https://github.com/w3c/aria-practices/blob/main/content/patterns/tabs/examples/tabs-manual.html)，新 | 激活 Ida da Fonseca；aria-selected | tab 唯一；上下文词存在，不等于需关系 disambiguation |
| postcard-message | [MDN postcard](https://github.com/mdn/dom-examples/blob/main/html/forms/postcard-example/index.html)，新 | msg 值等于规定文本 | 标签本地可区分 |
| checkbox-first | [The Internet checkboxes](https://github.com/tourdedave/the-internet/blob/master/views/checkboxes.erb)，新 | 第一框 checked、第二框保持 checked | ordinal / 无标签边界；页面标题不暴露，非组关系实验 |
| dropdown-two | [The Internet dropdown](https://github.com/tourdedave/the-internet/blob/master/views/dropdown.erb)，新 | native option value=2 | option 身份足够 |
| speed-menu | jQuery UI archived default selectmenu，复用 | 仅打开 speed menu；aria-expanded | 不代表选值/提交；label 扰动定位不合格 |
| gecko-filter | DataTables archived multiple_tables，复用 | Firefox 实际过滤、另一 filter 保持原状 | 必要 Gecko 分组不暴露；完整 goal 未确认，保留失败 |
| signin-password | Bootstrap archived sign-in，复用 | password 值等于规定文本 | correct fill 不 offered，unsupported |

新源来自浮动官方分支，但已保存获取日期与字节哈希；不冒称获取时的 commit pin。
旧三来源的具体字节以归档为准，本轮不声称它们是最新发行版或未见 holdout。

## 7. 真实 Agent host 接入状态

见 [host-preflight/results.json](../../work/environment-contract-2026-10-05/host-preflight/results.json)。

| 对象 | 实际检查 | 尚未验证 |
|---|---|---|
| Codex CLI 0.160.0，Linux 原生 | 原样 Skill 在隔离项目被 skills/list 识别；app-server command/exec 在 readOnly 下运行当前源码 CLI --help，exit0 | 这是独立管理命令，无模型决策；没有自主 observe/ref/act/拒绝反馈/receipt/completion 轨迹 |
| OpenCode 1.18.33，Windows exe/WSL shim | `debug skill --pure` 发现原样 Skill，UNC 路径可读 | 关闭外部插件是明确 host 基线变化；Linux Node/CLI 启动与浏览器 loopback 兼容性、实际 shell 工具调用尚未验证 |
| Claude Code shim | version 因 native binary 未安装失败 | 不算可接入 host；未新增安装 |
| 旧两个模型 + 最小调用器 | 单次模型输出 target/null，研究者代码执行 CLI | 两模型不是两 host；不是自主 host 集成 |
| 本轮资格器 | 知道目标/oracle 的确定性研究控制器 | 不是外部 Agent；不宣称 grounding 成功 |
| Codex + 本地 failure/SSE mock | 两个独立 mock block 检查 provider 关闭重试设置 | 不是真实模型、没有 browser decision，不可计自主成功 |

部署实际只复制原样 Skill 到各自 `.agents/skills/prism/`，没有全局配置改动。
Codex 命令使用 Node22.23.2 与 src/interfaces/cli.ts 的当前源码；实际部署需构建后再锁定
binary/artifact。OpenCode 官方 [Skill discovery](https://opencode.ai/docs/skills/) 与实际诊断一致。
Codex 的无 turn command/exec 依据是本地 host 生成并保存的 schema，而不是推测。

本地 HTTP500 mock 的模型 POST 只有1次（另有2次 models GET）；没有真实模型请求。
单个 mock body 为746199字节，来源于这个 host 的继承上下文；不是 token 计量，更不能
归因于 Prism 开销。全局工具/技能基线还未锁定。SSE 中断 mock 也仅有1次模型 POST（另2次 models GET），见
stream-retry-precheck.json；同样没有真实模型调用。不能以客户端 error 文本的重复次数推算实际 HTTP 请求数。
官方 [Codex 配置规范](https://learn.chatgpt.com/docs/config-file/config-reference)提供
request_max_retries/stream_max_retries；这不自动提供总调用硬上限。

## 8. 最小证据链与下一项模型实验

围绕同一个主张：**外部 caller 可以用该契约定位执行阶段和完成阶段的差异，且该机制
的收益与边界能在独立任务上被检验。** 不增 transport 矩阵。

| 环节 | 改变哪个 claim | 停止/收窄条件 |
|---|---|---|
| A：已完成72格 + 9诊断 | 产品 qualification、oracle 和契约阶段分离 | 不 offered、必要关系缺失、完整 oracle 失败均保留。本轮已停止“广泛独立关系任务资格成立” |
| B：H1真实单 host | C1是否真的可被外部 Agent 自主使用和解释 | 依赖研究者接管、猜 ref、ACK 虚报完成或不受控调用时，停止自主使用主张 |
| C：旧机制复用 + 独立 M1 | C2关联边与校验取舍是否超出 ??/自制任务 | neutral-unbound 消除效应或 Bound 在独立任务也无效时，收窄/停止关系效应 |

**最有价值的下一项模型实验是 H1，不是更多旧 fixture 重复。**
[冻结设计协议](../../evals/environment-contract-v1/next-model-protocol.md)锁定四个新源任务的
稳定 episode，再加 APG/MDN 两个观察后 disabled episode：一个真实 Codex host、一个
待明确锁定的模型、六 episode、四个语义目标、三个来源家族，建议真实模型请求上限 **36**
（六/episode）。不自动 HTTP/SSE 重试，不补失败格，不把 host turn 当一次请求。

H1能改变外部使用与反馈解释的可信度，但即使全通过，也不证明一般关系效应。
模型/provider、最终调用计数器、部署及扰动调度的 executable freeze 尚未完成。
本轮冻结的是任务与分析设计，**不是完整可启动模型运行协议**。因此没有现在申请预算，
也没有因预算停止本轮可完成的零模型资格、源码与文献工作。未来完成上述门槛后，
才向用户请求最多36次新增预算。若不能约束真实请求，就不启动该 host 研究。

M1另在同一协议给出24次上限设计：四个独立关系必要任务 × Bound/Neutral-unbound/
Marked-unbound × 两模型，单决策/格，由最小调用器执行；它不是两host。当前可用合格
关系任务为 **0**，不能请求这项预算。需先冻结新 cohort，neutral 删除对应边而不放入 ??
拒绝提示，保持其它后端/观察/候选/参数/校验/回执；不增 transport 对照。
自主 evidence 选择、恢复或效率不作为主贡献，不默认安排专门矩阵。

## 9. 当前完整论文的缺口与 Stop / Go / Pivot

| 判断 | 明确条件 |
|---|---|
| Go 写作准备 | 当前契约、原始机制、资格失败与局限可先写；全部支持材料可追溯 |
| Go 完整论文证据 | H1出现跨至少两个来源的无需接管轨迹与诚实拒绝诊断；独立关系必要任务通过oracle/抽取资格；neutral 对照支持或明确收窄关联效应；完成最近邻字段/语义对照 |
| Stop 当前关系泛化 | 独立任务必要关系继续不暴露，或只有 marked-unbound 出现效果；不能用更多相同模板调用弥补 |
| Stop 可靠执行主张 | 出现 receipt与实际输入不符、误把 ACK 当完成、未知结果导致重复输入；按边界收窄，不重写原负例 |
| Pivot 至 empirical contract audit | host能调用但关系新贡献不成立：重点研究 observation coverage、校验过拒绝/漏检、receipt/completion 区分；须证明其诊断方法在独立任务有价值 |
| Pivot 至工程论文/工具报告 | 若最后只有 refs、CLI+Skill 和常规 gate 组合，而受控事实也未提供独立启示，直接承认没有完整研究贡献，不靠“可组合/可迁移”补叙事 |

主要缺口依优先级：真实 host 自主完整轨迹；关系必要且公开依据充分的独立 cohort；
neutral-unbound 的辨别性；与 ATR/Atomicity/现有浏览器工具的可检验机制区别；
足够完整的目标 oracle 与来源 replay 忠实度。unknown/崩溃若写进可靠性贡献则另需专门
故障实验。无需先做通用规则语言、事务系统或复杂 adaptive policy。

## 10. 可直接开始写作的论文骨架

| 章节 | 现在可写 | 明确留白 |
|---|---|---|
| Abstract | 问题、环境范围、受控效应与负边界；不写总体成功率提升 | 外部 host / independent relation 结果 |
| Introduction | caller看到依据后环境变动；节点可点不等于任务合法；ACK不等于完成 | 两候选贡献须按最终证据降级/收窄 |
| Related Work | ACI/环境、关系 grounding、TOCTOU、typed premises、Skill/MCP | RelationGUI 全文与工具固定版本语义对照 |
| Contract & Scope | observation/ref/evidence/request生命周期、责任、结果分类、CLI部署 | 新增接口不能偷换冻结版本 |
| Study Design | 18基底/36 treatment 的受控研究；A资格、H1 host、M1 neutral分开 | H1/M1未执行不能写 Results |
| Results | 原始模型choice/弃权；读前/读后/截断/弱scope的机制；72+9资格边界 | 自主决策、一般迁移、效率 |
| Discussion | public-view equality 的代价、抽取不足、竞态、回执诊断上限 | 不以预设规则证明自主依赖选择 |
| Threats to Validity | 自制语义重复、?? cue、非随机样本、历史来源重用、缺资源、privileged readiness、有限oracle | host基线、provider版本与未知结果 |
| Artifact Appendix | 协议、任务源/哈希、原始记录、独立审计、执行前freeze与后续修订 | 未来发布许可/去凭据检查另行处理 |

正式及补充执行源码均在各自 archive 中保留。visibility-probe 在执行后只补了两处会被
运行时擦除的 TypeScript non-null assertion，以通过类型检查；
[post-run-type-amendment.json](../../work/environment-contract-2026-10-05/post-run-type-amendment.json)
记录前后哈希。原运行归档与结果未改，不将当前文件与旧freeze一致性混为一谈。
类型检查通过；现有两份研究测试共7项通过；独立原始评分审计无差异。最终验证与完整
新证据 inventory 见 verification.json / final-freeze.json。

**最终判断：现有证据支持继续沿这条主线研究，也支持写契约与受控边界；不足以声称
完整外部 Agent 研究论文已经成立。最少能改变判断的新增证据包是：真实外部 host 在独立
页面自行 observe→选ref/evidence→act→解释拒绝/回执→检查完整goal，且至少一组关系必要
任务通过独立oracle资格并经 neutral-unbound 检验。H1先补真实使用，M1补关系因果辨别，
二者不能互相代替。若不保留关系效应主张，最小门槛可收窄为 H1 加独立机制诊断价值；
仍须说明它超出已有工程组合的研究所得。当前尚不能排除最终只有工程能力这一结果。**
