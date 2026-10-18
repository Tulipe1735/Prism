# Prism MCP Client

English | [简体中文](mcp.md)

The Prism kernel can connect to MCP (Model Context Protocol) servers and use their tools
as kernel tools. MCP tools are shaped like built-in tools: a name, a description, a JSON
Schema for arguments, and an execute action. The model calls them the same way.

Prism ships without any MCP server configured. With no configuration, none is connected.

## Where configuration lives

The configuration file is `mcp.json` inside the kernel data directory:

```text
~/.prism/mcp.json
```

When the kernel runs with a different data directory, the file moves with it (the kernel
reads `<data directory>/mcp.json`).

A missing file means zero servers and is not an error. When the file exists but does not
match the format, the kernel reports the file name and the failing server name.

## Configuration format

A JSON object whose `mcpServers` maps server names to server settings:

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

### Fields

Common:

| Field       | Description                      |
| ----------- | -------------------------------- |
| `transport` | Required, `"stdio"` or `"http"`. |

`"stdio"`: the kernel starts the server as a child process and talks over stdin/stdout.

| Field     | Description                                              |
| --------- | -------------------------------------------------------- |
| `command` | Required, executable, resolved with the kernel's `PATH`. |
| `args`    | Optional, string array, command-line arguments.          |
| `env`     | Optional, string map, extra child process environment.   |

`"http"`: the user runs the server; the kernel connects over MCP Streamable HTTP.

| Field     | Description                          |
| --------- | ------------------------------------ |
| `url`     | Required, server address.            |
| `headers` | Optional, string map, extra headers. |

## Tools

Every tool a server lists appears to the model as:

```text
mcp__<server name>__<tool name>
```

The double underscores are added by Prism to avoid collisions with built-in tools and
other servers; calls must use the name exactly. Everything else — the tool name,
description and JSON Schema — comes from the server.

## Failure behavior

- When one server fails to connect, times out during initialization, or exits
  mid-session, the kernel records that server and the reason. Other servers and built-in
  tools keep working.
- A startup failure includes a summary of the failed server process stderr, to make the
  problem findable.
- A failed tool call comes back to the model as a tool result (it does not abort the
  task). The result names the failing tool and the reason.
