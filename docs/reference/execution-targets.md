# 执行目标：Windows 与 WSL

桌面启动时选择 Windows 原生或 WSL，同一套 Cordis 内核在所选环境运行。一个桌面实例仅有一个内核；文件工具直接使用该环境的路径，命令工具默认使用该环境的 shell。

| 内核运行环境 | 默认命令目标 | shell     | 工作区路径示例                     |
| ------------ | ------------ | --------- | ---------------------------------- |
| Windows 原生 | `windows`    | cmd.exe   | `C:\Users\you\project` 或 UNC 目录 |
| WSL          | `wsl`        | `/bin/sh` | `/home/you/project`                |

## Windows 原生

Windows 原生模式无需 WSL。安装版使用 Electron 自带的 Node 运行时，内核与 Playwright 资源位于安装目录的
`resources/runtime/native/`。文件读写、会话、模型、MCP、skills、搜索与浏览器均在 Windows 环境运行。

命令的工作目录使用 Windows 路径；对 UNC 工作区使用
`pushd`，避免 cmd.exe 自动切换到系统目录。输出按 UTF-8 或实际控制台代码页解码；超时与取消通过
`taskkill /f /t /pid`
结束进程树。命令支持 cmd.exe 环境变量展开。一条调用只接受一行命令，多步命令用 `&`
或独立调用表达。

在原生内核中指定 `environment: "wsl"`
会返回明确错误；需要操作 WSL 项目时，通过工作台「运行环境 → 切换运行环境」选择发行版。切换前必须完成或取消正在运行的任务。

## WSL 模式

WSL 模式保留独立的 Linux 运行时。`run_command` 的 `environment` 参数默认
`"wsl"`，显式选择 `"windows"`
时通过 interop 调用 Windows 程序。Windows 原生与 WSL 分别保存各自环境中的会话、配置和浏览器构建，不迁移或复制数据。

## WSL 内核调用 Windows 命令

- **可用性**：每次调用先探测 `cmd.exe`
  能否启动。不可用时命令以明确错误结束，**不会静默退回 WSL 执行**；错误里给出 interop 与 PATH 的检查方向。
- **工作目录**：`wslpath -w` 把工作区的 WSL 路径转成 Windows 路径。`/mnt/c/...` 得到
  `C:\...`；WSL 自己的路径得到
  `\\wsl.localhost\<发行版>\...`（UNC）。cmd.exe 不接受 UNC 作为当前目录（会警告并回落到
  `C:\Windows`），因此内核用 `pushd` 把该共享映射成临时盘符再执行；命令里 `cd`/`%CD%`
  看到的是映射后的路径（如 `Z:\home\...`）。
- **输出编码**：cmd 内建命令与旧程序把按控制台代码页编码的字节写进管道（中文 Windows 是 GBK
  936）。内核先按 UTF-8 解码，失败时按该代码页转码，所以 `ver`、`ipconfig`
  之类的中文输出不会乱码；输出按 stdout、stderr 归并。
- **结束与超时**：Windows 进程收不到 Linux 信号，超时与取消用 `taskkill /f /t /pid`
  结束整棵进程树，随后才丢弃承载它的 interop 进程；超时与取消的语义、事件与日志与 WSL 目标一致。
- **命令文本**：经环境变量传给 cmd.exe（interop 会转义参数里的引号，直接作为参数会把引号弄坏）。因此命令里的
  `%VAR%` 不会被 cmd 展开；需要展开时把命令写成
  `cmd /c "…"`。命令必须是 cmd.exe 的一行：换行的命令会被内核拒绝并说明原因，而不是只跑第一行。

## 限制

- **`/mnt/c`
  慢**：Windows 盘在 WSL 中经 drvfs/9p 跨边界访问，读写、遍历与创建文件都比 WSL 自身文件系统慢。大仓库的构建与测试留在 WSL 侧。
- **跨边界文件监听不可靠**：Windows 侧改动的文件，WSL 内的 inotify 监听器（`tsc --watch`、vite、nodemon 等）经常收不到事件。需要监听的进程不要以
  `/mnt/c` 上的文件为输入。
- **Linux 工具链不要跑在
  `/mnt/c`**：`node_modules`、构建缓存、符号链接与文件权限在 drvfs/9p 上生成慢，还可能因元数据差异出错。项目源码放在 WSL 侧；确需 Windows 侧副本时，把它当作生成物而不是工作目录。

## 错误

- interop 不可用（`/etc/wsl.conf` 关了 interop，或 Windows 目录不在
  `PATH`）：命令失败并说明原因。
- 工作目录在 Windows 侧不存在：`pushd` 失败，命令不执行，结果里是 cmd 的报错与退出码。
- 找不到要运行的程序：cmd 报 “不是内部或外部命令…”，退出码 1，与其他 shell 一致。
