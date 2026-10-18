# 联网检索：`web_search` 与 `web_fetch`

实现位置：[`src/web`](../src/web)；测试：[`tests/web`](../tests/web)。两者都是只读网络访问，不写工作区；内核工具注册（`web_search`、`web_fetch`）由端到端 ticket 联调完成。

## `web_search`

`web_search` 经可配置来源（provider）检索网络，返回标题、链接与摘要。

### 默认来源：DeepSeek

DeepSeek 有公开可用的 Search API，2026-10-18 依据官方文档核实：

- 端点
  `POST https://api.deepseek.com/v1/tools/search`，Bearer 鉴权，与聊天补全同一套 key 与 base
  URL。
- 请求 `{query, count, ori_question?, need_content}`；`count` 1–50，默认 10；查询支持
  `site:`、`-site:`、引号短语、`lang:`、`after:`、`before:` 等运算符。
- 响应 `results[]`，每项含
  `title`、`url`、`snippet`、`summary`、`date`、`site_name`、`authority`。
- 计费：每 1000 次成功请求 $0.75；失败、空结果与超时不计费。QPS 限制 5（账号级）。
- 文档：<https://api-docs.deepseek.com/guides/search>；参考：<https://api-docs.deepseek.com/api/search>。

本模块以 `need_content: false` 请求，只取摘要；正文交给 `web_fetch`
按需抓取，避免为每次搜索付费抓取全文。

### 配置

配置类型为 [`WebSearchConfig`](../src/web/search.ts)：

| 键          | 默认                       | 说明                                                                                                        |
| ----------- | -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `provider`  | `deepseek`                 | 搜索来源，与内核配置 `search.provider` 一致                                                                 |
| `apiKey`    | 必填                       | 与模型共用 DeepSeek key（内核配置的 `search.apiKey` 或 `model.apiKey`）；缺失时 `createSearchProvider` 报错 |
| `baseUrl`   | `https://api.deepseek.com` | 可指向网关、代理或自建兼容端点                                                                              |
| `count`     | `10`                       | 默认结果数，1–50                                                                                            |
| `timeoutMs` | `25000`                    | 单次请求超时（HTTP 层对 429/503/529 重试）                                                                  |
| `fetchImpl` | 全局 `fetch`               | 注入点，测试与离线验证用                                                                                    |

调用方式：

```ts
const provider = createSearchProvider({ provider: "deepseek", apiKey });
const results = await provider.search({ query: "playwright firefox", count: 5 });
// results: Array<{ title, url, snippet, summary, siteName, date }>
```

### 更换来源

内置来源目前只有 `deepseek`；未知名称会抛出 `ConfigError`
并列出可用来源。DeepSeek 不是唯一路径——替换方式：

1. 实现 [`SearchProvider`](../src/web/search.ts)：`name` 与
   `search(request) => Promise<SearchResult[]>`。
2. 把实例直接交给消费方（工具层只用 `SearchProvider` 接口，不识别具体来源）。
3. 若要按配置名选择，则把该来源注册进 `createSearchProvider`（当前为单来源分支）。

Brave、Tavily、自建聚合搜索都可以用这个方式接入；`web_fetch`
无需改动。任何来源都能在测试中用 `fetchImpl` 假响应离线验证。

## `web_fetch`

`web_fetch` 由内核自己抓取并转文本（不经过 DeepSeek Fetch
API），因此 SSRF 策略、大小与超时都由内核把关。

返回 `WebPage`：

| 字段          | 说明                                                                                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`         | 跟随重定向后的最终地址                                                                                                                                                            |
| `title`       | `<title>` 文本，HTML 实体已解码                                                                                                                                                   |
| `text`        | HTML 转可读文本：跳过 `script`/`style`/`noscript`/`svg`/`img`/`iframe`；标题保留原大小写；相对链接按页面 origin 解析；表格按列对齐。`text/plain`、`application/json` 等按原文返回 |
| `truncated`   | 正文超过大小上限而被截断时为 `true`                                                                                                                                               |
| `contentType` | 响应声明的类型                                                                                                                                                                    |

限制与默认值：

| 项         | 默认  | 行为                                        |
| ---------- | ----- | ------------------------------------------- |
| 超时       | 20 秒 | 整个抓取（含重定向与读体）共享一个截止时间  |
| 大小       | 2 MiB | 超出即停止读取并置 `truncated`，不报错      |
| 重定向     | 5 跳  | 超出报错；每一跳都重新校验目标              |
| 非文本类型 | —     | 例如 `image/png` 直接报错，不返回二进制内容 |
| 字符集     | UTF-8 | 按响应 `charset` 解码，未知字符集回退 UTF-8 |

### 目标策略（SSRF 防护）

拒绝以下目标并抛 `UnsafeTargetError`（在任何连接之前）：

- 非 `http`/`https` 的 URL，以及带用户名或密码的 URL；
- 私网与保留地址：环回、`10/8`、`172.16/12`、`192.168/16`、`100.64/10`（CGNAT）、`169.254/16`（含
  `169.254.169.254`
  云元数据）、`192.0.0/24`、`192.0.2/24`、`192.88.99/24`、`198.18/15`、`198.51.100/24`、`203.0.113/24`、`0/8`、组播与
  `224.0.0.0/4` 以上保留段；
- IPv6：未指定、环回、唯一本地（`fc00::/7`）、链路本地（`fe80::/10`）、组播、`2001:db8::/32`、Teredo（`2001::/32`）、6to4（`2002::/16`）、NAT64（`64:ff9b::/96`）、IPv4 映射与兼容地址按内嵌 IPv4 判定；
- `localhost` 与 `*.localhost` 名称；
- 主机名解析出的任一地址命中上述范围（只要有一个非公开地址就拒绝）；
- 每次重定向的目标同样校验，公网页面无法把内核带进私网。

失败语义：`signal` 取消时抛出调用方给出的原因；超时报 `timed out after N ms`；HTTP
4xx/5xx 报 `failed with HTTP N`（不返回错误页正文）；DNS 失败与连接中断报 `failed: …`。

已知残余风险：校验发生在建立连接之前，理论上存在 DNS 重绑定窗口（解析校验与实际连接两次解析的差异）。首版按“每跳解析并校验”实现；若要彻底关闭该窗口，需要在连接层固定已校验的地址。

## 内核工具形态（联调参考）

| 工具         | 参数                                | 结果             |
| ------------ | ----------------------------------- | ---------------- |
| `web_search` | `{ query: string, count?: number }` | `SearchResult[]` |
| `web_fetch`  | `{ url: string }`                   | `WebPage`        |

两者都不需要权限范围审批（只读、不改工作区）；`web_fetch`
的目标校验与权限档位无关，任何档位下都拒绝非公网目标。
