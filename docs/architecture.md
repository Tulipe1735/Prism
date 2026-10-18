# 架构与代码

![Prism 架构](architecture.svg)

由 Excalidraw MCP 创建、渲染并检查。编辑
[architecture.excalidraw](architecture.excalidraw) 后同步导出 SVG。

| 模块       | 职责                                                   | 对应代码                                                                                                                          |
| ---------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| 信息来源   | Notion Markdown、Gmail MIME、真实Trending、arXiv、网页 | [connectors.ts](../src/assistant/connectors.ts)                                                                                   |
| 课程资料   | nwpu-cram 索引、版本和正文；不推断个人修课状态         | [courses.ts](../src/assistant/courses.ts)                                                                                         |
| 任务编排   | 晨报准备/交付、后台任务、本地确认与续跑                | [service.ts](../src/assistant/service.ts)                                                                                         |
| 自写循环   | 模型→工具→反馈，深入模式查找/核查/修订并保留较好成果   | [runtime.ts](../src/assistant/runtime.ts)、[prompts.ts](../src/assistant/prompts.ts)、[deepseek.ts](../src/assistant/deepseek.ts) |
| 交互入口   | 飞书角色、命令行、所有者/工作端权限                    | [feishu.ts](../src/assistant/feishu.ts)、[cli.ts](../src/assistant/cli.ts)、[http.ts](../src/assistant/http.ts)                   |
| 个人资料   | Markdown、文本PDF、DOCX导入与未读标记                  | [library.ts](../src/assistant/library.ts)                                                                                         |
| 持久信息   | SQLite、FTS5、Markdown；状态、引用、任务、预算与队列   | [store.ts](../src/assistant/store.ts)、[types.ts](../src/assistant/types.ts)                                                      |
| 本地门户   | 用户已登录的电脑执行公开CLI，原样确认与回执核查        | [local.ts](../src/assistant/local.ts)、[CLI](../src/interfaces/cli.ts)、[sessions.ts](../src/cli/sessions.ts)                     |
| 设置与部署 | 环境配置、研究起点、持久目录与单实例常驻               | [config.ts](../src/assistant/config.ts)、[bootstrap.ts](../src/assistant/bootstrap.ts)、[Compose](../compose.assistant.yaml)      |

云端不托管个人教务登录。关键动作先展示完整指令；发送或输入结果未知时先查实际结果。研究状态共享，任务会话按角色和会话ID隔离。
