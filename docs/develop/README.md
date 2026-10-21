# 开发 Prism

## 运行

需要 Node.js ≥22.23.2 和 pnpm。源码放在实际运行环境的文件系统内。

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm workbench
```

`pnpm workbench`
启动内核和 UI 服务器，打印本地地址，使用与桌面版相同的工作台。Electron 入口为
`pnpm workbench:electron`；Windows 原生模式直接启动内核，WSL 模式准备并启动所选发行版中的运行时。

## 代码入口

| 路径                    | 职责                                           |
| ----------------------- | ---------------------------------------------- |
| `src/kernel/plugins/`   | Cordis 内置插件装配                            |
| `src/kernel/creator.ts` | Creator Mode、持久插件与模型侧开发契约         |
| `src/kernel/loop.ts`    | 模型请求、工具调用、执行记录                   |
| `src/kernel/server.ts`  | HTTP/SSE                                       |
| `src/workbench/`        | Electron、运行时准备、UI 服务器与 React 工作台 |
| `src/interfaces/cli.ts` | 外部 Agent 使用的浏览器 CLI                    |

编写扩展从[插件开发](plugins.md)开始。修改宿主接口时同步更新[内核参考](../reference/kernel.md)、调用方和相关测试。

## 验证

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
pnpm test
PRISM_WORKBENCH_BROWSER=1 pnpm exec vitest run tests/workbench/browser.smoke.test.ts tests/workbench/startup.browser.test.ts
```

Creator Mode 的 HTTP、同会话工具发现、持久化、失败恢复和清理测试位于
`tests/kernel/creator.test.ts`。浏览器 UI 测试使用真实 Chromium、真实内核和脚本化模型，不消耗模型额度。

在有 Windows Node 与 WSL 的机器上运行原生回归：

```bash
PRISM_WINDOWS_NATIVE=1 pnpm exec vitest run tests/kernel/windows-native.integration.test.ts
PRISM_WINDOWS_RUNTIME=1 pnpm exec vitest run tests/workbench/windows-runtime.integration.test.ts
```

## 打包和发布

Windows 构建需要 Node 和 pnpm；Linux / WSL 构建另需 Wine。

```bash
pnpm package:win
```

产物位于 `release/`。安装包包含 Electron、Windows 原生内核及 Linux Node /
WSL 内核载荷。缓存位于 `.packaging/cache/`，均不纳入 Git。

发布时同步更新 `package.json` 与
`src/shared/version.ts`。验证后，把对应源码提交推送到 GitHub，再发布指向该提交的版本标签。Release 必须包含
`Prism-<版本>-Setup-x64.exe`、同名 `.exe.blockmap`、`latest.yml` 和 `SHA256SUMS.txt`。
`latest.yml` 与 blockmap 来自同一次构建；应用内更新使用它们。

GitHub 上的 `Release Windows desktop`
工作流可以直接从已推送的版本标签构建并发布，避免从本地上传大安装包：

```bash
gh workflow run release-windows.yml -f tag=v0.3.2
gh run list --workflow release-windows.yml --limit 1
gh run watch <运行编号> --exit-status
```

工作流使用 Ubuntu
22.04 和 Wine，核对应用版本、内核版本及更新文件摘要后上传这四个发布文件。已有 Release 草稿中的说明保持不变；已公开的 Release 保留原有文件。

本地更新通过正常安装程序完成，保留会话、配置和插件。安装前完成或取消现有任务，再退出旧版本；完成后核对安装版本、启动工作台并验证现有数据可读取。
