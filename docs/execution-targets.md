# 执行目标：WSL 与 Windows

内核在 WSL 中运行，命令工具带 `environment`
参数：`"wsl"`（默认）在内核自己这一侧执行，`"windows"` 经 WSL
interop 在 Windows 的 cmd.exe 中执行（[ADR-0002](adr/0002-execution-targets.md)）。本文件记录两者的边界与限制，供实现与使用参考。

## 两个目标

| 目标      | 命令在哪里运行                | 工作目录                     | 文件可见性                                         |
| --------- | ----------------------------- | ---------------------------- | -------------------------------------------------- |
| `wsl`     | 内核自身的 shell（`/bin/sh`） | WSL 路径                     | WSL 文件系统                                       |
| `windows` | Windows 的 `cmd.exe`          | WSL 路径经 `wslpath -w` 转换 | 经 `/mnt/<盘>` 或 `\\wsl.localhost\<发行版>\` 共享 |

需要在 Windows 上完成的事（Windows 专有工具、Windows 侧构建、`tasklist`/`taskkill`
之类系统命令）才选 `windows`；其余仍用 WSL，因为跨边界访问是次等环境。

## Windows 目标怎么工作

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
