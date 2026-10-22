# Bundle 插件开发

Prism 用户插件是包含 manifest、多个源文件、可选 UI 和资源声明的 Bundle。Cordis 管理生命周期；Agent 仍使用同一个执行循环。

## 目录与契约

```text
plugins/my-plugin/
├── prism.plugin.json
├── package.json           # 工作区开发使用；运行时安装依赖以 manifest 为准
└── src/
    ├── index.ts           # 后端
    ├── helpers.ts
    ├── client.tsx         # 可选 UI
    └── style.css
```

```json
{
  "schemaVersion": 1,
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "插件用途",
  "backend": "src/index.ts",
  "dependencies": {},
  "ui": [
    {
      "id": "main",
      "slot": "workbench.panel",
      "title": "我的插件",
      "entry": "src/client.tsx"
    }
  ]
}
```

后端与 UI 支持 TypeScript、TSX、JavaScript、相对模块导入和 CSS。SDK 入口为
`@prism/plugin-sdk` 与
`@prism/plugin-sdk/client`。插件通过这两个入口编写，宿主构建器注入 SDK；后端的 Node 内置导入保留，其他已声明依赖编译进独立 CJS 后端产物，支持 npm 的 CommonJS 和 ESM 依赖。初始化的异步工作放在 async
apply 中。

源 Bundle 的 JSON 形状为
`{ manifest, files: { "src/index.ts": "完整源码", ... } }`。最多 128 个源文件、合计 1
MB、32 项直接 npm 依赖、16 个 UI 声明。路径使用相对 POSIX 格式；拒绝路径越界、源目录内的符号链接、保留路径和重复 UI
ID。支持的文本扩展名在 `packages/plugin-manager/src/bundle.ts` 中定义。

## 准备、启用与重载

Creator Mode 中先调用 `creator_inspect`，再通过 `plugin_manager`：

```json
{
  "action": "install",
  "bundle": {
    "manifest": {
      "schemaVersion": 1,
      "name": "hello",
      "version": "1.0.0",
      "description": "问候",
      "backend": "index.ts"
    },
    "files": { "index.ts": "export function apply() {}" }
  }
}
```

`install`
只校验、安装依赖和构建，**不求值插件模块、不调用 apply**。首次准备的插件保持停用；更新形成待启用版本，原版本继续运行。经用户授权后单独发送
`{ "action": "enable", "name": "hello" }`。启用失败时撤销新工具和 RPC、释放资源并恢复上一版；同时显示失败原因。

支持的动作：

| 动作      | 参数        | 行为                                                       |
| --------- | ----------- | ---------------------------------------------------------- |
| `list`    | 无          | 摘要与状态                                                 |
| `inspect` | `name`      | 完整待启用 Bundle；没有待启用版本则返回当前版本            |
| `install` | `bundle`    | 准备可移植源 Bundle                                        |
| `develop` | `directory` | 从绝对目录准备开发快照                                     |
| `enable`  | `name`      | 显式启用待启用版本或已保存版本                             |
| `disable` | `name`      | 停止监听、撤销 UI/工具/RPC、取消并等待在途调用             |
| `reload`  | `name`      | 重建已启用开发实例，或重建当前已保存实例；停用插件须先启用 |
| `remove`  | `name`      | 停用并删除安装记录和构建产物；保留插件持久数据             |

管理端的 `POST /plugins` 接受相同 JSON。修改请求要求
`Content-Type: application/json`；模型侧修改还经过命令权限检查。已启用插件在关闭 Creator
Mode 后继续运行。

开发设置中输入含 `prism.plugin.json` 的目录，点击“准备 Bundle”，检查后点击“启用”。这与
`develop`、`enable` 两个动作相同。启用开发目录后递归监听源文件，150
ms 合并变更；忽略隐藏目录、`node_modules`
和构建输出。每次重载重新编译整个模块图，嵌套模块也会更新。构建失败时保留原版本；初始化失败则恢复原版本；修复源文件后继续监听。新增依赖仍需宿主批准，不会因热重载跳过检查。

## 受控 npm 依赖

直接依赖只接受精确版本，例如
`"zod": "4.6.5"`。范围、标签、URL、Git、file/link/workspace 和 npm
alias 均不可用于运行时 manifest。未声明的源代码包导入、导入宿主源码或宿主依赖均被构建器拒绝。

宿主拥有批准清单：`<dataDir>/plugins/dependency-policy.json`，默认清单为空：

```json
{ "allowed": { "zod": ["4.6.5"] } }
```

插件管理工具没有修改批准清单的动作。安装只使用该清单批准的直接依赖，在独立目录生成
`package.json`，调用随 Prism 提供的固定 pnpm，禁用生命周期脚本和 pnpmfile
hooks，固定公共 npm
registry，并保存 lockfile。缓存、包存储、源文件与构建产物均在插件管理目录内。相同依赖集合复用已安装快照；每次准备仍检查批准清单。

批准直接依赖也信任它的传递依赖；传递版本和完整性由生成的 pnpm
lockfile 固定。依赖声明限制安装与构建，**不构成运行时沙箱**。插件启用后仍在内核进程中执行可信代码。

## 后端、工具和资源

```ts
import type { BundleApi, Context } from "@prism/plugin-sdk";

export const inject = ["tools"];
export function apply(ctx: Context, api: BundleApi): void {
  ctx.effect(() =>
    ctx.tools.register({
      name: "text_length",
      description: "Count Unicode code points.",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
      async execute(args) {
        if (
          args === null ||
          typeof args !== "object" ||
          !("text" in args) ||
          typeof args.text !== "string"
        )
          return { content: "text must be a string", isError: true };
        return { content: String(Array.from(args.text).length) };
      },
    }),
  );
  ctx.effect(() =>
    api.rpc.register("echo", async (input, context) => ({
      input,
      sessionId: context.sessionId,
    })),
  );
}
```

