# Creator Mode

Creator
Mode 让 Prism 在对话中准备可复用插件。插件现在使用多文件 Bundle，支持受控 npm 依赖、可选 UI 和开发热重载。

## 开启并许愿

1. 在设置中开启“允许 Agent 创建和更新插件”。设置保存到当前运行环境的 `config.json`。
2. 描述能力、验证方式，以及是否授权启用。例如：“做一个统计中英文词数的插件，启用后用空文本、中文和英文验证。”
3. Agent 调用 `creator_inspect` 检查宿主契约，用 `plugin_manager install`
   准备 Bundle；依赖安装和构建完成后，再单独 `enable`。

准备不会执行插件代码。开启 Creator 开关本身不授权某个插件运行；用户已经明确要求启用时可沿用授权。启用后，新工具在下一轮模型请求中出现，仍需实际调用验证。

标准模式读取适用的 `AGENTS.md`；开启 Creator 后，宿主还会自动读取随安装分发的
[`skills/prism/creator/SKILL.md`](../../skills/prism/creator/SKILL.md)。`creator_inspect`
返回同一份指引和实时工具、插件列表。关闭后不再向新请求附加指引，历史记录仍保留；已启用插件继续工作。

DeepSeek V4.1
Flash 的模型 API 与当前传输区别见[接入说明](../../skills/prism/creator/references/deepseek-flash.md)。

## 管理与开发

在右侧栏的「插件」页可以查看插件状态、启用、停用、重载和移除。已准备的更新通过“启用更新”生效；准备时原版本继续运行，启用失败会清理新实例并恢复旧版，错误仍显示在卡片中。

开发自己的插件时，在“开发插件目录”输入含 `prism.plugin.json`
的绝对路径，点击“准备 Bundle”，检查后启用。嵌套源文件、UI 和样式修改会自动构建并重载。构建失败保留原版本，修复后继续监听。停用会停止监听和撤销工具、RPC、UI，并取消在途调用。

随应用提供的 **Excalidraw**
也是同一契约的标准插件。启用后，在「插件」页点击“打开 Excalidraw”，画布会从右侧以全高抽屉打开；每个会话独立保存画布。它支持人和 Agent 编辑、自动保存、冲突保护，以及
`.excalidraw`、SVG 和 PNG 导入导出。宿主前端只认识通用 Slot。

## 依赖和保存位置

npm 依赖要求精确版本，并先在 `<dataDir>/plugins/dependency-policy.json`
批准。插件管理器不能修改这份批准清单；未批准的依赖会在构建前明确报错。Prism 随附 pnpm 和构建器，安装脚本与 pnpmfile
hooks 禁用，依赖使用独立存储和 lockfile。

安装记录和构建快照位于 `<dataDir>/plugins/`，插件数据位于
`<dataDir>/plugin-data/<name>/`。旧单文件记录会自动迁为 Bundle，保留原启停状态。移除插件保留其数据。Windows 默认数据目录为
`%USERPROFILE%/.prism`，WSL 为 `~/.prism`；切换环境不会自动同步插件和数据。

后端插件以当前内核进程权限执行，UI 也只适合可信代码；依赖批准、工具权限和 iframe 都不是操作系统安全沙箱。当前 Creator 设置与后端插件组成仍作用于整个内核，会话级 preset 隔离尚未实现。DSH 插件的宿主契约不同，需要适配后再使用。

完整契约和示例见[插件开发](../develop/plugins.md)。
