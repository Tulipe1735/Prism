---
status: accepted
---

# 浏览器引擎：Playwright

内核的浏览器工具以 Playwright 为引擎：默认 Chromium，经其 CDP 通道，并可接管运行中的 Chrome/Edge 以保留登录态；Firefox 与 WebKit 使用 Playwright 自带构建。被拒绝的方案：继续直连 CDP（覆盖不到 Firefox/WebKit）；Chromium 走裸 CDP、其余走 Playwright 的双驱动实现（观察、引用与回执语义要维护两份，行为会漂移）。代价：依赖与浏览器构建体积显著增加；Firefox/WebKit 无法复用用户既有浏览器档案；既有语义层需要移植到 Playwright
API 之上。
