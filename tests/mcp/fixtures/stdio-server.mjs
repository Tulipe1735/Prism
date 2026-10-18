/**
 * Minimal MCP server used by the MCP client tests.
 *
 * Run with `node stdio-server.mjs [mode]`:
 * - default: serves the `echo`, `explode` and `kill` tools over stdio.
 * - `crash`: writes a diagnostic to stderr and exits without serving anything.
 */
import process from "node:process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const mode = process.argv[2] ?? "serve";

if (mode === "crash") {
  process.stderr.write("fake server: refused to start\n");
  process.exit(1);
}

const server = new McpServer({ name: "fake-server", version: "0.0.0" });

server.registerTool(
  "echo",
  {
    description: "Echoes the given text back.",
    inputSchema: { text: z.string() },
  },
  async ({ text }) => ({ content: [{ type: "text", text: `echo: ${text}` }] }),
);

server.registerTool(
  "explode",
  {
    description: "Always fails.",
    inputSchema: {},
  },
  async () => {
    throw new Error("tool exploded");
  },
);

server.registerTool(
  "kill",
  {
    description: "Kills the server process mid-call.",
    inputSchema: {},
  },
  async () => {
    process.exit(1);
  },
);

server.connect(new StdioServerTransport()).catch((error) => {
  process.stderr.write(`fake server: ${error}\n`);
  process.exit(1);
});
