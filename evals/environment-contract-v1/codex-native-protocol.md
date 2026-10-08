# Codex 原生账号 H1：执行修订与前瞻协议

2026-10-05。沿用 codex-h1-v2-protocol.md 的 CH1-01/02/03、两个语义目标、扰动时点、分层评分、Stop/Go/Mixed 条件。用户已批准实验预算与仅限实验进程的本地 Unix socket 设置；随后要求直接使用 Codex。本修订在真实请求前形成，旧协议与失败记录保留。

改用本机 Codex 0.160.0、现有 ChatGPT 登录和现有配置的 gpt-6.1-sol。不读取项目 .env，不调用 OpenCode Go，不改变全局模型/权限配置。单独上下文只提供 Prism Skill、CLI、自然语言目标和 URL。零模型 standalone 命令预检仍由研究者控制，不能算自主成功。

通过进程级 model_providers.openai.base_url 覆盖，把原生 Codex 的 Responses 请求引向本地计数器，再原样转发到 https://chatgpt.com/backend-api/codex/responses。原生登录头只在内存转发，不写日志。请求与响应体留档；模型必须精确为 gpt-6.1-sol。禁用 websocket、自动压缩阈值提高、HTTP 与流重试设为零；模型目录请求不转发。计数器每 episode 最多转发六次，失败也扣额度，第七次拒绝；固定三个 episode 最多十八次。禁止重跑 episode 或重新启动计数器补额度。

启动门槛：Unix socket 与三个任务状态的零模型部署检查、正确/错误/未执行 oracle 标定、禁用调度、六次硬上限、真实 Codex 对本地 HTTP 500 仅发一次请求。预检须确认登录头送入本地入口，且没有其它推理入口；若无法控制实际请求，不启动。原生服务兼容性尚未验证，首个真实服务请求出现基础设施失败时停止后续 episode，保留失败，不更换模型或 provider 重试。

全部输出进入 work/codex-prism-native-2026-10-05，独立冻结源码、工具、页面、协议、输入与命令。模型开始前保存每 episode 的 prompt/config；三份任务定义已预锁定。JSON host 事件不能单独当作模型请求计数。记录主机网络限制与工具轨迹；不把轨迹规则声称为完整 OS 级隔离。

报告 observation、decision、validation、execution、goal completion、最终自述、错误执行、合法动作拒绝、弃权、未完成、基础设施错误和协议违规。ACK 或 refusal 不能当目标完成。即使三格通过，仅支持单 host/单 model/两个来源的受控可行性；关系必要性、跨 host 和独立研究新颖性仍未验证。
