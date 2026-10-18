/**
 * MCP server configuration.
 *
 * The kernel reads one configuration file per data directory: `<dataDir>/mcp.json`.
 * See `docs/mcp.md` for the file format and the default location (`~/.prism/mcp.json`).
 * Prism ships without any configured server: a missing file means zero servers.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ConfigError } from "../shared/errors.ts";

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

export const MCP_CONFIG_FILE = "mcp.json";

/** Location of the MCP configuration file inside the kernel data directory. */
export function mcpConfigPath(dataDir: string): string {
  return join(dataDir, MCP_CONFIG_FILE);
}

/**
 * Reads the MCP configuration file.
 *
 * A missing file resolves to zero servers. A file that exists but does not
 * match the documented format raises a `ConfigError` naming the file and
 * server, so the user can fix it before any server is started.
 */
export async function loadMcpConfig(dataDir: string): Promise<McpConfig> {
  const path = mcpConfigPath(dataDir);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { servers: {} };
    throw error;
  }

  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch (error) {
    throw new ConfigError(
      `MCP config ${path} is not valid JSON: ${describeError(error)}`,
    );
  }
  return parseConfig(document, path);
}

function parseConfig(document: unknown, path: string): McpConfig {
  const servers = asRecord(document)?.mcpServers;
  const entries = asRecord(servers);
  if (!entries)
    throw new ConfigError(`MCP config ${path} must contain an "mcpServers" object.`);

  const config: Record<string, McpServerConfig> = {};
  for (const [name, value] of Object.entries(entries))
    config[name] = parseServer(value, path, name);
  return { servers: config };
}

function parseServer(value: unknown, path: string, name: string): McpServerConfig {
  const where = `MCP config ${path}: server "${name}"`;
  const server = asRecord(value);
  if (!server) throw new ConfigError(`${where} must be an object.`);

  if (server.transport === "stdio") {
    if (typeof server.command !== "string" || server.command === "")
      throw new ConfigError(`${where} needs a non-empty "command".`);
    const config: McpStdioServerConfig = {
      transport: "stdio",
      command: server.command,
    };
    if (server.args !== undefined) config.args = stringList(server.args, where, "args");
    if (server.env !== undefined) config.env = stringMap(server.env, where, "env");
    return config;
  }

  if (server.transport === "http") {
    if (typeof server.url !== "string" || server.url === "")
      throw new ConfigError(`${where} needs a non-empty "url".`);
    if (!URL.canParse(server.url))
      throw new ConfigError(`${where} has an invalid "url": ${server.url}`);
    const config: McpHttpServerConfig = { transport: "http", url: server.url };
    if (server.headers !== undefined)
      config.headers = stringMap(server.headers, where, "headers");
    return config;
  }

  throw new ConfigError(`${where} needs a "transport" of "stdio" or "http".`);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringList(value: unknown, where: string, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new ConfigError(`${where} has an invalid "${field}": expected strings.`);
  return value as string[];
}

function stringMap(
  value: unknown,
  where: string,
  field: string,
): Record<string, string> {
  const record = asRecord(value);
  if (!record || Object.values(record).some((item) => typeof item !== "string"))
    throw new ConfigError(`${where} has an invalid "${field}": expected strings.`);
  return record as Record<string, string>;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
