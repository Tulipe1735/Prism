# 个人助手运行指南

先在本机完成资料导入与一次问答，再配置手机和常驻服务。代码实现可离线验证；账号权限、真实收发和个人门户需要单独实测。

## 1. 初始化

```bash
pnpm install
pnpm build
cp .env.example .env
node --env-file=.env dist/agent.js init
node --env-file=.env dist/agent.js doctor
```

`.env` 不提交到Git。`init`
只创建研究起点与偏好，不读取任何私有账号，也不代表读过RSI综述或SimWorld Studio。运行
`serve` 前填写真实的
`ASSISTANT_INFRASTRUCTURE_CNY`；本地验证可填0。所有者和工作端使用两个不同的随机令牌，各至少24字符，例如分别运行两次
`openssl rand -hex 32`。

数据默认存放在 `.prism-assistant/`：SQLite为持久来源，`documents/`
为可读Markdown副本，`tasks/`
为研究候选、核查记录和最终报告。单个持久目录只运行一个常驻服务。备份前停止服务，再复制整个目录；Docker卷同理，勿只复制正在写入的SQLite主文件。

代码：[cli.ts](../src/assistant/cli.ts)、[config.ts](../src/assistant/config.ts)、[bootstrap.ts](../src/assistant/bootstrap.ts)、[store.ts](../src/assistant/store.ts)。

## 2. 模型与预算

填写已有的 `DEEPSEEK_API_KEY`，默认模型
`deepseek-flash`。模型和工具请求由自己的任务循环组织，不调用供应商的服务器搜索工具。

```bash
node --env-file=.env dist/agent.js ask "我的研究资料中有哪些不同的 Agent 改进路线？"
node --env-file=.env dist/agent.js ask "从同一问题出发比较原方法与替代路线，核对实验条件并给出下一步" --deep
node --env-file=.env dist/agent.js status
```

月度上限最高50元，先扣固定运行费，再按请求预占模型费用。默认输入/输出/缓存单价为每百万tokens人民币3/12/0.2元，是保守估算。2026-10-18查阅的[DeepSeek官方人民币价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)显示Flash高峰价2/8/0.04元；部署前重新核价，换模型时同步修改单价。估算无法替代供应商账单或限制账号在其他应用中的消费。

授权失效、超时或用量未知时不无限重试；未知模型用量按原预占上界估算，保留成果与原因。深入模式最多20分钟，包含模型、工具和等待；取消后停止新增工作。普通/深入对照使用固定快照，见[评测说明](../evals/assistant/README.md)，未取得实测评分前不声称深入模式必然更好。

代码：[runtime.ts](../src/assistant/runtime.ts)、[deepseek.ts](../src/assistant/deepseek.ts)、[prompts.ts](../src/assistant/prompts.ts)。

## 3. Notion 与本地资料

给自建服务单独配置
`NOTION_TOKEN`，授权所需页面与数据库。Codex里已有的连接不会自动成为本服务凭据。

```bash
node --env-file=.env dist/agent.js sync
node --env-file=.env dist/agent.js import notes.md paper.pdf resume.docx
node --env-file=.env dist/agent.js delete <document-id>
```

Notion同步读取授权页面、子页面与数据库记录，保存Markdown副本、原页面链接、版本及完整性信息。每天晨报前增量同步，也可主动触发。报告
`complete:false`
时先处理失败或截断范围；不能把已列出的顶层页面数当完整导入数量。临时错误保留旧内容；明确删除或403/404访问撤回会移除有效检索内容，并降级相关派生状态。

PDF需要可提取文本；扫描页和不支持的内容会标记未读。附件链接不表示正文已经读取。简历可用Markdown、文本PDF或DOCX导入，其他格式先自行导出。`delete`
删除当前资料与检索内容，历史任务仍保留其原始引用和报告供审计；历史成果不代表来源仍然有效。

