# 编写 Creator Mode 插件

本指南描述 Prism 自己的宿主契约。Cordis 管理插件的依赖和生命周期；工具、会话和事件由 Prism 定义。

## 最小插件

插件源码是自包含的 JavaScript ES module，导出 `apply(ctx)`，并用 `inject`
声明要使用的服务：

```js
export const inject = ["tools"];

export function apply(ctx) {
  ctx.effect(() =>
    ctx.tools.register({
      name: "text_length",
      description: "Count Unicode code points in a text.",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
      async execute(args) {
        if (typeof args.text !== "string") {
          return { content: "text must be a string", isError: true };
        }
        return { content: String(Array.from(args.text).length) };
      },
    }),
  );
}
```

工具名称由英文字母、数字、下划线或连字符组成，最长 64 字符。宿主内置工具与其他插件的工具不能重名，`creator_inspect`
和 `plugin_manager` 为保留名。每个注册都必须属于 `ctx.effect`；事件监听通过 `ctx.on`
注册，由 Cordis 自动清理。把可变状态放在 `apply` 内，重载会创建新实例。

## 安装与更新

在开启 Creator Mode 的会话中，Agent 先调用 `creator_inspect`，再调用：

```json
{
  "action": "install",
  "name": "text-length",
  "description": "统计文本中的 Unicode 码点数量",
  "source": "完整的 JavaScript ES module 源码"
}
```

`plugin_manager` 接受
`list`、`inspect`、`install`、`enable`、`disable`、`reload`、`remove`。除 `list`
外都要求 `name`；`install` 还要求
`description`、`source`。插件名称以小写字母开头，只包含小写字母、数字和连字符，最长 64 字符；源码最多 64,000 字符。

安装同名插件即更新。宿主卸载旧实例，加载新实例并原子保存记录；失败时清理新实例，恢复先前可用版本。工具列表在每次模型请求时重新读取，因此安装和调用新工具应分两轮完成。用真实的工具结果验证能力，再向用户报告完成。

管理端也可通过 `POST /plugins` 发送相同动作。请求必须使用
`Content-Type: application/json`；响应为 `{ "result": ... }`。列表查询为
`GET /plugins`，返回
`{ "plugins": [...] }`。完整接口见[内核参考](../reference/kernel.md)。

## 工具执行与权限

工具遵循 `src/kernel/tool.ts`：

- `parameters` 是以 `type: "object"` 和 `properties` 开头的 JSON Schema。
- `execute(args, context)` 返回 `{ content: string, isError?: boolean }`。
- `context` 含
  `workspace`、`sessionId`、`target`、`signal`、`permissions`、`requestApproval`。
- 会写文件、执行命令或操作浏览器的工具必须声明 `effects`。权限检查先于 `execute`。
- 使用 `context.signal`
  取消长操作；不要吞掉取消信号。停用或更新会撤销工具，并中止、等待正在执行的调用。

```js
effects: (args) => [{ kind: "file-write", path: args.path }];
```

命令效果为 `{ kind: 'command', command }`；浏览器动作为
`{ kind: 'browser-action', action, target }`。插件管理的修改动作按命令权限处理，只读模式拒绝这些动作；用户仍可从设置中管理插件。插件代码运行在内核进程，权限声明不构成沙箱。不要把不可信源码作为插件执行。

## 资源与服务

有依赖顺序时，用生成器 effect 注册资源和工具。清理按相反顺序执行：

```js
export function apply(ctx) {
  ctx.effect(function* () {
    const resource = openResource();
    yield () => resource.close();
    yield ctx.tools.register(createTool(resource));
  });
}
```

`openResource` 和 `createTool`
是示意函数，需要由插件实现。不要在 effect 之外注册工具或启动需清理的后台工作。

可以注入已存在的
`tools`、`config`、`sessions`、`model`、`permissions`、`approvals`、`instructions`、`skills`、`compaction`、`tasks`
服务。实际类型见
`src/kernel/context.ts`。依赖不存在时安装失败，并返回依赖名称。用户插件按名称顺序恢复；依赖其他用户插件的服务时，应保证提供者先加载，或在提供者启用后重载依赖者。

当前公开通知为 `prism/event`，载荷类型见
`src/kernel/events.ts`。它用于观察内核活动，不提供修改模型请求的中间件契约。

## 支持范围

模块可导入 Node 内置模块。当前使用内核直接加载自包含源码，不安装 npm 依赖，不支持相对导入和 TypeScript 语法。如果需要调用第三方软件，可以通过现有命令、MCP 或外部 CLI 提供能力。

当前没有前端插件插槽、任意 HTML /
JS 注入或 DSH 插件兼容层。DSH 专用服务、工具形状、事件、包版本和 UI 契约需要逐项核对。
