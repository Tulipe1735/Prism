# Cordis 内核插件

Prism 直接采用 `cordis@4.0.0-rc.11`。`Kernel.create()`
等待内置插件完成初始化，HTTP 服务随后开始接收请求。工作台使用 `Kernel`
的会话、任务、设置与审批接口；任务循环通过声明的服务依赖访问能力，不再接收整个
`Kernel`。

## 内置插件

| 插件                    | 提供的能力                                      |
| ----------------------- | ----------------------------------------------- |
| configuration           | 当前配置；模型、浏览器和搜索每次使用时读取      |
| sessions                | JSONL 会话存储                                  |
| tools                   | 工具注册、查找、调用与撤销                      |
| model                   | 兼容端点的模型流式请求                          |
| permissions / approvals | 权限范围检查与一次性审批                        |
| instructions / skills   | 指令文件、技能发现与 `skill` 工具               |
| compaction              | 手动与自动上下文压缩                            |
| files / commands        | 文件工具、当前环境命令与 WSL 到 Windows interop |
| browser                 | Playwright 浏览器工具与连接                     |
| web                     | `web_search` 与 `web_fetch`                     |
| mcp                     | 配置中的 MCP 连接及其工具                       |
| excalidraw              | 会话画布、版本检查、Agent 读写工具和更新事件    |
| tasks                   | 会话任务互斥、任务循环、取消与关闭等待          |
| creator                 | 运行时检查、插件安装、持久化、启停和失败恢复    |

代码入口为 `src/kernel/plugins/index.ts`；服务类型与事件约定位于
`src/kernel/context.ts`。插件通过 `inject` 声明服务名，通过 `ctx.provide` 发布能力，通过
`ctx.on` 订阅事件。SSE 事件统一通过类型化的 `prism/event` 转发。

## 注册与退出

工具注册必须属于插件的 effect。存在资源释放顺序时，使用同一个生成器 effect；Cordis 按相反顺序调用其清理函数：

```ts
const plugin = {
  name: "example",
  inject: ["tools"],
  apply(ctx: Context) {
    ctx.effect(function* () {
      const resource = openResource();
      yield () => resource.close();
      yield ctx.tools.register(createTool(resource));
    });
  },
};
```

卸载时先撤销工具并中止、等待该工具的在途调用，再关闭资源。新调用无法继续使用旧的工具对象；重复清理不会移除后来注册的同名工具。依赖服务失效时，Cordis 负责停用依赖它的插件；任务插件会先取消任务、拒绝待审批请求并等待最后的日志写入。

`Tool.effects` 声明工具需要权限判定的动作；`ctx.effect()`
管理注册与资源清理。二者不互相替代，卸载也不会回滚文件修改或外部请求。插件生命周期不是操作系统沙箱，权限仍由工具执行前的统一检查负责。

新增内置插件时，在对应的 `plugins/` 模块导出插件，并加入装配入口。用户插件通过
[Creator Mode](../guide/creator-mode.md) 管理，源码与启用状态保存在数据目录的 `plugins/`
中。当前不提供插件市场、DSH 配置加载器或文件监听式自动热更新；显式安装、更新和重载立即生效。用户插件的具体契约见[插件开发](../develop/plugins.md)。

## 验证

`tests/kernel/plugins.test.ts`
覆盖内置能力加载、卸载后撤销注册、重载无重复、在途调用清理顺序、依赖重启，以及并发发送的会话互斥。任务、权限、压缩、MCP 和浏览器继续通过真实 HTTP/SSE 接口回归。

在 Windows 上运行默认测试会执行原生内核集成测试；在具有 Windows
Node 的 WSL 主机上可显式运行：

```bash
PRISM_WINDOWS_NATIVE=1 pnpm exec vitest run tests/kernel/windows-native.integration.test.ts
```

测试使用脚本化模型与临时目录，核对原生启动、中文路径、文件写入、命令输出、环境变量展开、进程树超时、任务取消，以及原生插件的安装、调用和重载。
