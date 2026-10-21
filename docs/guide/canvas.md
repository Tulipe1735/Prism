# Excalidraw 画布

每个 Prism 会话都有一张可编辑的 Excalidraw 画布。用户手动绘图和 Agent 的修改使用同一份数据。

## 开始使用

1. 创建或打开会话，在右侧栏选择「插件」，点击 Excalidraw 卡片的「启动」。
2. 使用 Excalidraw 的形状、文字、箭头和自由绘图工具，或在对话里说：
   > 用画布画一个「用户 → Agent → 工具 → 结果」流程图。
3. 可以继续说：
   > 先读取当前画布，把「Agent」改成「Prism」，其余内容保留。

宽窗口中，画布与对话并排显示；窄窗口中，画布铺满窗口。点击画布工具栏右侧的放大按钮可切换大小，关闭画板后回到插件栏，画布与未发送的聊天草稿均保留。画布按需加载，首次打开前不下载 Excalidraw 的界面、样式或字体。

Agent 使用当前会话的 `excalidraw_read` 和 `excalidraw_update`
工具完成读写。画图不需要开启 Creator
Mode，也不需要额外配置 MCP 或模型密钥；使用当前会话的模型。Agent 修改画布遵循现有权限范围，只读模式拒绝修改。模型目前读取图形结构与文字，画布中的图片和自由手绘不会自动转成视觉模型输入。

## 保存与冲突

编辑后自动保存，底部显示「待保存」「保存中」或「已保存」。关闭画板不停止保存；重新打开会话会恢复已保存的图形、文字和图片。每个会话独立保存，删除会话时一并删除画布。

保存使用版本检查。用户、Agent 或另一个窗口同时修改时，过期的保存返回冲突，保留当前草稿并显示提示。点击「导出当前草稿并读取最新画布」可下载本地修改，再载入服务器中的最新版本。网络错误可重试保存。未保存草稿会尽量保存在浏览器本地；大图片可能超过浏览器存储上限，因此退出前应等待「已保存」或先导出文件。

## 导入与导出

- **导入**：支持 `.excalidraw`、Excalidraw JSON，以及带画布数据的 PNG /
  SVG；导入替换当前画布，可用 Excalidraw 撤销恢复。
- **导出 `.excalidraw`**：保留可编辑的元素与图片，可在 Prism 或 Excalidraw 中继续修改。
- **导出 SVG / PNG**：生成图片，便于分享或插入文档。

单张画布最多 20
MiB、10,000 个元素。字体与画布资源随应用打包，本地编辑和导出无需连接 Excalidraw 网站。

## 实现与验证

`src/kernel/canvas.ts` 是内置 Cordis 插件，提供存储服务和 Agent 工具。UI 仅通过
`GET/PUT /sessions/:id/canvas` 读取和保存场景，并通过 `canvas.updated`
接收已落盘的更新；渲染、测量、导入和导出复用官方 `@excalidraw/excalidraw`。

画布保存于当前内核的 `<dataDir>/canvases/<sessionId>.json`。工具按当前调用的 `sessionId`
定位数据，参数不能指定另一个会话。

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm exec vitest run tests/kernel/canvas.test.ts
PRISM_WORKBENCH_BROWSER=1 pnpm exec vitest run tests/workbench/canvas.lazy.test.ts
```

浏览器测试使用真实 Chromium、真实内核和脚本化模型，覆盖按需加载、手动绘图、自动保存、Agent 读取和修改、重新打开，以及三种格式导出；不消耗真实模型额度。
