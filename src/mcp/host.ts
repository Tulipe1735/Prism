/**
 * Connects to the MCP servers from the configuration file and exposes their
 * tools in the kernel tool shape.
 *
 * A server that fails to start, list its tools, or answer a call is reported as
 * a failure; it never blocks or breaks the other servers or the kernel loop.
 */
import type { Buffer } from "node:buffer";
import type { McpConfig, McpServerConfig } from "./config.ts";
import type { McpTool, McpToolResult } from "./tools.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { VERSION } from "../shared/version.ts";
import { toolResultIsError, toolResultText } from "./tools.ts";

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
/** How much server stderr is kept to explain a startup failure. */
const STDERR_TAIL_LIMIT = 2_000;

export interface McpHostOptions {
  /** How long to wait for one server to initialize and list its tools. */
  connectTimeoutMs?: number;
}

/** A server that could not be used, with a human-readable reason. */
export interface McpServerFailure {
  server: string;
  message: string;
}

interface OpenServer {
  client: Client;
}

export class McpHost {
  readonly #servers: OpenServer[];
  readonly #tools: McpTool[];
  readonly #failures: McpServerFailure[];

  private constructor(
    servers: OpenServer[],
    tools: McpTool[],
    failures: McpServerFailure[],
  ) {
    this.#servers = servers;
    this.#tools = tools;
    this.#failures = failures;
  }

  /** Connects to every configured server. Failures are recorded, never thrown. */
  static async connect(
    config: McpConfig,
    options: McpHostOptions = {},
  ): Promise<McpHost> {
    const timeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    const servers: OpenServer[] = [];
    const tools: McpTool[] = [];
    const failures: McpServerFailure[] = [];

    for (const [server, serverConfig] of Object.entries(config.servers)) {
      try {
        const open = await openServer(serverConfig, timeoutMs);
        servers.push(open);
        tools.push(...(await listTools(server, open.client, timeoutMs)));
      } catch (error) {
        failures.push({ server, message: describeError(error) });
      }
    }

    return new McpHost(servers, tools, failures);
  }

  /** All tools of all reachable servers, in the kernel tool shape. */
  get tools(): McpTool[] {
    return this.#tools;
  }

  /** Servers that could not be used, for startup reporting. */
  get failures(): McpServerFailure[] {
    return this.#failures;
  }

  async close(): Promise<void> {
    const servers = this.#servers.splice(0);
    await Promise.all(servers.map((server) => server.client.close().catch(() => {})));
  }
}

async function openServer(
  config: McpServerConfig,
  timeoutMs: number,
): Promise<OpenServer> {
  const client = new Client({ name: "prism", version: VERSION });
  let stderr = "";
  let transport: StdioClientTransport | StreamableHTTPClientTransport;

  if (config.transport === "stdio") {
    const stdio = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: config.env,
      stderr: "pipe",
    });
    stdio.stderr?.on("data", (chunk: Buffer) => {
      stderr = tail(stderr + chunk.toString("utf8"), STDERR_TAIL_LIMIT);
    });
    transport = stdio;
  } else {
    transport = new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: config.headers ? { headers: config.headers } : undefined,
    });
  }

  try {
    await client.connect(transport, { timeout: timeoutMs });
  } catch (error) {
    await client.close().catch(() => {});
    const detail = stderr.trim();
    throw new Error(
      detail
        ? `${describeError(error)}\nserver stderr: ${detail}`
        : describeError(error),
    );
  }
  return { client };
}

async function listTools(
  server: string,
  client: Client,
  timeoutMs: number,
): Promise<McpTool[]> {
  const listed = await client.listTools(undefined, { timeout: timeoutMs });
  return listed.tools.map((tool) => {
    const name = `mcp__${server}__${tool.name}`;
    return {
      name,
      description:
        tool.description ?? `Tool "${tool.name}" from MCP server "${server}".`,
      inputSchema: tool.inputSchema,
      execute: (args: Record<string, unknown>) =>
        callTool(client, name, tool.name, args),
    };
  });
}

async function callTool(
  client: Client,
  name: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  try {
    const result = await client.callTool({ name: tool, arguments: args });
    return { text: toolResultText(result), isError: toolResultIsError(result) };
  } catch (error) {
    return {
      text: `MCP tool "${name}" failed: ${describeError(error)}`,
      isError: true,
    };
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function tail(text: string, limit: number): string {
  return text.length <= limit ? text : text.slice(text.length - limit);
}
