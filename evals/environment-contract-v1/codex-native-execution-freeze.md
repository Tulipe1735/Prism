# H1 原生 Codex：启动前执行补充

2026-10-05。真实请求前冻结。

实际工具为 codex-native-v5.ts、codex-native-host-v2.py、native-request-gate-v2.py、prism-file-entry.py、prism-file-executor.py。保留之前所有零模型失败与方法版本。安装版本禁止覆盖内置 provider ID，因此使用命名配置 prism_native，requires_openai_auth=true；其认证仍由现有 Codex ChatGPT 登录产生。模型 gpt-6.1-sol，固定上游 chatgpt.com/backend-api/codex，模型请求只经本地计数器。

当前 Linux sandbox 中允许 Unix socket 的选项未解除 AF_UNIX EPERM。因此 ./prism 入口只把 Agent 原样 argv/stdin 写到工作区文件，固定执行器自动调用冻结的 CLI，返回原样 stdout/stderr/exit。不会修改决策、选目标、指定 evidence 或补做命令。适配内部使用 Unix 观测回调来采集独立 oracle 与固定禁用事件；oracle 不回传 Agent。该结果只算「真实 Codex + 实验文件执行适配」，不能称原生无改 CLI 接入或跨 host 泛化。管理代理保持开启，允许域名列表为空；直接访问浏览器 TCP 的预检失败。工具轨迹规则不等于完整 OS 隔离。

上游连接遵循环境已有 HTTPS_PROXY，以 HTTP CONNECT 使用标准 TLS，凭据只在内存中。无认证 HEAD 返回 405，未产生推理。请求头认证仅固定上游转发，不保存。上游首个实际请求失败即停止本块后续 episode；不更换 provider/model，不重新运行。成功时顺序执行 CH1-01/02/03，每格硬上限六次。未用额度不转移。

启动依据：deployment-v4 七格全部 recorded、源码无漂移；correct/native goal=true 两格，wrong/neutral false 四格，disabled false、TARGET_CHANGED、无输入。native-host-v2-failure-precheck 原生 Codex 一次本地 HTTP500 POST，登录头存在，未重试。request-gate-v2-precheck 六次 mock 转发、七次阻止、未许可模型和路由阻止。此处所有动作由研究者预设，不能算自主成功。

主协议的任务、语义签名、分析规则与停止条件保持有效。基础设施错误、协议违规、预算耗尽均保留分母；不从失败改写任务。源码不改产品。模型完成前后分别报告可见观察、选择依据、校验、原生输入、回执、真实 goal 和自述。Go 仅为受控自主可行性；不足以证明独立研究新颖性。
