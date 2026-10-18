/**
 * MCP server configuration.
 *
 * The kernel reads one configuration file per data directory: `<dataDir>/mcp.json`.
 * See `docs/mcp.md` for the file format and the default location (`~/.prism/mcp.json`).
 * Prism ships without any configured server.
 */

/** A server Prism starts as a child process and talks to over stdin/stdout. */
export interface McpStdioServerConfig {
  transport: "stdio";
  /** Executable to spawn, resolved with the kernel's `PATH`. */
  command: string;
  args?: string[];
  /** Extra environment variables for the child process. */
  env?: Record<string, string>;
}

/** A server reached over the MCP Streamable HTTP transport. */
export interface McpHttpServerConfig {
  transport: "http";
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;

export interface McpConfig {
  /** Server name (used in tool names) to server settings. */
  servers: Record<string, McpServerConfig>;
}
