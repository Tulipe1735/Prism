# DeepSeek V4.1 Flash 与 Prism

核对日期：2026-10-21。以下区分官方模型能力、Prism 当前实现和接入时需要完成的工作。

## 模型名称与上下文

官方 API 使用
`deepseek-flash`，当前指向 V4.1-Flash-1017；支持 1M 上下文，最大输出为 384K。这些是服务端上限，不是每次请求应使用的预算。来源：[模型与价格](https://api-docs.deepseek.com/quick_start/pricing/)。

Prism 当前的默认模型名称仍为 `deepseek-chat`，会话压缩阈值由 `src/kernel/config.ts`
中的配置控制。本次指引分离不会迁移已有模型设置或扩大上下文预算。长任务应按需读取文件，并保留目标、已确认事实、验证结果和待办，避免反复装入整个仓库。

## 思考模式与工具调用

官方默认开启思考，默认 effort 为 `high`，主要档位为
`low`、`high`、`max`；OpenAI 格式的开关是 `thinking: {"type": "enabled"}`，强度是
`reasoning_effort`。在携带 `tools` 的 Chat
Completions 请求中，需要完整回传历史 assistant 消息中的
`reasoning_content`，包括没有调用工具的轮次；缺失会导致 400。思考模式下 `temperature`
不生效。来源：[思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)。

Prism 已经接入这条通道：`model.thinking`（`low`、`high`、`max`，默认
`high`）随每次请求发送为 `reasoning_effort`；`src/kernel/model.ts` 把流式
`reasoning_content` 作为独立的 `reasoning`
事件交出，任务循环收集它但不再外发。思考内容写入会话日志（有正文的轮次记在 assistant 消息上，只有工具调用的轮次记在该轮首个
`tool_call` 上），`rebuildContext` 在重建历史时把它作为 `reasoning_content`
回传给模型，因此多轮工具调用不会因缺字段而400。压缩估算也计入思考文本。思考内容属于传输状态，不作为面向用户的任务结果输出；工作台只在输入框旁提供强度选择，不展示推理过程。改这里时仍要覆盖流式接收、消息存储、历史重建和压缩四个方面，不能只改提示词或模型名称就宣称兼容。

插件应提供明确的 JSON Schema、运行时参数校验和可检查的结果。普通工具调用与服务端
`strict` 是不同能力；官方 Chat Completions 的 strict 模式要求 `/beta` 端点和
`strict: true`，且有额外 schema 约束。Prism 当前未发送该标志。来源：[工具调用](https://api-docs.deepseek.com/guides/tool_calls/)。

## 缓存与指引布局

官方缓存复用相同的消息前缀，命中依赖前缀已持久化，且不保证每次命中。因此保持基础指引及 Creator 指引内容稳定，把任务进展放在后续消息中；仅按需读取额外参考。这是依据缓存机制做出的工程选择，并非模型要求的提示词格式。来源：[上下文缓存](https://api-docs.deepseek.com/guides/kv_cache/)。

## 视觉输入

`deepseek-flash` 支持图片；Chat
Completions 需要在 user 消息中传递图片内容块，而不是只给本地路径。来源：[视觉输入](https://api-docs.deepseek.com/guides/vision/)。

Prism 在 `src/kernel/model.ts` 中把 JPEG、PNG、GIF、WebP 附件编码为 base64 data
URL，作为 user 消息中的 `image_url`
内容块发送，同时保留附件名称、路径、大小和类型。媒体类型不可用时按扩展名识别图片；其它格式仍作为本地文件供工具读取。图片字节只在发送请求时加载，不写入会话日志。多轮工具调用、历史重建和压缩摘要使用同一传输路径；上下文估算按官方每张图片最多 1,024
token 的上限计入，而不是按 base64 长度估算。图片读取失败会使任务明确失败，不会静默回退到元数据。内联 base64 计入官方 48
MiB 请求体上限；当前没有 Files
API 上传通道，过大请求或不支持视觉的端点会沿模型错误路径报告。这些实现由本地模拟端点测试覆盖；真实模型是否识别图片仍需调用实际支持视觉输入的模型验证。