`ctx.effect` 管理资源；在 `apply`
内保存可变状态。工具执行契约沿用统一权限、取消和结果处理。写文件、命令、浏览器动作声明对应的
`effects`。`creator_inspect`、`plugin_manager`
为保留工具名；插件不能注册同名内置工具。运行时还追踪插件的直接工具注册，初始化失败和卸载时会撤销它们。

`BundleApi` 提供独立的 `dataDir`、插件命名空间内的
`rpc.register`、`emit(name,data,sessionId?)` 和
`onSessionRemoved`。RPC 上下文由宿主提供真实会话 ID 和取消信号，拒绝不存在的会话；插件实现自己的输入校验。可抛出
`PluginError(code,message,status)`，经通用传输返回，不需要向宿主错误枚举添加插件专用值。RPC 面向用户界面；Agent 工具仍通过工具注册与权限检查执行。

## 十个 UI Slot

| Slot                | 呈现位置                         |
| ------------------- | -------------------------------- |
| `workbench.header`  | 工作台顶栏，工作区名称之后       |
| `workbench.sidebar` | 左侧栏，工作区选择与会话列表之间 |
| `workbench.panel`   | 右侧「插件」页打开的全高抽屉面板 |
| `workbench.status`  | 工作台底部状态栏                 |
| `session.header`    | 会话标题栏，压缩上下文按钮之前   |
| `session.toolbar`   | 会话标题栏下方的工具栏           |
| `session.footer`    | 对话内容之后、审批与输入区之前   |
| `composer.toolbar`  | 输入框与发送操作之间的工具栏     |
| `inspector.panel`   | 右侧「产物」页，文件列表之后     |
| `settings.panel`    | 右侧「设置」页扩展区             |

顶栏、状态栏、会话标题栏与两种工具栏使用紧凑的 40
px 高 iframe，多个贡献横向排列并可滚动。侧栏、会话底部、详情与设置使用 192
px 高的内容 iframe，区域限制高度并支持纵向滚动。主面板不占布局位置：它在右侧栏「插件」页按需打开成占满窗口高度的抽屉，同一时刻只挂载一个选中的面板，关闭按钮或 Esc 收起。没有贡献时不占位；侧栏折叠或详情标签切换时撤销对应的 iframe。

十个位置使用同一套 session 绑定、RPC、事件与 revision 重载规则。Slot 提供呈现位置；输入区插件仍通过自己的 RPC 工作，当前 SDK 不提供读取或改写宿主未发送草稿的操作。单个 Bundle 可声明多个位置，也可在同一位置声明多个具有不同 ID 的贡献。

UI 编译成独立浏览器产物，在插件自己的 iframe 中运行。框架依赖也属于 Bundle；无需与宿主共享 React 实例。UI 源码不能导入宿主前端。面板首次打开才请求脚本、样式与字体。停用撤销资源路由和 UI 声明，重载通过新 revision
URL 更新打开的界面。

```ts
import { PluginClient } from "@prism/plugin-sdk/client";
const client = new PluginClient();
const stop = client.onContext(async ({ sessionId, connected }) => {
  if (sessionId === null || !connected) return;
  const answer = await client.request("echo", { text: "hello" });
  document.getElementById("root")!.textContent = JSON.stringify(answer);
});
window.addEventListener(
  "pagehide",
  () => {
    stop();
    client.close();
  },
  { once: true },
);
```

客户端用父窗口消息桥接调用本插件 RPC 和订阅事件。宿主验证消息来源、插件身份和会话绑定；不同会话重建 iframe。原会话的迟到请求不能写入新会话。iframe 将样式与展示生命周期分开，使用同源脚本以支持字体 Worker；它**不是不可信前端代码的安全沙箱**。只启用可信 UI。

`assets` 可将 Bundle 文本资源或已声明依赖的资源复制到 UI 产物，例如：

```json
{ "from": "node_modules/@excalidraw/excalidraw/dist/prod/fonts", "to": "fonts" }
```

## Excalidraw 与工作区组织

`plugins/excalidraw` 是标准 Bundle，迁移自 Git 历史 `9071d5a`
的画布实现。工具、版本冲突保护、自动保存、草稿恢复、导入导出、字体与 UI 均由插件拥有；宿主源码没有 Excalidraw 分支、组件导入、专用路由或事件类型。旧
`<dataDir>/canvases` 仍可读取，新写入使用插件持久数据目录。

`pnpm build`
构建并分发插件；新安装默认停用，在设置中启用即可。后续添加插件只需遵循 manifest 与 SDK，无须重新构建或修改宿主前端。仓库中的标准插件作为随应用发布的产物才会参与整包构建。

当前工作区抽出 `packages/plugin-sdk`、`packages/plugin-manager`、`packages/runtime` 与
`plugins/excalidraw`。现有 CLI、桌面入口和浏览器模块保留原位置，避免把目录搬迁混入功能升级。`cli-anything`、`computer-use`
尚未实现。本次未引入会话级 preset；Creator 开关和后端工具组成仍属于当前内核，共用一个 Agent 循环。

设计参考：[DeepSeek Bundle 分发](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish)、[UI Slot 生命周期](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/slots)和[组合与 HMR](https://deepseek-harness.github.io/deepseek-harness/en/develop/cordis-tutorial/06-composition-and-hmr)。这里只采用当前需求需要的 Bundle、固定 Slot 和 effect 生命周期。
