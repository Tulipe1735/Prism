# 内核浏览器模块（Playwright）

内核的浏览器工具实现位于 `src/kernel/browser/`。外部 CLI 面（`src/browser`、`src/cli`）保持不动，
本模块是内核在 Playwright 之上重建的观察、引用与回执语义。

## 单一驱动

引擎决策见 [ADR-0006](adr/0006-browser-engine.md)：**只使用 Playwright 一种驱动**。

被拒绝的方案：Chromium 走裸 CDP、Firefox/WebKit 走 Playwright。拒绝原因：观察样本、目标引用、
新鲜度校验与输入回执要维护两份实现，两份实现必然随浏览器更新漂移，而「引用是否仍然有效」这类
语义一旦分叉，模型会收到相互矛盾的事实。

页面注入复用现有 `src/browser/snapshot.js`（按原样读取）与纯页面函数
（`extractInPage`、`extractRelationsInPage`、`createStateReaderInPage`）；这些函数不依赖 CDP，
`page.evaluate` 在三种引擎上行为一致。

## 模块结构

| 文件 | 职责 |
| --- | --- |
| `engine.ts` | 引擎生命周期：Chromium（默认）、Firefox、WebKit 的启动；Chromium 经 `connectOverCDP` 接管运行中的 Chrome/Edge；安装与启动错误转成可执行的配置错误 |
| `session.ts` | 单个页面会话：观察、`samePage`/`fresh` 新鲜度、单步动作执行、输入后的稳定读策略 |
| `evidence.ts` | 一次同步页面采样：快照、目标上下文、关系证据、只读状态与覆盖信息 |
| `tool.ts` | 浏览器会话管理、目标引用、证据校验、动作校验、输入回执、动作后观察 |
| `receipts.ts` | 回执的持久化：先写 pending 再输入，确认后原子替换 |

注册进内核（工具注册表与联调）由 `02-kernel-loop.md`、`12-verification.md` 完成。

## 引擎与安装

- 默认 Chromium。Firefox 与 WebKit 使用 Playwright 自带构建，不读取用户浏览器档案。
- 安装：`npx playwright install chromium`（首次）；`npx playwright install firefox webkit` 按需。
  WebKit 在部分 Linux 环境需要系统库：`npx playwright install --with-deps webkit`（需要 root）。
- 接管已登录浏览器（仅 Chromium 系）：用户先启动 Chrome/Edge，例如
  `google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.prism-chrome"`，
  内核以 `connectOverCDP` 连接。Chrome 136+ 不允许在默认 profile 上开启远程调试。
  关闭会话只关闭内核自有的标签页并断开连接，不关闭用户的浏览器。

## 保留的语义

- **观察范围与覆盖**：`observe` 返回 `state.coverage`（`total/returned/omitted/truncated`）与
  `omitted_actions`；未显示的内容不视为不存在。
- **目标引用**：`<observation>:<action>` 形式的引用只在其观察有效期内可用；新观察、已执行动作与
  不确定动作都会让旧引用失效（`OBSERVATION_EXPIRED`）。
- **动作前新鲜度**：文档/URL 变化 → `DOCUMENT_CHANGED`；目标身份、标签或状态变化 →
  `TARGET_CHANGED`；展示过的证据字段变化 → `EVIDENCE_CHANGED`。三者都在输入前拒绝。
- **单步动作**：click、fill、select、scroll、wait；select 的选中状态不完整时拒绝输入
  （`EVIDENCE_TRUNCATED`）；fill 必须给出值（含显式空串）。
- **输入回执**：执行前先落盘 `unknown` 占位，收到浏览器确认后变为 `executed`，输入前被拒绝为
  `not_executed`，输入开始后出错保持 `unknown`。相同 `request-id` 的原样重放只返回历史回执
  （`replayed: true`），内容不同的相同 `request-id` 被拒绝（`REQUEST_ID_CONFLICT`）。回执在会话
  关闭后仍可查询。

## 已知限制

- 接管模式下，新建标签页由 Playwright 发起，Chromium 可能短暂把它切到前台；ADR-0006 拒绝裸 CDP，
  因此当前不提供「后台标签」开关。
- `page.goto` 失败（DNS、超时）不阻止会话打开：浏览器错误页也是需要被观察的内容。
- 打包时（`02`/`12` 接入内核入口）需保证 `snapshot.js` 相对模块路径在 `dist` 中可用，做法与现有
  CLI 构建把 `snapshot.js` 复制到 `dist/` 相同。
