# Prism MCP 客户端

[English](mcp.en.md) | 简体中文

Prism 内核可以连接 MCP（Model Context
Protocol）服务器，把外部工具作为内核工具使用。MCP 工具与内置工具同构：有名称、描述、JSON
Schema 参数和执行动作，模型用同一种方式调用它们。

Prism 出厂不预装任何 MCP 服务器。不配置就一个都不连接。

## 配置位置

配置文件是内核数据目录下的 `mcp.json`：

```text
~/.prism/mcp.json
```

数据目录随内核运行位置变化时，文件随之变化（内核读取的是 `<数据目录>/mcp.json`）。

文件缺失表示零个服务器，不是错误。文件存在但格式不对时，内核报出文件名与出错的服务器名。

## 配置格式

JSON 对象，`mcpServers` 为服务器名到服务器设置的映射：

```json
{
  "mcpServers": {
    "filesystem": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/me/notes"],
      "env": { "LOG_LEVEL": "warn" }
    },
    "remote-tools": {
      "transport": "http",
      "url": "https://tools.example.com/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

### 字段

通用：

| 字段        | 说明                          |
| ----------- | ----------------------------- |
| `transport` | 必填，`"stdio"` 或 `"http"`。 |

`"stdio"`：内核以子进程方式启动服务器，经标准输入输出通信。

| 字段      | 说明                                       |
| --------- | ------------------------------------------ |
| `command` | 必填，可执行文件，按内核 `PATH` 解析。     |
| `args`    | 可选，字符串数组，命令行参数。             |
| `env`     | 可选，字符串映射，追加给子进程的环境变量。 |

`"http"`：服务器由用户自行运行，内核按 MCP Streamable HTTP 连接。

| 字段      | 说明                           |
| --------- | ------------------------------ |
| `url`     | 必填，服务器地址。             |
| `headers` | 可选，字符串映射，附加请求头。 |

## 工具

服务器列出的每个工具在模型侧出现为：

```text
mcp__<服务器名>__<工具名>
```

名称里的双下划线由 Prism 加入，用于避免与内置工具或其他服务器重名；调用时必须原样使用。除此之外，工具的名称、描述与 JSON
Schema 都来自服务器本身。

## 故障行为

- 单个服务器连接失败、初始化超时或中途退出时，内核记录该服务器与原因，其他服务器与内置工具继续工作。
- 启动失败的记录包含失败服务器进程输出的 stderr 摘要，便于定位。
- 工具调用失败以工具结果返回给模型（而不是中断任务），结果里说明是哪个工具失败以及原因。