代码：[connectors.ts](../src/assistant/connectors.ts)、[library.ts](../src/assistant/library.ts)、[store.ts](../src/assistant/store.ts)。参考：[Notion Markdown API](https://developers.notion.com/reference/retrieve-page-markdown)。

## 4. Gmail 与晨报

在Google项目中启用Gmail API，为自己的邮箱获取OAuth客户端和 `gmail.readonly`
的离线refresh token。填写
`GMAIL_CLIENT_ID`、`GMAIL_CLIENT_SECRET`、`GMAIL_REFRESH_TOKEN`；Google测试应用的授权有效期需按实际发布状态核对。

`GMAIL_QUERY`
默认筛选最近30天的arXiv邮件，可改为自己的订阅标签或条件。服务只读邮件，不发送邮件、不修改已读状态。消息ID和论文canonical
ID持久化去重，重复拉取不会生成重复资料；停机超过查询窗口后，先扩大查询范围补齐缺口。支持从邮件中提取arXiv候选，其他订阅邮件保留原始邮件证据，正文中的附件/链接不能冒充已读论文。

常驻服务从北京时间09:40开始准备，当日10:00交付；晚启动会在准备完成后补发。没有值得推荐的内容则静默。来源失败、预算不足或发送未知分别记录，故障与正常静默不同。手动准备不提前发送：

```bash
node --env-file=.env dist/agent.js brief
node --env-file=.env dist/agent.js status
```

发送前先持久化“结果未知”。若连接中断，先在飞书核对实际交付，不能自动重发。所有者可通过HTTP交付核对接口将未知记录标为
`sent`，或提供“确认未发送”的依据后标为 `pending` 再发送。

代码：[来源](../src/assistant/connectors.ts)、[调度与发件箱](../src/assistant/service.ts)。参考：[Gmail读取](https://developers.google.com/workspace/gmail/api/guides/filtering)、[GitHub Trending](https://github.com/trending)。

## 5. 手机上的两个飞书角色

在[飞书开发者后台](https://open.feishu.cn/)创建两个自建应用，分别启用机器人能力、允许个人账号使用，并配置消息读取/发送权限（按控制台提示申请
`im:message`、`im:message:send_as_bot` 以及私聊消息事件所需权限）。两个应用均订阅
`im.message.receive_v1`，选择长连接模式，发布到自己的可用范围。

填写各自APP ID、APP SECRET、与自己的私聊CHAT ID。把本人在两个应用中的OPEN ID填入
`FEISHU_ALLOWED_OPEN_IDS`，逗号分隔。服务同时检查发送者白名单和指定聊天ID；不要把不受信任的群聊设置成目标聊天。

```bash
node --env-file=.env dist/agent.js serve
```

情报角色接收晨报，两个角色都可提问。`/deep 问题` 发起深入研究，`/status 任务ID`
查看实际进度，`/cancel 任务ID`
取消。两个角色共用持久研究状态，同一角色/聊天接续历史；不同任务保存各自的运行记录。

- `/memory`：查看研究状态和规则。
- `/progress 新进展`、`/correct 纠正规则`：本人明确提供的内容保存为已确认。
- `/confirm-memory 记录ID`：核对现有候选内容后确认。
- `/forget 记录ID`：删除对应状态或规则。
- `/sync`、`/budget`：同步资料、查看费用余量。
- `/confirm 本地任务ID`：核对机器人展示的完整指令后确认原样内容。

助手自己的想法初始为待验证状态。推送记录、阅读记录、学习证据分别保存；修课与成绩不会自动升级为掌握。

代码：[feishu.ts](../src/assistant/feishu.ts)、[共享状态](../src/assistant/store.ts)。参考：[官方Node SDK长连接](https://github.com/larksuite/node-sdk/blob/main/README.zh.md)。

## 6. 云端常驻

选择长期月固定费用低于50元、能运行Node22或Docker且可访问所需API的服务；先填写真实费用，剩余额度供模型使用。仓库没有代购云资源，也不把试用额度当长期成本。

在已准备好的服务器上：

```bash
docker compose -f compose.assistant.yaml build
docker compose -f compose.assistant.yaml run --rm assistant node dist/agent.js init
docker compose -f compose.assistant.yaml up -d
docker compose -f compose.assistant.yaml logs -f --tail=50
```

资料保存在命名卷
`assistant-data`。飞书使用出站长连接，不需要公开Webhook。HTTP端口默认只绑定服务器本机；本地工作端通过SSH转发或自己的HTTPS反向代理访问。不要把带凭据的接口直接暴露为公网HTTP。跨网络时使用HTTPS，或将服务器端口安全转发到本机再使用localhost地址。

代码：[Dockerfile](../Dockerfile.assistant)、[Compose](../compose.assistant.yaml)、[HTTP](../src/assistant/http.ts)。

## 7. 翱翔门户与课程

在自己的电脑启动可远程调试的Chrome，并手动登录学校门户。使用专用浏览器配置目录，见[浏览器指南](browser-cli.md)。云端只排队任务，不接管登录凭据。

本机只需配置工作端令牌，运行：

```bash
node --env-file=.env dist/agent.js local-worker --logged-in --server https://your-assistant.example --browser-url http://127.0.0.1:9222
```

`--logged-in`
表示你已完成登录，无法代替门户实际登录状态检查。离线时任务等待设备；页面跳到登录页时助手须报告需要登录。点击、填表、选择操作先展示完整命令并由本人确认；更改内容必须新建任务重新确认。不支持自动选退课或撤销申请。

工作端使用公开Prism CLI，先观察和取得关系证据，再执行当前引用。收到 `executed`
后仍需读动作后的页面；未知输入先查询receipt与页面，不重放业务动作。本地回执日志先落盘再上报，工作端中断后先核对待交回执。

课程工具读取nwpu-cram真实目录和版本；Markdown/文本可读取，PDF等链接明确标为未读，可下载后手动导入。已修、在修和考试时间依据门户或本人确认，社区目录不证明修课或掌握。

代码：[local.ts](../src/assistant/local.ts)、[courses.ts](../src/assistant/courses.ts)、[CLI](../src/interfaces/cli.ts)、[会话与回执](../src/cli/sessions.ts)。

## 8. HTTP与验收

所有者使用 `Authorization: Bearer <ASSISTANT_OWNER_TOKEN>`。工作端令牌只允许
`/worker/*`，不能读研究状态或确认动作。请求正文上限1MB；文件从服务所在设备用CLI导入。

| 接口                                                              | 用途                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| `POST /tasks`                                                     | `{message,role?,effort?,conversationId?,id?}`，返回任务ID           |
| `GET /tasks[/id]`、`POST /tasks/id/cancel`                        | 查询结果、进度、引用与取消                                          |
| `GET /memory`、`PUT /memory/id`、`DELETE /memory/id`              | 查看、修改、撤回状态；修改带text/status/expectedUpdatedAt           |
| `GET /library`、`GET /library/search?q=...`、`DELETE /library/id` | 资料清单、当前引用与删除                                            |
| `POST /sync`、`POST /brief`、`GET /budget`                        | 同步、准备、预算                                                    |
| `GET /deliveries`、`POST /deliveries/key`                         | 未知交付核对，正文 `{status:"sent"或"pending",evidence:"核对依据"}` |
| `GET /local/id`、`POST /local/id/confirm`                         | 核对本地指令、原样确认                                              |

路径中的ID需要URL编码。真实账号的最小验收顺序：Notion首次完整性报告→Gmail实际订阅→一次DeepSeek带工具问答→两个飞书角色手机收发→次日10点晨报→本机已登录门户课程查询→课程资料复习结果。外部凭据未配置时，这些条目保持待实测。

离线主边界是“发起任务→结果、引用、共享状态与产物”；协议响应受控，SQLite和任务循环真实运行。来源协议、重启、预算、取消、未知交付及确认边界在
[tests/assistant](../tests/assistant)；真实浏览器语义在 [tests/cli](../tests/cli)。
